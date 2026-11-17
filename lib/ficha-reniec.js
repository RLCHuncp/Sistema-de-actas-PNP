// Lee una Ficha RENIEC (PDF con texto, PDF escaneado o foto) y devuelve los
// datos de la persona en el formato que usan las actas.
//
// Hay dos caminos:
//  1) Si en .env está ANTHROPIC_API_KEY, se le envía el archivo a Claude para
//     que lea la ficha (sirve para fotos torcidas, CamScanner y PDF escaneados).
//  2) Sin esa clave, se extrae el texto localmente (pdf-parse para PDF con
//     texto, tesseract.js para imágenes) y se buscan las etiquetas de la ficha.
// En ambos casos el resultado pasa por normalizarPersona() para que el
// frontend reciba siempre los mismos campos.

const { fetch } = require("./http");

// Etiquetas que aparecen en las distintas versiones de la ficha RENIEC
// (consulta en línea, ficha de datos, C4, duplicado). Clave -> variantes.
const ETIQUETAS = {
  dni: ["n[uú]mero de dni", "nro\\.? de dni", "n° de dni", "dni n°", "dni", "cui"],
  apellido_paterno: ["primer apellido", "apellido paterno", "ap\\.? paterno"],
  apellido_materno: ["segundo apellido", "apellido materno", "ap\\.? materno"],
  nombres: ["pre ?nombres", "prenombres", "nombres"],
  fecha_nacimiento: ["fecha de nacimiento", "fec\\.? nacimiento", "f\\. nacimiento"],
  sexo: ["sexo", "g[eé]nero"],
  estado_civil: ["estado civil"],
  grado_instruccion: ["grado de instrucci[oó]n", "instrucci[oó]n"],
  departamento_nacimiento: ["departamento de nacimiento", "dpto\\.? de nacimiento"],
  provincia_nacimiento: ["provincia de nacimiento", "prov\\.? de nacimiento"],
  distrito_nacimiento: ["distrito de nacimiento", "dist\\.? de nacimiento"],
  lugar_nacimiento: ["lugar de nacimiento"],
  departamento_domicilio: ["departamento de domicilio", "departamento domicilio"],
  provincia_domicilio: ["provincia de domicilio", "provincia domicilio"],
  distrito_domicilio: ["distrito de domicilio", "distrito domicilio"],
  direccion: ["direcci[oó]n de domicilio", "direcci[oó]n", "domicilio"],
  nombre_padre: ["nombre del padre", "padre"],
  nombre_madre: ["nombre de la madre", "madre"],
  estatura: ["estatura"],
  restriccion: ["restricci[oó]n", "restricciones"],
  fecha_caducidad: ["fecha de caducidad", "caducidad"],
};

// Une todas las variantes en una sola expresión, de la más larga a la más
// corta, para que "dirección de domicilio" gane sobre "domicilio".
const TODAS = Object.entries(ETIQUETAS)
  .flatMap(([clave, variantes]) => variantes.map((v) => ({ clave, v })))
  .sort((a, b) => b.v.length - a.v.length);

const REGEX_ETIQUETA = new RegExp(
  "(?:^|\\n|\\s{2,}|\\|)\\s*(" + TODAS.map((t) => t.v).join("|") + ")\\s*[:.\\-]?\\s*",
  "gi"
);

function claveDeEtiqueta(texto) {
  const limpio = texto.toLowerCase().trim();
  for (const t of TODAS) {
    if (new RegExp("^" + t.v + "$", "i").test(limpio)) return t.clave;
  }
  return null;
}

