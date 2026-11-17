// Prueba de punta a punta: levanta el servidor, lee una ficha (texto),
// redacta hechos sin IA y genera el expediente completo, revisando que
// ningún .docx quede con {{etiquetas}} sin reemplazar.
//   npm test

const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");
const fetch = require("node-fetch");
const PizZip = require("pizzip");
const { parseFichaTexto, normalizarPersona } = require("../lib/ficha-reniec");

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

const FICHA = `Número de DNI: 70000001
Apellido Paterno: QUISPE
Apellido Materno: ROJAS
Pre Nombres: JUAN CARLOS
Fecha de Nacimiento: 05/03/2003
Estado Civil: SOLTERO
Grado de Instrucción: SECUNDARIA INCOMPLETA
Distrito de Nacimiento: LIMA
Dirección: AV. CARRETERA PRINCIPAL N° 000
Distrito de Domicilio: PERENE`;

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const env = { ...process.env, PORT: String(PORT), AUTH_USER: "", AUTH_PASS: "", ANTHROPIC_API_KEY: "" };
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: "pipe" });
  let log = "";
  srv.stdout.on("data", (d) => (log += d));
  srv.stderr.on("data", (d) => (log += d));
  try {
    for (let i = 0; i < 40 && !log.includes("corriendo"); i++) await esperar(100);

    // 1. Ficha RENIEC (parser de texto)
    const det = normalizarPersona(parseFichaTexto(FICHA));
    assert.strictEqual(det.persona_nombre, "JUAN CARLOS QUISPE ROJAS");
    assert.strictEqual(det.persona_doc_numero, "70000001");
    assert.ok(Number(det.persona_edad) >= 23);
    console.log("✔ ficha RENIEC →", det.persona_nombre, det.persona_edad, "años");

    // 2. Subida de archivo no soportado
    const fd = new (require("form-data"))();
    fd.append("ficha", Buffer.from("hola"), { filename: "a.txt", contentType: "text/plain" });
    let r = await fetch(`${BASE}/api/ficha-reniec`, { method: "POST", body: fd });
    assert.strictEqual(r.status, 415);
    console.log("✔ rechaza formatos no soportados");

    // 3. Redacción básica
    r = await fetch(`${BASE}/api/redactar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notas: "",
        linea_tiempo: [
          { hora: "00:25", texto: "transeúntes alertan de un disparo y se interviene al sujeto" },
          { hora: "00:40", texto: "se incauta y lacra el arma de fuego, muestra 01" },
          { hora: "01:10", texto: "se comunica la detención y sus derechos" },
        ],
      }),
    });
    const hechos = await r.json();
    assert.strictEqual(hechos.metodo, "basico");
    assert.ok(hechos.hecho_primero.startsWith("SIENDO LAS 00:25"));
    assert.ok(hechos.hecho_tercero.includes("01:10"));
    console.log("✔ redacción básica PRIMERO/SEGUNDO/TERCERO");

    // 4. Expediente completo
    const expediente = {
      general: {
        distrito: "Pichanaqui", provincia: "Chanchamayo", departamento: "Junín",
        fecha: "17NOV26", lugar_exacto: "las oficinas de la Comisaría PNP Pichanaqui",
        instructor_grado: "S3 PNP", instructor_nombre: "PÉREZ GÓMEZ, Luis", instructor_cip: "31438274",
        instructor_unidad: "Comisaría PNP Pichanaqui", operador_grado: "S3 PNP", operador_nombre: "ROJAS DÍAZ, Mario",
      },
      personas: [
        { rol: "detenido", ...det, persona_ocupacion: "agricultor" },
        { rol: "agraviado", persona_nombre: "PEDRO LUIS MAMANI TORRES", persona_edad: "35", persona_doc_numero: "40000002", situacion: "se encuentra hospitalizado en el Hospital de Apoyo Pichanaqui" },
      ],
      vehiculo: { vehiculo_placa: "M1A-234", vehiculo_clase: "Motocicleta", vehiculo_color: "Rojo", constatacion_detalle: "En regular estado." },
      hechos: { ...hechos, hecho_cuarto: "", especies: "Una (01) arma de fuego artesanal, Muestra 01." },
      base_legal: "Artículo 106° del Código Penal.",
      delitos_nombres: ["Homicidio en grado de tentativa"],
      actas: [
        { id: "intervencion_flagrancia", hora: "01:05", hora_cierre: "03:40" },
        { id: "registro_personal", hora: "01:20", hora_cierre: "01:30" },
        { id: "detencion", hora: "01:45", hora_cierre: "01:50" },
        { id: "lectura_derechos_imputado", hora: "01:55", hora_cierre: "02:00" },
        { id: "buen_trato", hora: "02:00", hora_cierre: "02:05" },
        { id: "constatacion_vehicular", hora: "02:10", hora_cierre: "02:25" },
      ],
    };
    r = await fetch(`${BASE}/api/expediente/generar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expediente),
    });
    const cuerpo = await r.buffer();
    assert.strictEqual(r.status, 200, cuerpo.toString().slice(0, 300));
    const zip = new PizZip(cuerpo);
    const archivos = Object.keys(zip.files);
    assert.strictEqual(archivos.length, 6);
    for (const nombre of archivos) {
      const xml = new PizZip(zip.file(nombre).asNodeBuffer()).file("word/document.xml").asText();
      const sueltas = xml.match(/\{\{[^}]*\}\}/g);
      assert.ok(!sueltas, `${nombre} tiene etiquetas sin reemplazar: ${sueltas}`);
      const texto = xml.replace(/<[^>]+>/g, "");
      assert.ok(texto.includes("JUAN CARLOS QUISPE ROJAS"), `${nombre} no tiene el nombre del detenido`);
    }
    const intervencion = new PizZip(zip.file(archivos[0]).asNodeBuffer()).file("word/document.xml").asText().replace(/<[^>]+>/g, "");
    assert.ok(intervencion.includes("PEDRO LUIS MAMANI TORRES"));
    assert.ok(!intervencion.includes("CUARTO:"), "CUARTO vacío debería desaparecer");
    assert.ok(intervencion.includes("ESPECIES RECOGIDAS"));
    console.log("✔ expediente:", archivos.join(" | "));

    // 5. Validaciones
    r = await fetch(`${BASE}/api/expediente/generar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personas: [], actas: [{ id: "detencion" }] }),
    });
    assert.strictEqual(r.status, 400);
    console.log("✔ avisa si falta el detenido");

    if (process.env.GUARDAR_ZIP) require("fs").writeFileSync(process.env.GUARDAR_ZIP, cuerpo);
    console.log("\nTodas las pruebas pasaron.");
  } catch (e) {
    console.error("✘", e.message, "\n--- log del servidor ---\n" + log);
    process.exitCode = 1;
  } finally {
    srv.kill();
  }
})();
