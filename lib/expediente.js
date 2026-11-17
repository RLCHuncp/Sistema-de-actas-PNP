// Arma el "expediente" de una intervención: con los datos ingresados UNA sola
// vez (lugar, efectivos, personas, vehículo, hechos) genera la lista de
// documentos a renderizar, uno por cada acta marcada y por cada detenido.

const { fetch } = require("./http");

// Actas que se generan por cada detenido, en el orden del expediente
const ACTAS_POR_DETENIDO = [
  "intervencion_flagrancia",
  "registro_personal",
  "detencion",
  "lectura_derechos_imputado",
  "buen_trato",
];

const NOMBRE_CORTO = {
  intervencion_flagrancia: "Intervencion",
  registro_personal: "Registro personal",
  detencion: "Detencion",
  lectura_derechos_imputado: "Lectura de derechos",
  buen_trato: "Buen trato",
  constatacion_vehicular: "Constatacion vehicular",
};

const CAMPOS_PERSONA = [
  "persona_nombre", "persona_edad", "persona_natural_de", "persona_estado_civil",
  "persona_grado_instruccion", "persona_ocupacion", "persona_nacionalidad", "persona_doc_tipo",
  "persona_doc_numero", "persona_celular", "persona_email", "persona_domicilio",
];

function soloPersona(p = {}) {
  const out = {};
  for (const c of CAMPOS_PERSONA) out[c] = (p[c] || "").toString().trim();
  if (!out.persona_doc_tipo) out.persona_doc_tipo = "DNI";
  if (!out.persona_nacionalidad) out.persona_nacionalidad = "peruana";
  return out;
}

function datosAgraviado(a) {
  if (!a) return { agraviado_nombre: "" };
  return {
    agraviado_nombre: a.persona_nombre || "",
    agraviado_edad: a.persona_edad || "",
    agraviado_doc_tipo: a.persona_doc_tipo || "DNI",
    agraviado_doc_numero: a.persona_doc_numero || "",
    agraviado_ocupacion: a.persona_ocupacion || "",
    agraviado_domicilio: a.persona_domicilio || "",
    agraviado_situacion: a.situacion || "",
  };
}

// Texto por defecto del motivo de detención a partir de los delitos y el agraviado
function motivoDetencionPorDefecto(exp, agraviado) {
  const delitos = (exp.delitos_nombres || []).filter(Boolean);
  if (!delitos.length) return "";
  let txt = `Por estar inmerso en la presunta comisión del delito de ${delitos.join(" y ")}`;
  if (agraviado && agraviado.persona_nombre) {
    txt += `, en agravio de ${agraviado.persona_nombre}${agraviado.persona_edad ? ` (${agraviado.persona_edad})` : ""}`;
  }
  return (txt + ".").toUpperCase();
}

function apellidoArchivo(p) {
  const partes = (p.persona_nombre || "persona").trim().split(/\s+/);
  return partes.length >= 3 ? partes.slice(-2).join(" ") : partes.join(" ");
}

/**
 * exp = {
 *   general: { distrito, provincia, departamento, fecha, lugar_exacto, instructor_*, operador_* },
 *   personas: [{ rol: "detenido"|"agraviado"|"testigo"|"conductor", persona_*, situacion, licencia, categoria,
 *                familiar_*, solicita_*, resultado_registro, pertenencias_detalle, motivo_incautacion, ... }],
 *   vehiculo: { vehiculo_*, constatacion_detalle } | null,
 *   hechos: { hecho_primero..hecho_quinto, especies, motivo_detencion },
 *   base_legal: "texto", delitos_nombres: ["..."],
 *   actas: [{ id, hora, hora_cierre }]
 * }
 */