function limpiarValor(v) {
  return String(v || "")
    .replace(/[|_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[:\-.\s]+|[:\-\s]+$/g, "")
    .trim();
}

// Divide el texto en pares etiqueta -> valor. El valor de cada etiqueta es
// lo que hay hasta la siguiente etiqueta o el fin de línea.
function parseFichaTexto(texto) {
  const t = String(texto || "").replace(/\r/g, "");
  const marcas = [];
  let m;
  REGEX_ETIQUETA.lastIndex = 0;
  while ((m = REGEX_ETIQUETA.exec(t)) !== null) {
    const clave = claveDeEtiqueta(m[1]);
    if (clave) marcas.push({ clave, inicioValor: m.index + m[0].length, inicio: m.index });
    if (m[0].length === 0) REGEX_ETIQUETA.lastIndex++;
  }

  const datos = {};
  marcas.forEach((marca, i) => {
    const fin = i + 1 < marcas.length ? marcas[i + 1].inicio : t.length;
    let valor = t.slice(marca.inicioValor, fin);
    // Valores de una sola línea, salvo la dirección que a veces se parte
    if (marca.clave !== "direccion") valor = valor.split("\n")[0];
    valor = limpiarValor(valor);
    if (valor && !datos[marca.clave]) datos[marca.clave] = valor;
  });

  // DNI: si la etiqueta no trajo 8 dígitos, buscar el primer número de 8 dígitos
  const dniEtiqueta = (datos.dni || "").match(/\d{8}/);
  if (dniEtiqueta) datos.dni = dniEtiqueta[0];
  else {
    const suelto = t.match(/(?<!\d)\d{8}(?!\d)/);
    datos.dni = suelto ? suelto[0] : "";
  }

  // Fecha de nacimiento: quedarse con la fecha dd/mm/aaaa
  if (datos.fecha_nacimiento) {
    const f = datos.fecha_nacimiento.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    datos.fecha_nacimiento = f ? `${f[1].padStart(2, "0")}/${f[2].padStart(2, "0")}/${f[3]}` : datos.fecha_nacimiento;
  }

  return datos;
}

function calcularEdad(fechaDDMMAAAA, hoy = new Date()) {
  const f = String(fechaDDMMAAAA || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!f) return "";
  const nac = new Date(Number(f[3]), Number(f[2]) - 1, Number(f[1]));
  let edad = hoy.getFullYear() - nac.getFullYear();
  const mes = hoy.getMonth() - nac.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad >= 0 && edad < 120 ? String(edad) : "";
}

function titulo(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/(^|[\s\-/(])([a-záéíóúñü])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/ (De|Del|La|Las|Los|Y)(?= )/g, (m) => m.toLowerCase());
}

const ESTADO_CIVIL = { s: "soltero", c: "casado", v: "viudo", d: "divorciado", co: "conviviente" };

// Deja todo en los nombres de campo que usan las actas (persona_*)
function normalizarPersona(d) {
  const nombre = [d.nombres, d.apellido_paterno, d.apellido_materno]
    .map((x) => limpiarValor(x))
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  let estadoCivil = limpiarValor(d.estado_civil).toLowerCase();
  if (ESTADO_CIVIL[estadoCivil]) estadoCivil = ESTADO_CIVIL[estadoCivil];

  const naturalDe = titulo(
    d.natural_de ||
      d.distrito_nacimiento ||
      d.provincia_nacimiento ||
      (d.lugar_nacimiento || "").split(/[\/,-]/).pop() ||
      d.departamento_nacimiento ||
      ""
  ).trim();

  const ubicDomicilio = [d.distrito_domicilio, d.provincia_domicilio, d.departamento_domicilio]
    .map((x) => titulo(limpiarValor(x)))
    .filter(Boolean);
  let domicilio = limpiarValor(d.direccion);
  if (domicilio && ubicDomicilio.length && !domicilio.toLowerCase().includes(ubicDomicilio[0].toLowerCase())) {
    domicilio += " – " + ubicDomicilio.join(" / ");
  }

  const fechaNac = limpiarValor(d.fecha_nacimiento);
  return {
    persona_nombre: nombre,
    persona_doc_tipo: "DNI",
    persona_doc_numero: (String(d.dni || "").match(/\d{8}/) || [""])[0],
    persona_fecha_nacimiento: fechaNac,
    persona_edad: d.edad ? String(d.edad) : calcularEdad(fechaNac),
    persona_sexo: titulo(limpiarValor(d.sexo)),
    persona_natural_de: naturalDe,
    persona_estado_civil: estadoCivil,
    persona_grado_instruccion: limpiarValor(d.grado_instruccion).toLowerCase(),
    persona_nacionalidad: d.nacionalidad || "peruana",
    persona_domicilio: domicilio,
    // La ficha RENIEC no trae ocupación: queda vacía para que el efectivo la complete
    persona_ocupacion: limpiarValor(d.ocupacion || ""),
  };
}

// ---------- Extracción de texto local ----------

async function textoDePdf(buffer) {
  // Se carga el archivo interno: el index de pdf-parse 1.x intenta leer un PDF de prueba
  const pdfParse = require("pdf-parse/lib/pdf-parse.js");
  const r = await pdfParse(buffer);
  return r.text || "";
}

async function textoDeImagen(buffer) {
  const Tesseract = require("tesseract.js");
  const { data } = await Tesseract.recognize(buffer, "spa");
  return data.text || "";
}

// ---------- Lectura con Claude (opcional) ----------

const PROMPT_FICHA = `Eres un asistente que transcribe una Ficha RENIEC peruana para un acta policial.
Devuelve SOLO un objeto JSON (sin texto adicional) con estas claves, usando "" si el dato no aparece:
dni, apellido_paterno, apellido_materno, nombres, fecha_nacimiento (dd/mm/aaaa), sexo, estado_civil,
grado_instruccion, departamento_nacimiento, provincia_nacimiento, distrito_nacimiento,
direccion, distrito_domicilio, provincia_domicilio, departamento_domicilio.
Copia los datos tal como figuran; no inventes nada.`;

async function leerConClaude(buffer, mimetype) {
  const esPdf = mimetype === "application/pdf";
  const bloque = {
    type: esPdf ? "document" : "image",
    source: { type: "base64", media_type: esPdf ? "application/pdf" : mimetype, data: buffer.toString("base64") },
  };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: [bloque, { type: "text", text: PROMPT_FICHA }] }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude respondió ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json = await resp.json();
  const texto = (json.content || []).map((c) => c.text || "").join("");
  const objeto = texto.match(/\{[\s\S]*\}/);
  if (!objeto) throw new Error("Claude no devolvió datos de la ficha");
  return JSON.parse(objeto[0]);
}

