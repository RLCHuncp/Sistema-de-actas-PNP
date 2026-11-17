require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { fetch } = require("./lib/http");
const basicAuth = require("express-basic-auth");
const multer = require("multer");
const { leerFicha } = require("./lib/ficha-reniec");
const { consultarPlaca } = require("./lib/placa");
const { armarDocumentos, redactarHechos } = require("./lib/expediente");

// Archivos subidos (ficha RENIEC) se procesan en memoria y no se guardan en disco
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();

// Si se configuran AUTH_USER/AUTH_PASS (recomendado al publicar el sistema
// con un link accesible fuera de tu PC), se pide usuario/contraseña antes
// de dejar ver o usar el formulario. Localmente sin configurar, no molesta.
if (process.env.AUTH_USER && process.env.AUTH_PASS) {
  app.use(
    basicAuth({
      users: { [process.env.AUTH_USER]: process.env.AUTH_PASS },
      challenge: true,
      realm: "Sistema de Actas PNP",
    })
  );
}

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const CONFIG_PATH = path.join(__dirname, "config", "actas.json");
const BASE_LEGAL_PATH = path.join(__dirname, "config", "base-legal.json");
const UBIGEO_PATH = path.join(__dirname, "config", "ubigeo.json");
const TEMPLATES_DIR = path.join(__dirname, "templates");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

// Catálogo de bases legales (delito -> artículos) para autocompletar el campo base_legal
app.get("/api/base-legal", (req, res) => {
  res.json(JSON.parse(fs.readFileSync(BASE_LEGAL_PATH, "utf8")));
});

// Departamentos / provincias / distritos oficiales del Perú, para los combobox en cascada
app.get("/api/ubigeo", (req, res) => {
  res.json(JSON.parse(fs.readFileSync(UBIGEO_PATH, "utf8")));
});

// Consulta DNI en RENIEC vía un proveedor tercero configurado en .env
// RENIEC no ofrece API pública directa; se usa un intermediario (apis.net.pe/decolecta,
// Factiliza, JSON.pe, APIDNI, etc.). Configurar RENIEC_API_URL y RENIEC_API_TOKEN en .env.
app.get("/api/dni/:numero", async (req, res) => {
  const { numero } = req.params;
  if (!/^\d{8}$/.test(numero)) {
    return res.status(400).json({ error: "El DNI debe tener 8 dígitos" });
  }

  const apiUrl = process.env.RENIEC_API_URL;
  const apiToken = process.env.RENIEC_API_TOKEN;

  if (!apiUrl || !apiToken) {
    return res.status(501).json({
      error: "Consulta RENIEC no configurada. Define RENIEC_API_URL y RENIEC_API_TOKEN en .env " +
             "(ver .env.example para proveedores sugeridos).",
    });
  }

  try {
    // Soporta dos patrones de proveedor:
    // 1) Token como query param en la URL: URL trae {dni} y {token} (ej. apiperu.dev)
    // 2) Token en header Authorization Bearer: URL solo trae {dni} (ej. Factiliza, APIDNI)
    const usaTokenEnUrl = apiUrl.includes("{token}");
    const url = apiUrl.replace("{dni}", numero).replace("{token}", apiToken);
    const headers = { Accept: "application/json" };
    if (!usaTokenEnUrl) headers.Authorization = `Bearer ${apiToken}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `El proveedor RENIEC respondió ${resp.status}` });
    }
    const raw = await resp.json();

    // Distintos proveedores envuelven la respuesta en "data", "message" u otros;
    // esto normaliza a un solo objeto plano antes de leer los campos.
    const data = (raw && typeof raw.data === "object" && raw.data) ||
                 (raw && typeof raw.message === "object" && raw.message) ||
                 raw || {};

    const nombres = data.nombres || data.first_name || data.name || "";
    const apPaterno = data.apellido_paterno || data.apellidoPaterno || data.first_last_name || "";
    const apMaterno = data.apellido_materno || data.apellidoMaterno || data.second_last_name || "";
    const nombreCompleto = data.nombre_completo || data.full_name ||
      [nombres, apPaterno, apMaterno].filter(Boolean).join(" ");

    if (!nombreCompleto) {
      return res.status(404).json({ error: "No se encontraron datos para ese DNI" });
    }

    res.json({ dni: numero, nombre_completo: nombreCompleto });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "No se pudo conectar con el proveedor RENIEC" });
  }
});

// Devuelve el esquema de campos (base + por tipo de acta) para construir el formulario
app.get("/api/config", (req, res) => {
  res.json(loadConfig());
});

// Rellena una plantilla y devuelve el buffer .docx generado
function renderActa(tipo, datos) {
  const templatePath = path.join(TEMPLATES_DIR, tipo.plantilla);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Plantilla no encontrada: ${tipo.plantilla}`);
  }
  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "___________", // deja un blanco visible si falta un dato
  });
  doc.render(datos);
  return doc.getZip().generate({ type: "nodebuffer" });
}

