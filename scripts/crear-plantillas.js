// Genera las plantillas Word del expediente de flagrancia:
//   node scripts/crear-plantillas.js
// Cada {{etiqueta}} va en un solo "run" de Word para que docxtemplater la
// reconozca. Puedes abrir los .docx generados en Word y ajustar formato
// (logos, márgenes) sin tocar el texto entre llaves.

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle,
} = require("docx");

const OUT = path.join(__dirname, "..", "templates");
const FUENTE = "Arial";
const TAM = 22; // 11 pt

// Etiquetas de texto largo: van en letra normal (como en las actas escritas a mano)
const SIN_NEGRITA = new Set([
  "hecho_primero", "hecho_segundo", "hecho_tercero", "hecho_cuarto", "hecho_quinto",
  "especies", "base_legal", "motivo_detencion", "constatacion_detalle", "agraviado_situacion",
]);

// Convierte "texto {{tag}} texto" en runs; las etiquetas y **negritas** van en negrita
function runs(texto, opts = {}) {
  const partes = String(texto).split(/(\{\{[^}]+\}\}|\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  return partes.map((p) => {
    const esTag = /^\{\{[^#/][^}]*\}\}$/.test(p) && !SIN_NEGRITA.has(p.slice(2, -2));
    const esNegrita = /^\*\*.*\*\*$/.test(p);
    return new TextRun({
      text: esNegrita ? p.slice(2, -2) : p,
      bold: opts.bold || esTag || esNegrita,
      font: FUENTE,
      size: opts.size || TAM,
      underline: opts.underline ? {} : undefined,
    });
  });
}

function p(texto, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { after: opts.after ?? 120, line: 300 },
    children: runs(texto, opts),
  });
}

function encabezado(titulo) {
  return [
    p("MINISTERIO DEL INTERIOR", { align: AlignmentType.CENTER, after: 0, size: 18 }),
    p("POLICÍA NACIONAL DEL PERÚ", { align: AlignmentType.CENTER, after: 0, size: 18, bold: true }),
    p("{{instructor_unidad}}", { align: AlignmentType.CENTER, after: 200, size: 18 }),
    p(titulo, { align: AlignmentType.CENTER, after: 240, size: 24, bold: true, underline: true }),
  ];
}

const SIN_BORDE = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

// Fila de firmas: cada columna = [rótulo, ...líneas]
function firmas(columnas) {
  const ancho = Math.floor(100 / columnas.length);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { ...SIN_BORDE, insideHorizontal: SIN_BORDE.top, insideVertical: SIN_BORDE.top },
    rows: [
      new TableRow({
        children: columnas.map(
          ([rotulo, ...lineas]) =>
            new TableCell({
              width: { size: ancho, type: WidthType.PERCENTAGE },
              borders: SIN_BORDE,
              children: [
                p(rotulo, { align: AlignmentType.CENTER, bold: true, size: 18, after: 900 }),
                p("…………………………………", { align: AlignmentType.CENTER, after: 0, size: 18 }),
                ...lineas.map((l) => p(l, { align: AlignmentType.CENTER, after: 0, size: 18 })),
              ],
            })
        ),
      }),
    ],
  });
}

function tablaDatos(filas) {
  const borde = { style: BorderStyle.SINGLE, size: 4, color: "888888" };
  const bordes = { top: borde, bottom: borde, left: borde, right: borde };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: filas.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, borders: bordes, children: [p(k, { bold: true, after: 0, size: 20 })] }),
            new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, borders: bordes, children: [p(v, { after: 0, size: 20 })] }),
          ],
        })
    ),
  });
}

// Párrafo que desaparece por completo si la etiqueta viene vacía
// (las marcas de sección van solas en su párrafo: así docxtemplater borra todo)
function condicional(tag, texto) {
  return [p(`{{#${tag}}}`, { after: 0 }), p(texto), p(`{{/${tag}}}`, { after: 0 })];
}

const DATOS_PERSONA =
  "{{persona_nombre}} ({{persona_edad}}), natural de {{persona_natural_de}}, estado civil {{persona_estado_civil}}, " +
  "grado de instrucción {{persona_grado_instruccion}}, ocupación {{persona_ocupacion}}, identificado con " +
  "{{persona_doc_tipo}} N° {{persona_doc_numero}}, domiciliado en {{persona_domicilio}}";