function armarDocumentos(exp) {
  const general = exp.general || {};
  const personas = Array.isArray(exp.personas) ? exp.personas : [];
  const hechos = exp.hechos || {};
  const actas = (exp.actas || []).filter((a) => a && a.id);
  const errores = [];

  const detenidos = personas.filter((p) => p.rol === "detenido");
  const agraviado = personas.find((p) => p.rol === "agraviado");
  const conductor = personas.find((p) => p.rol === "conductor") || detenidos[0];

  const comunes = {
    ...general,
    base_legal: exp.base_legal || "",
    ...datosAgraviado(agraviado),
    hecho_primero: hechos.hecho_primero || "",
    hecho_segundo: hechos.hecho_segundo || "",
    hecho_tercero: hechos.hecho_tercero || "",
    hecho_cuarto: hechos.hecho_cuarto || "",
    hecho_quinto: hechos.hecho_quinto || "",
    especies: hechos.especies || "",
  };
  const motivo = hechos.motivo_detencion || motivoDetencionPorDefecto(exp, agraviado);

  const documentos = [];
  let n = 1;

  const actasDetenido = actas.filter((a) => ACTAS_POR_DETENIDO.includes(a.id));
  if (actasDetenido.length && !detenidos.length) {
    errores.push("Marcaste actas de detenido pero no hay ninguna persona con rol «Detenido».");
  }

  for (const det of detenidos) {
    const persona = soloPersona(det);
    for (const acta of actasDetenido) {
      const datos = {
        ...comunes,
        ...persona,
        hora: acta.hora || "",
        hora_cierre: acta.hora_cierre || "",
        motivo_detencion: det.motivo_detencion || motivo,
        // Registro personal
        motivo_incautacion: det.motivo_incautacion || "",
        pertenencias_detalle: det.pertenencias_detalle || "",
        resultado_registro: det.resultado_registro || "",
        motivo_lugar_diligencia: det.motivo_lugar_diligencia || general.motivo_lugar_diligencia || "",
        persona_confianza_nombre: det.persona_confianza_nombre || "",
        persona_confianza_dni: det.persona_confianza_dni || "",
        persona_confianza_celular: det.persona_confianza_celular || "",
        persona_confianza_domicilio: det.persona_confianza_domicilio || "",
        // Lectura de derechos
        familiar_vinculo: det.familiar_vinculo || "",
        familiar_nombre: det.familiar_nombre || "",
        familiar_celular: det.familiar_celular || "",
        solicita_interprete: det.solicita_interprete || "NO",
        solicita_defensor_publico: det.solicita_defensor_publico || "",
        solicita_abogado_particular: det.solicita_abogado_particular || "",
        solicita_evaluacion_medica: det.solicita_evaluacion_medica || "",
      };
      documentos.push({
        tipoId: acta.id,
        nombre: `${String(n).padStart(2, "0")}. ${NOMBRE_CORTO[acta.id]} - ${apellidoArchivo(persona)}`,
        datos,
      });
      n++;
    }
  }

  const constatacion = actas.find((a) => a.id === "constatacion_vehicular");
  if (constatacion) {
    const veh = exp.vehiculo || {};
    if (!veh.vehiculo_placa) errores.push("Marcaste la constatación vehicular pero falta la placa del vehículo.");
    if (!conductor) errores.push("La constatación vehicular necesita un conductor (rol «Conductor» o un detenido).");
    const persona = soloPersona(conductor || {});
    documentos.push({
      tipoId: "constatacion_vehicular",
      nombre: `${String(n).padStart(2, "0")}. ${NOMBRE_CORTO.constatacion_vehicular} - ${veh.vehiculo_placa || "vehiculo"}`,
      datos: {
        ...comunes,
        ...persona,
        ...veh,
        conductor_licencia: (conductor && conductor.licencia) || veh.conductor_licencia || "",
        conductor_categoria: (conductor && conductor.categoria) || veh.conductor_categoria || "",
        hora: constatacion.hora || "",
        hora_cierre: constatacion.hora_cierre || "",
      },
    });
  }

  if (!documentos.length && !errores.length) errores.push("No hay actas para generar: marca al menos una.");
  return { documentos, errores };
}