// Punto de entrada usado por server.js
async function leerFicha(buffer, mimetype) {
  const tiposValidos = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!tiposValidos.includes(mimetype)) {
    throw Object.assign(new Error("Formato no soportado. Sube un PDF, JPG, PNG o WEBP."), { status: 415 });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const crudo = await leerConClaude(buffer, mimetype);
    return { metodo: "claude", persona: normalizarPersona(crudo) };
  }

  let texto = "";
  if (mimetype === "application/pdf") {
    texto = await textoDePdf(buffer);
    if (texto.replace(/\s/g, "").length < 40) {
      throw Object.assign(
        new Error(
          "Este PDF es una imagen escaneada (sin texto). Sube una foto JPG/PNG de la ficha, " +
            "o configura ANTHROPIC_API_KEY en .env para leer PDF escaneados."
        ),
        { status: 422 }
      );
    }
  } else {
    texto = await textoDeImagen(buffer);
  }

  const persona = normalizarPersona(parseFichaTexto(texto));
  if (!persona.persona_doc_numero && !persona.persona_nombre) {
    throw Object.assign(new Error("No se reconocieron datos de la ficha. Prueba con una foto más nítida."), {
      status: 422,
    });
  }
  return { metodo: mimetype === "application/pdf" ? "pdf" : "ocr", persona };
}

module.exports = { leerFicha, parseFichaTexto, normalizarPersona, calcularEdad };