const plantillas = {
  "acta_intervencion_flagrancia.docx": [
    ...encabezado("ACTA DE INTERVENCIÓN POLICIAL EN FLAGRANTE DELITO, RECOJO, INCAUTACIÓN Y LACRADO DE ESPECIES"),
    p(
      "--- En el distrito de {{distrito}}, siendo las {{hora}} horas del día {{fecha}}, el instructor " +
        "{{instructor_grado}} {{instructor_nombre}}{{#operador_nombre}}, en compañía del {{operador_grado}} " +
        "{{operador_nombre}} (operador){{/operador_nombre}}, pertenecientes a la {{instructor_unidad}}, presentes en " +
        "{{lugar_exacto}}, la persona en calidad de **DETENIDO** " + DATOS_PERSONA +
        "{{#agraviado_nombre}}, y la persona en calidad de **AGRAVIADO** {{agraviado_nombre}} ({{agraviado_edad}}), " +
        "{{agraviado_doc_tipo}} N° {{agraviado_doc_numero}}{{#agraviado_situacion}}, quien {{agraviado_situacion}}{{/agraviado_situacion}}" +
        "{{/agraviado_nombre}}, se procede a redactar la presente acta con los siguientes detalles:"
    ),
    p("**BASE LEGAL:** {{base_legal}}"),
    p("**PRIMERO:** {{hecho_primero}}"),
    p("**SEGUNDO:** {{hecho_segundo}}"),
    p("**TERCERO:** {{hecho_tercero}}"),
    ...condicional("hecho_cuarto", "**CUARTO:** {{hecho_cuarto}}"),
    ...condicional("hecho_quinto", "**QUINTO:** {{hecho_quinto}}"),
    ...condicional("especies", "**ESPECIES RECOGIDAS / INCAUTADAS:** {{especies}}"),
    p(
      "--- Siendo las {{hora_cierre}} horas del mismo día y una vez leída en voz alta, se procede a dar por " +
        "finalizada la presente diligencia, firmando en señal de conformidad los presentes.",
      { after: 360 }
    ),
    firmas([
      ["PNP INTERVINIENTE", "{{instructor_grado}} {{instructor_nombre}}", "CIP N° {{instructor_cip}}"],
      ["AGRAVIADO", "{{agraviado_nombre}}", "{{agraviado_doc_tipo}} N° {{agraviado_doc_numero}}"],
      ["DETENIDO", "{{persona_nombre}}", "{{persona_doc_tipo}} N° {{persona_doc_numero}}"],
    ]),
  ],

  "acta_detencion.docx": [
    ...encabezado("ACTA DE DETENCIÓN"),
    p(
      "--- Siendo las {{hora}} horas del día {{fecha}}, presente en {{lugar_exacto}} – {{provincia}}, por intermedio " +
        "del presente documento se le hace de conocimiento al ciudadano " + DATOS_PERSONA +
        "{{#persona_celular}}, con teléfono celular {{persona_celular}}{{/persona_celular}}, que se encuentra **DETENIDO**:"
    ),
    p("{{motivo_detencion}}"),
    p("y por tal condición, se le informa en este mismo acto que le asisten los siguientes derechos fundamentales:"),
    p("1. A que se le presuma inocente hasta que judicialmente sea declarada su responsabilidad por los hechos investigados.", { after: 40 }),
    p("2. A ser informado de las razones de su detención.", { after: 40 }),
    p("3. A ser asistido por un abogado de su elección, previa voluntad expresa o de sus familiares con el documento de apersonamiento; caso contrario, se le asignará un abogado defensor de oficio.", { after: 40 }),
    p("4. A que se le respete su integridad física y psíquica.", { after: 40 }),
    p("5. A ser examinado por un médico legista o quien haga sus veces.", { after: 40 }),
    p("6. A comunicarse telefónicamente con su familia, su representante legal u otra persona de su elección, luego de ser notificado de su detención.", { after: 40 }),
    p("7. A ser asistido por un intérprete, en caso de no hablar el idioma español."),
    p(
      "--- Una vez leída y conforme con todo su contenido, firmo e imprimo mi índice derecho en señal de " +
        "conformidad en presencia del instructor PNP que certifica."
    ),
    p(
      "--- Siendo las {{hora_cierre}} horas del mismo día, se da por concluida la presente diligencia, pasando a " +
        "firmar los presentes en señal de conformidad.",
      { after: 360 }
    ),
    firmas([
      ["INSTRUCTOR", "{{instructor_grado}} {{instructor_nombre}}", "CIP N° {{instructor_cip}}"],
      ["ENTERADO", "{{persona_nombre}}", "{{persona_doc_tipo}} N° {{persona_doc_numero}}", "(Huella)"],
    ]),
  ],

  "acta_buen_trato.docx": [
    ...encabezado("ACTA DE CONSTANCIA DE BUEN TRATO"),
    p(
      "--- Siendo las {{hora}} horas del día {{fecha}}, presente en {{lugar_exacto}}, el ciudadano " + DATOS_PERSONA +
        "{{#persona_celular}}, con teléfono celular {{persona_celular}}{{/persona_celular}}, deja constancia de haber " +
        "recibido buen trato físico y psicológico por parte del personal policial de la {{instructor_unidad}}, " +
        "durante las diversas diligencias policiales realizadas."
    ),
    p(
      "--- Siendo las {{hora_cierre}} horas del mismo día, se da por concluida la presente diligencia, firmando los " +
        "presentes en señal de conformidad.",
      { after: 360 }
    ),
    firmas([
      ["INSTRUCTOR", "{{instructor_grado}} {{instructor_nombre}}", "CIP N° {{instructor_cip}}"],
      ["ENTERADO", "{{persona_nombre}}", "{{persona_doc_tipo}} N° {{persona_doc_numero}}", "(Huella)"],
    ]),
  ],

  "acta_constatacion_vehicular.docx": [
    ...encabezado("ACTA DE CONSTATACIÓN VEHICULAR"),
    p(
      "--- En el distrito de {{distrito}}, siendo las {{hora}} horas del día {{fecha}}, presentes en {{lugar_exacto}}, " +
        "el instructor {{instructor_grado}} {{instructor_nombre}}, perteneciente a la {{instructor_unidad}}, y el " +
        "conductor " + DATOS_PERSONA +
        "{{#conductor_licencia}}, con licencia de conducir N° {{conductor_licencia}} clase/categoría " +
        "{{conductor_categoria}}{{/conductor_licencia}}, se procede a realizar la constatación del vehículo con las " +
        "siguientes características:"
    ),
    tablaDatos([
      ["PLACA", "{{vehiculo_placa}}"],
      ["CLASE", "{{vehiculo_clase}}"],
      ["MARCA / MODELO", "{{vehiculo_marca}} / {{vehiculo_modelo}}"],
      ["AÑO / COLOR", "{{vehiculo_anio}} / {{vehiculo_color}}"],
      ["N° DE MOTOR", "{{vehiculo_motor}}"],
      ["N° DE SERIE / VIN", "{{vehiculo_serie}}"],
      ["PROPIETARIO", "{{vehiculo_propietario}}"],
      ["SOAT", "{{vehiculo_soat}}"],
    ]),
    p("", { after: 120 }),
    p("**CONSTATACIÓN:** {{constatacion_detalle}}"),
    p(
      "--- Siendo las {{hora_cierre}} horas del mismo día, se da por concluida la presente diligencia, firmando los " +
        "presentes en señal de conformidad.",
      { after: 360 }
    ),
    firmas([
      ["INSTRUCTOR PNP", "{{instructor_grado}} {{instructor_nombre}}", "CIP N° {{instructor_cip}}"],
      ["CONDUCTOR", "{{persona_nombre}}", "{{persona_doc_tipo}} N° {{persona_doc_numero}}", "(Huella)"],
    ]),
  ],
};

(async () => {
  for (const [archivo, children] of Object.entries(plantillas)) {
    const doc = new Document({
      styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1418, right: 1134 } } }, children }],
    });
    fs.writeFileSync(path.join(OUT, archivo), await Packer.toBuffer(doc));
    console.log("✔ templates/" + archivo);
  }
})();