// ---------- Redacción de los hechos ----------

const ORDINALES = ["hecho_primero", "hecho_segundo", "hecho_tercero", "hecho_cuarto", "hecho_quinto"];

function frase(t) {
  const s = String(t || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  return (s.endsWith(".") ? s : s + ".").toUpperCase();
}

// Sin IA: cada fila de la línea de tiempo pasa a ser un párrafo (PRIMERO, SEGUNDO, ...)
// con la hora al inicio. Lo que sobre de 5 se junta en QUINTO. Las notas sueltas
// sin hora van al PRIMERO.
function redactarBasico({ notas, linea_tiempo }) {
  const filas = (linea_tiempo || []).filter((f) => f && (f.texto || "").trim());
  const parrafos = filas.map((f) =>
    f.hora ? `SIENDO LAS ${String(f.hora).trim()} HORAS APROXIMADAMENTE, ${frase(f.texto)}` : frase(f.texto)
  );
  if ((notas || "").trim()) {
    const notasTxt = frase(notas);
    if (parrafos.length) parrafos[0] = parrafos[0] + " " + notasTxt;
    else parrafos.push(notasTxt);
  }
  const out = {};
  ORDINALES.forEach((k, i) => (out[k] = ""));
  parrafos.forEach((p, i) => {
    const k = ORDINALES[Math.min(i, 4)];
    out[k] = out[k] ? out[k] + " " + p : p;
  });
  return out;
}

const PROMPT_HECHOS = `Eres un asistente que ayuda a un efectivo de la Policía Nacional del Perú a redactar los hechos
de un Acta de Intervención Policial en flagrante delito, con el estilo formal de las actas policiales peruanas
(en MAYÚSCULAS, tercera persona, "el suscrito", horas en formato HH:MM).
Reglas estrictas:
- Usa SOLO los hechos de las notas y la línea de tiempo. No inventes nombres, lugares, horas ni objetos.
- Si falta un dato necesario, escribe [COMPLETAR].
- Divide la narración en párrafos cronológicos: PRIMERO (intervención), SEGUNDO (recojo/incautación/lacrado),
  TERCERO (detención, comunicación de derechos y puesta a disposición), CUARTO y QUINTO solo si hace falta.
Devuelve SOLO un JSON con las claves: hecho_primero, hecho_segundo, hecho_tercero, hecho_cuarto, hecho_quinto,
especies (lista breve de especies recogidas o ""), motivo_detencion (una línea o "").`;

async function redactarConClaude(entrada) {
  const contexto = {
    notas: entrada.notas || "",
    linea_tiempo: entrada.linea_tiempo || [],
    instructor: entrada.instructor || "",
    operador: entrada.operador || "",
    unidad_movil: entrada.unidad_movil || "",
    detenidos: entrada.detenidos || [],
    agraviados: entrada.agraviados || [],
    delitos: entrada.delitos || [],
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
      max_tokens: 2500,
      messages: [{ role: "user", content: PROMPT_HECHOS + "\n\nDATOS:\n" + JSON.stringify(contexto, null, 2) }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude respondió ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json = await resp.json();
  const texto = (json.content || []).map((c) => c.text || "").join("");
  const objeto = texto.match(/\{[\s\S]*\}/);
  if (!objeto) throw new Error("Claude no devolvió la redacción en el formato esperado");
  const r = JSON.parse(objeto[0]);
  const out = {};
  for (const k of [...ORDINALES, "especies", "motivo_detencion"]) out[k] = String(r[k] || "").trim();
  return out;
}

async function redactarHechos(entrada) {
  if (process.env.ANTHROPIC_API_KEY) {
    return { metodo: "claude", ...(await redactarConClaude(entrada)) };
  }
  return { metodo: "basico", ...redactarBasico(entrada) };
}

module.exports = { armarDocumentos, redactarHechos, redactarBasico, ACTAS_POR_DETENIDO };