// Genera UN acta específica
app.post("/api/generar/:tipoId", (req, res) => {
  try {
    const config = loadConfig();
    const tipo = config.tipos_acta.find((t) => t.id === req.params.tipoId);
    if (!tipo) return res.status(404).json({ error: "Tipo de acta no encontrado" });
    if (!tipo.implementado) {
      return res.status(400).json({ error: "Esta acta aún no tiene plantilla cargada" });
    }
    const buffer = renderActa(tipo, req.body || {});
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${tipo.id}.docx"`
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Arma un ZIP con varios documentos. Cada elemento de "documentos" es
// independiente (tipo de acta + sus propios datos + nombre de archivo).
function generarZip(documentos) {
  const config = loadConfig();
  const zip = new PizZip();
  const nombresUsados = new Set();

  for (const doc of documentos) {
    const tipo = config.tipos_acta.find((t) => t.id === doc.tipoId);
    if (!tipo || !tipo.implementado) {
      throw Object.assign(new Error(`Tipo de acta inválido: ${doc.tipoId}`), { status: 400 });
    }
    const buffer = renderActa(tipo, doc.datos || {});

    // evita sobrescribir si dos documentos terminan con el mismo nombre
    const base = (doc.nombre || tipo.id).replace(/[\\/:*?"<>|]/g, "-");
    let nombreArchivo = base + ".docx";
    let intento = 2;
    while (nombresUsados.has(nombreArchivo)) {
      nombreArchivo = `${base}-${intento}.docx`;
      intento++;
    }
    nombresUsados.add(nombreArchivo);
    zip.file(nombreArchivo, buffer);
  }
  return zip.generate({ type: "nodebuffer" });
}

function enviarZip(res, buffer, nombre) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
  res.send(buffer);
}

// Genera VARIOS documentos a la vez y los entrega en un ZIP — así el frontend
// puede pedir, por ejemplo, un "Acta de Registro Personal" por cada persona
// interviniente cuando hay varios detenidos.
app.post("/api/generar-lote", (req, res) => {
  try {
    const { documentos } = req.body;
    if (!Array.isArray(documentos) || documentos.length === 0) {
      return res.status(400).json({ error: "No se recibió ningún documento para generar" });
    }
    enviarZip(res, generarZip(documentos), "actas.zip");
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ===================== Expediente de flagrancia =====================

// Qué funciones opcionales están configuradas en .env (para avisar en pantalla)
app.get("/api/capacidades", (req, res) => {
  res.json({
    lectura_ia: Boolean(process.env.ANTHROPIC_API_KEY),
    consulta_dni: Boolean(process.env.RENIEC_API_URL && process.env.RENIEC_API_TOKEN),
    consulta_placa: Boolean(process.env.PLACA_API_URL && process.env.PLACA_API_TOKEN),
  });
});

// Lee una Ficha RENIEC (PDF o foto) y devuelve los datos de la persona
app.post("/api/ficha-reniec", upload.single("ficha"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });
  try {
    res.json(await leerFicha(req.file.buffer, req.file.mimetype));
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "No se pudo leer la ficha" });
  }
});

// Datos del vehículo por placa (proveedor configurable en .env)
app.get("/api/placa/:placa", async (req, res) => {
  try {
    res.json(await consultarPlaca(req.params.placa));
  } catch (err) {
    console.error(err.message);
    res.status(err.status || 502).json({ error: err.message || "No se pudo consultar la placa" });
  }
});

// Redacta PRIMERO..QUINTO a partir de notas y línea de tiempo
app.post("/api/redactar", async (req, res) => {
  try {
    res.json(await redactarHechos(req.body || {}));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message || "No se pudo redactar" });
  }
});

// Genera todas las actas del expediente (por cada detenido) en un ZIP
app.post("/api/expediente/generar", (req, res) => {
  try {
    const { documentos, errores } = armarDocumentos(req.body || {});
    if (errores.length) return res.status(400).json({ error: errores.join(" ") });
    enviarZip(res, generarZip(documentos), "expediente.zip");
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Errores de subida (archivo muy grande, etc.) con mensaje entendible
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "El archivo supera los 10 MB" : err.message;
    return res.status(400).json({ error: msg });
  }
  next(err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sistema de Actas PNP corriendo en http://localhost:${PORT}`);
});
