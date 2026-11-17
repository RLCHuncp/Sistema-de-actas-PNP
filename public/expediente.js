// Pantalla "Expediente de flagrancia": datos una sola vez -> todas las actas.
// El estado vive en `exp` y se guarda como borrador en este navegador.

(function () {
  "use strict";

  const CLAVE_BORRADOR = "actas-pnp:expediente";
  const CLAVE_PERFIL = "actas-pnp:perfil";
  const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];

  // Actas del expediente, en orden, con su desfase (minutos) respecto a la hora de inicio
  const ACTAS = [
    { id: "intervencion_flagrancia", nombre: "Intervención en flagrancia, recojo, incautación y lacrado", ini: 0, fin: 75, porDetenido: true },
    { id: "registro_personal", nombre: "Registro personal e incautación", ini: 15, fin: 25, porDetenido: true },
    { id: "detencion", nombre: "Detención", ini: 40, fin: 45, porDetenido: true },
    { id: "lectura_derechos_imputado", nombre: "Lectura de derechos del investigado", ini: 50, fin: 55, porDetenido: true },
    { id: "buen_trato", nombre: "Constancia de buen trato", ini: 55, fin: 60, porDetenido: true },
    { id: "constatacion_vehicular", nombre: "Constatación vehicular", ini: 65, fin: 80, porDetenido: false },
  ];

  const CAMPOS_PERSONA = [
    ["persona_nombre", "Apellidos y nombres", "full"],
    ["persona_doc_tipo", "Tipo de documento"],
    ["persona_doc_numero", "N° de documento"],
    ["persona_edad", "Edad"],
    ["persona_natural_de", "Natural de"],
    ["persona_estado_civil", "Estado civil"],
    ["persona_grado_instruccion", "Grado de instrucción"],
    ["persona_ocupacion", "Ocupación"],
    ["persona_celular", "Celular"],
    ["persona_domicilio", "Domicilio", "full"],
  ];
  const CAMPOS_ROL = {
    agraviado: [["situacion", "Situación (ej. se encuentra hospitalizado en el Hospital de Apoyo …)", "full"]],
    conductor: [["licencia", "N° de licencia"], ["categoria", "Clase / categoría"]],
    detenido: [["licencia", "N° de licencia (si conducía)"], ["categoria", "Clase / categoría"]],
  };

  const CAMPOS_VEHICULO = [
    ["vehiculo_clase", "Clase"], ["vehiculo_marca", "Marca"], ["vehiculo_modelo", "Modelo"],
    ["vehiculo_anio", "Año"], ["vehiculo_color", "Color"], ["vehiculo_motor", "N° de motor"],
    ["vehiculo_serie", "N° de serie / VIN"], ["vehiculo_soat", "SOAT (aseguradora / N°)"],
    ["vehiculo_propietario", "Propietario", "full"],
  ];
  const CONSTATACION = [
    ["carroceria", "Carrocería", ["", "en buen estado", "en regular estado, con rayones", "con daños visibles"]],
    ["luces", "Luces", ["", "operativas", "inoperativas"]],
    ["llantas", "Llantas", ["", "en buen estado", "en regular estado", "en mal estado"]],
    ["soat_ok", "SOAT", ["", "presenta SOAT vigente", "no presenta SOAT"]],
    ["tarjeta_ok", "Tarjeta de propiedad", ["", "presenta tarjeta de identificación vehicular", "no presenta tarjeta de identificación vehicular"]],
  ];

  const HECHOS = [
    ["hecho_primero", "PRIMERO"], ["hecho_segundo", "SEGUNDO"], ["hecho_tercero", "TERCERO"],
    ["hecho_cuarto", "CUARTO (opcional)"], ["hecho_quinto", "QUINTO (opcional)"],
  ];

  const EXTRAS_DETENIDO = [
    ["motivo_incautacion", "Registro: motivo de la incautación", "full"],
    ["resultado_registro", "Registro: resultado (qué se encontró)", "full", "textarea"],
    ["pertenencias_detalle", "Registro: pertenencias entregadas", "full", "textarea"],
    ["persona_confianza_nombre", "Persona de confianza: nombre"],
    ["persona_confianza_dni", "Persona de confianza: DNI"],
    ["persona_confianza_celular", "Persona de confianza: celular"],
    ["persona_confianza_domicilio", "Persona de confianza: domicilio"],
    ["familiar_vinculo", "Derechos: vínculo del familiar a comunicar"],
    ["familiar_nombre", "Derechos: nombre del familiar"],
    ["familiar_celular", "Derechos: celular del familiar"],
    ["solicita_interprete", "¿Solicita intérprete?", "", "sino"],
    ["solicita_defensor_publico", "¿Solicita defensor público?", "", "sino"],
    ["solicita_abogado_particular", "¿Solicita abogado particular?", "", "sino"],
    ["solicita_evaluacion_medica", "¿Solicita evaluación médico legal?", "", "sino"],
  ];

  // ---------- Estado ----------

  function estadoVacio() {
    return {
      general: {},
      personas: [],
      vehiculo: { vehiculo_doc: {} },
      hechos: { notas: "", linea_tiempo: [{ hora: "", texto: "" }] },
      delitos: [],
      base_legal: "",
      actas: ACTAS.filter((a) => a.porDetenido).map((a) => ({ id: a.id, hora: "", hora_cierre: "" })),
      auto: {}, // rutas de campos llenados automáticamente
    };
  }

  function leerLS(clave) {
    try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch (e) { return null; }
  }
  function escribirLS(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ }
  }

  let exp = leerLS(CLAVE_BORRADOR) || estadoVacio();
  let catalogo = { delitos: [] };
  let ubigeo = null;
  let paso = 1;

  // Aplica el perfil guardado (instructor, unidad, lugar) si el borrador no lo tiene
  const perfil = leerLS(CLAVE_PERFIL) || {};
  for (const [k, v] of Object.entries(perfil)) if (!exp.general[k]) exp.general[k] = v;

  let guardarTimer = null;
  function guardar() {
    clearTimeout(guardarTimer);
    guardarTimer = setTimeout(() => escribirLS(CLAVE_BORRADOR, exp), 300);
  }

  // ---------- Utilidades ----------

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function getRuta(obj, ruta) {
    return ruta.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setRuta(obj, ruta, valor) {
    const partes = ruta.split(".");
    let o = obj;
    partes.slice(0, -1).forEach((k) => {
      if (o[k] == null) o[k] = /^\d+$/.test(k) ? [] : {};
      o = o[k];
    });
    o[partes[partes.length - 1]] = valor;
  }
  function estado(id, texto, tipo) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = texto || "";
    el.className = "estado " + (tipo || "");
  }
  function hhmmAMin(h) {
    const m = String(h || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function minAHhmm(min) {
    const t = ((min % 1440) + 1440) % 1440;
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }
  function hoyTexto() {
    const d = new Date();
    return String(d.getDate()).padStart(2, "0") + MESES[d.getMonth()] + String(d.getFullYear()).slice(2);
  }
  function ahoraTexto() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  async function leerError(resp) {
    try { return (await resp.json()).error || `Error ${resp.status}`; } catch (e) { return `Error ${resp.status}`; }
  }

  function campo(ruta, etiqueta, opts = {}) {
    const valor = getRuta(exp, ruta) || "";
    const clases = ["f"];
    if (opts.full) clases.push("full");
    if (exp.auto[ruta] && valor) clases.push("auto");
    if (opts.obligatorio && !valor) clases.push("falta");
    let control;
    if (opts.tipo === "textarea") {
      control = `<textarea data-bind="${ruta}">${esc(valor)}</textarea>`;
    } else if (opts.tipo === "sino") {
      control = `<select data-bind="${ruta}">${["", "SI", "NO"].map((o) => `<option ${o === valor ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    } else if (opts.opciones) {
      control = `<select data-bind="${ruta}">${opts.opciones.map((o) => `<option value="${esc(o)}" ${o === valor ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>`;
    } else {
      control = `<input type="text" data-bind="${ruta}" value="${esc(valor)}" ${opts.attrs || ""} />`;
    }
    const sufijo = opts.obligatorio && !valor ? " · completar" : "";
    return `<label class="${clases.join(" ")}">${esc(etiqueta)}${sufijo}${control}</label>`;
  }

  // ---------- Personas ----------

  function nuevaPersona(rol, datos, auto) {
    const p = { rol, persona_doc_tipo: "DNI", ...datos };
    exp.personas.push(p);
    const i = exp.personas.length - 1;
    if (auto) Object.keys(datos).forEach((k) => datos[k] && (exp.auto[`personas.${i}.${k}`] = true));
    guardar();
    pintarPersonas();
    pintarExtras();
  }

  function pintarPersonas() {
    const cont = $("#personas");
    if (!exp.personas.length) {
      cont.innerHTML = `<div class="card"><h2>Personas intervinientes</h2><p class="ayuda">Aún no hay personas. Sube una Ficha RENIEC, consulta un DNI o agrega a mano.</p></div>`;
      return;
    }
    cont.innerHTML = exp.personas
      .map((p, i) => {
        const campos = CAMPOS_PERSONA.map(([k, lab, full]) =>
          campo(`personas.${i}.${k}`, lab, { full: full === "full", obligatorio: k === "persona_ocupacion" && p.rol === "detenido", attrs: /doc_numero|edad|celular/.test(k) ? 'inputmode="numeric"' : "" })
        ).join("");
        const extra = (CAMPOS_ROL[p.rol] || []).map(([k, lab, full]) => campo(`personas.${i}.${k}`, lab, { full: full === "full" })).join("");
        const desdeFicha = Object.keys(exp.auto).some((r) => r.startsWith(`personas.${i}.`));
        return `<div class="card" data-persona="${i}">
          <div class="persona-head">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="rol ${esc(p.rol)}">${esc(p.rol)}</span>
              <span class="nombre">${esc(p.persona_nombre || "Sin nombre")}</span>
              ${desdeFicha ? '<span class="origen">✓ desde RENIEC</span>' : ""}
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <label class="f" style="flex-direction:row;align-items:center;gap:6px">Rol
                <select data-rol="${i}" style="min-height:34px;padding:4px 8px">
                  ${["detenido", "agraviado", "testigo", "conductor"].map((r) => `<option value="${r}" ${r === p.rol ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`).join("")}
                </select>
              </label>
              <button type="button" class="btn peligro mini" data-quitar="${i}" aria-label="Quitar persona">Quitar</button>
            </div>
          </div>
          <div class="grid">${campos}${extra}</div>
        </div>`;
      })
      .join("");
  }

  async function subirFicha(archivo) {
    if (!archivo) return;
    const rol = $("#rol-nuevo").value;
    estado("estado-ficha", `Leyendo ${archivo.name}…`, "cargando");
    const fd = new FormData();
    fd.append("ficha", archivo);
    try {
      const resp = await fetch("/api/ficha-reniec", { method: "POST", body: fd });
      if (!resp.ok) throw new Error(await leerError(resp));
      const { persona } = await resp.json();
      const datos = {};
      Object.entries(persona).forEach(([k, v]) => { if (v) datos[k] = v; });
      nuevaPersona(rol, datos, true);
      const faltan = persona.persona_ocupacion ? "" : " Completa la ocupación (no figura en la ficha).";
      estado("estado-ficha", `✓ ${persona.persona_nombre || "Ficha"} leída como ${rol}.${faltan}`, "ok");
    } catch (e) {
      estado("estado-ficha", e.message, "error");
    }
  }

  async function consultarDni() {
    const dni = $("#dni-consulta").value.trim();
    if (!/^\d{8}$/.test(dni)) return estado("estado-ficha", "El DNI debe tener 8 dígitos", "error");
    if (exp.personas.some((p) => p.persona_doc_numero === dni)) {
      return estado("estado-ficha", `El DNI ${dni} ya está en la lista de personas.`, "error");
    }
    const btn = $("#btn-dni");
    if (btn.disabled) return; // evita doble clic: cada consulta gasta créditos
    btn.disabled = true;
    estado("estado-ficha", "Consultando RENIEC…", "cargando");
    try {
      const resp = await fetch(`/api/dni/${dni}`);
      if (!resp.ok) throw new Error(await leerError(resp));
      const r = await resp.json();
      nuevaPersona($("#rol-nuevo").value, { persona_nombre: (r.nombre_completo || "").toUpperCase(), persona_doc_numero: dni }, true);
      $("#dni-consulta").value = "";
      const cache = r.desde_cache ? " (guardado, no gastó consulta)" : "";
      estado("estado-ficha", `✓ ${r.nombre_completo}${cache}. Completa los demás datos o sube su ficha.`, "ok");
    } catch (e) {
      estado("estado-ficha", e.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Vehículo ----------

  function pintarVehiculo() {
    $("#vehiculo-campos").innerHTML = CAMPOS_VEHICULO.map(([k, lab, full]) => campo(`vehiculo.${k}`, lab, { full: full === "full" })).join("");
    $("#constatacion-opciones").innerHTML = CONSTATACION.map(([k, lab, ops]) => campo(`vehiculo.vehiculo_doc.${k}`, lab, { opciones: ops })).join("");
    $("#constatacion-detalle").value = exp.vehiculo.constatacion_detalle || "";
    $("#placa").value = exp.vehiculo.vehiculo_placa || "";
  }

  function armarConstatacion() {
    const d = exp.vehiculo.vehiculo_doc || {};
    const partes = [];
    if (d.carroceria) partes.push(`carrocería ${d.carroceria}`);
    if (d.luces) partes.push(`luces ${d.luces}`);
    if (d.llantas) partes.push(`llantas ${d.llantas}`);
    let txt = partes.length ? `El vehículo presenta ${partes.join(", ")}.` : "";
    const docs = [d.soat_ok, d.tarjeta_ok].filter(Boolean);
    if (docs.length) txt += ` El conductor ${docs.join(" y ")}.`;
    exp.vehiculo.constatacion_detalle = txt.trim();
    $("#constatacion-detalle").value = exp.vehiculo.constatacion_detalle;
  }

  async function consultarPlaca() {
    const placa = ($("#placa").value || "").trim();
    if (!placa) return estado("estado-placa", "Escribe la placa", "error");
    const btn = $("#btn-placa");
    if (btn.disabled) return; // evita doble clic: cada consulta gasta créditos
    btn.disabled = true;
    estado("estado-placa", "Consultando…", "cargando");
    try {
      const resp = await fetch(`/api/placa/${encodeURIComponent(placa)}`);
      if (!resp.ok) throw new Error(await leerError(resp));
      const v = await resp.json();
      Object.entries(v).forEach(([k, val]) => {
        if (val && k.startsWith("vehiculo_")) { exp.vehiculo[k] = val; exp.auto[`vehiculo.${k}`] = true; }
      });
      guardar();
      pintarVehiculo();
      estado("estado-placa", v.desde_cache ? "✓ Datos del vehículo cargados (guardados, no gastó consulta)" : "✓ Datos del vehículo cargados", "ok");
      marcarActa("constatacion_vehicular", true);
    } catch (e) {
      estado("estado-placa", e.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Hechos ----------

  function pintarLineaTiempo() {
    const filas = exp.hechos.linea_tiempo || [];
    $("#linea-tiempo").innerHTML = filas
      .map((f, i) => `<div class="tl-fila">
        <input class="hora" type="text" placeholder="00:25" aria-label="Hora" data-bind="hechos.linea_tiempo.${i}.hora" value="${esc(f.hora)}" />
        <textarea rows="2" aria-label="Qué pasó" placeholder="Qué pasó a esa hora" data-bind="hechos.linea_tiempo.${i}.texto">${esc(f.texto)}</textarea>
        <button type="button" class="icono" data-quitar-tl="${i}" aria-label="Quitar fila">✕</button>
      </div>`)
      .join("");
  }

  function pintarHechos() {
    $("#hechos-campos").innerHTML = HECHOS.map(([k, lab]) => campo(`hechos.${k}`, lab, { full: true, tipo: "textarea" })).join("");
  }

  async function redactar() {
    const btn = $("#btn-redactar");
    btn.disabled = true;
    estado("estado-redactar", "Redactando…", "cargando");
    try {
      const det = exp.personas.filter((p) => p.rol === "detenido").map((p) => p.persona_nombre);
      const agr = exp.personas.filter((p) => p.rol === "agraviado").map((p) => p.persona_nombre);
      const resp = await fetch("/api/redactar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notas: exp.hechos.notas,
          linea_tiempo: exp.hechos.linea_tiempo,
          instructor: `${exp.general.instructor_grado || ""} ${exp.general.instructor_nombre || ""}`.trim(),
          operador: `${exp.general.operador_grado || ""} ${exp.general.operador_nombre || ""}`.trim(),
          detenidos: det,
          agraviados: agr,
          delitos: nombresDelitos(),
        }),
      });
      if (!resp.ok) throw new Error(await leerError(resp));
      const r = await resp.json();
      HECHOS.forEach(([k]) => { exp.hechos[k] = r[k] || ""; exp.auto[`hechos.${k}`] = true; });
      if (r.especies && !exp.hechos.especies) exp.hechos.especies = r.especies;
      if (r.motivo_detencion && !exp.hechos.motivo_detencion) exp.hechos.motivo_detencion = r.motivo_detencion;
      guardar();
      pintarHechos();
      $('[data-bind="hechos.especies"]').value = exp.hechos.especies || "";
      $("#motivo-detencion").value = exp.hechos.motivo_detencion || "";
      estado("estado-redactar", r.metodo === "claude" ? "✓ Redactado. Revisa cada párrafo y completa lo marcado [COMPLETAR]." : "✓ Párrafos armados desde la línea de tiempo. Revísalos y ajusta la redacción.", "ok");
    } catch (e) {
      estado("estado-redactar", e.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Delitos y base legal ----------

  function nombresDelitos() {
    return exp.delitos.map((id) => (catalogo.delitos.find((d) => d.id === id) || {}).nombre).filter(Boolean);
  }

  function pintarDelitos() {
    const filtro = ($("#buscar-delito").value || "").toLowerCase();
    $("#delitos").innerHTML = catalogo.delitos
      .filter((d) => d.id !== "otro_manual")
      .filter((d) => !filtro || (d.nombre + " " + (d.articulos_penal || []).join(" ")).toLowerCase().includes(filtro))
      .map((d) => {
        const sel = exp.delitos.includes(d.id);
        return `<label class="delito ${sel ? "sel" : ""}"><input type="checkbox" data-delito="${esc(d.id)}" ${sel ? "checked" : ""} />
          <span><b>${esc(d.nombre)}</b><small>${esc((d.articulos_penal || []).join(" · "))}</small></span></label>`;
      })
      .join("");
  }

  function actualizarBaseLegal() {
    const textos = exp.delitos.map((id) => (catalogo.delitos.find((d) => d.id === id) || {}).texto_base_legal).filter(Boolean);
    const procesal = catalogo.articulos_procesales_generales ? catalogo.articulos_procesales_generales.texto : "";
    exp.base_legal = [...textos, procesal].filter(Boolean).join(" ");
    $("#base-legal").value = exp.base_legal;

    // Motivo de detención por defecto (solo si el usuario no lo escribió a mano)
    if (!exp.motivoEditado) {
      const agr = exp.personas.find((p) => p.rol === "agraviado");
      const nombres = nombresDelitos();
      exp.hechos.motivo_detencion = nombres.length
        ? (`Por estar inmerso en la presunta comisión del delito de ${nombres.join(" y ")}` +
            (agr && agr.persona_nombre ? `, en agravio de ${agr.persona_nombre}${agr.persona_edad ? ` (${agr.persona_edad})` : ""}` : "") + ".").toUpperCase()
        : "";
      $("#motivo-detencion").value = exp.hechos.motivo_detencion;
    }
    guardar();
  }

  // ---------- Actas y revisión ----------

  function marcarActa(id, sel) {
    const ya = exp.actas.find((a) => a.id === id);
    if (sel && !ya) exp.actas.push({ id, hora: "", hora_cierre: "" });
    if (!sel && ya) exp.actas = exp.actas.filter((a) => a.id !== id);
    exp.actas.sort((a, b) => ACTAS.findIndex((x) => x.id === a.id) - ACTAS.findIndex((x) => x.id === b.id));
    recalcularHoras(false);
    guardar();
  }

  function recalcularHoras(forzar) {
    const ini = hhmmAMin(exp.general.hora_inicio);
    if (ini == null) return;
    exp.actas.forEach((a) => {
      const def = ACTAS.find((x) => x.id === a.id);
      if (forzar || !a.hora) a.hora = minAHhmm(ini + def.ini);
      if (forzar || !a.hora_cierre) a.hora_cierre = minAHhmm(ini + def.fin);
    });
  }

  function pintarActas() {
    const detenidos = exp.personas.filter((p) => p.rol === "detenido").length;
    $("#actas").innerHTML = ACTAS.map((def) => {
      const a = exp.actas.find((x) => x.id === def.id);
      const i = exp.actas.indexOf(a);
      const sufijo = def.porDetenido && detenidos > 1 ? ` <small style="color:var(--gris);font-weight:400">× ${detenidos} detenidos</small>` : "";
      return `<div class="acta ${a ? "sel" : ""}">
        <label><input type="checkbox" data-acta="${def.id}" ${a ? "checked" : ""} />${esc(def.nombre)}${sufijo}</label>
        ${a ? `<span class="horas">de <input type="text" aria-label="Hora de inicio" data-bind="actas.${i}.hora" value="${esc(a.hora)}" /> a <input type="text" aria-label="Hora de cierre" data-bind="actas.${i}.hora_cierre" value="${esc(a.hora_cierre)}" /></span>` : ""}
      </div>`;
    }).join("");
  }

  function pintarExtras() {
    const detenidos = exp.personas.map((p, i) => [p, i]).filter(([p]) => p.rol === "detenido");
    const usa = exp.actas.some((a) => a.id === "registro_personal" || a.id === "lectura_derechos_imputado");
    $("#extras-card").classList.toggle("hidden", !detenidos.length || !usa);
    $("#extras").innerHTML = detenidos
      .map(([p, i]) => `<details class="extra" ${detenidos.length === 1 ? "open" : ""}><summary>${esc(p.persona_nombre || "Detenido")}</summary>
        <div class="grid" style="margin-top:10px">${EXTRAS_DETENIDO.map(([k, lab, full, tipo]) => campo(`personas.${i}.${k}`, lab, { full: full === "full", tipo })).join("")}</div></details>`)
      .join("");
  }

  function revisiones() {
    const r = [];
    const det = exp.personas.filter((p) => p.rol === "detenido");
    const actasDet = exp.actas.filter((a) => ACTAS.find((x) => x.id === a.id).porDetenido);
    const ok = (t) => r.push([true, t]);
    const mal = (t, ir) => r.push([false, t, ir]);

    if (actasDet.length) det.length ? ok(`${det.length} detenido(s): ${det.map((p) => p.persona_nombre).join(", ")}`) : mal("Falta al menos una persona con rol «Detenido».", 1);
    det.forEach((p) => {
      const faltan = ["persona_nombre", "persona_doc_numero", "persona_edad", "persona_domicilio", "persona_ocupacion"]
        .filter((k) => !p[k]).map((k) => CAMPOS_PERSONA.find((c) => c[0] === k)[1].toLowerCase());
      if (faltan.length) mal(`${p.persona_nombre || "Detenido"}: falta ${faltan.join(", ")}.`, 1);
    });
    ["instructor_nombre", "instructor_cip", "instructor_unidad"].forEach((k) => { if (!exp.general[k]) mal("Faltan datos del instructor PNP (nombre, CIP o unidad).", 1); });
    if (!exp.general.distrito || !exp.general.fecha) mal("Falta el distrito o la fecha.", 1);
    if (exp.actas.some((a) => a.id === "intervencion_flagrancia")) {
      exp.hechos.hecho_primero && exp.hechos.hecho_segundo && exp.hechos.hecho_tercero
        ? ok("Hechos redactados (PRIMERO a TERCERO).")
        : mal("Faltan párrafos de los hechos (PRIMERO, SEGUNDO o TERCERO).", 2);
    }
    exp.base_legal ? ok("Base legal consignada.") : mal("Falta la base legal: marca el delito en el paso 2.", 2);
    if (exp.actas.some((a) => a.id === "detencion" || a.id === "lectura_derechos_imputado") && !exp.hechos.motivo_detencion) mal("Falta el motivo de la detención.", 2);
    if (exp.actas.some((a) => a.id === "constatacion_vehicular") && !exp.vehiculo.vehiculo_placa) mal("La constatación vehicular necesita la placa.", 1);

    // Horas en orden y sin cruces entre actas cortas
    const cortas = exp.actas.filter((a) => a.id !== "intervencion_flagrancia");
    let horasOk = exp.actas.every((a) => hhmmAMin(a.hora) != null && hhmmAMin(a.hora_cierre) != null);
    for (let i = 1; i < cortas.length && horasOk; i++) {
      if (hhmmAMin(cortas[i].hora) < hhmmAMin(cortas[i - 1].hora_cierre)) horasOk = false;
    }
    horasOk ? ok("Horas completas y en orden.") : mal("Revisa las horas: faltan o se cruzan entre actas.", 3);
    // Quitar duplicados
    return r.filter((x, i) => r.findIndex((y) => y[1] === x[1]) === i);
  }

  function pintarRevision() {
    $("#revision").innerHTML = revisiones()
      .map(([bien, t, ir]) => `<div class="check ${bien ? "" : "mal"}">${bien ? "✓" : "⚠"} <span>${esc(t)}${!bien && ir && ir !== paso ? ` · <a href="#" data-ir="${ir}">Ir al paso ${ir}</a>` : ""}</span></div>`)
      .join("");
  }

  async function generar() {
    const btn = $("#btn-generar");
    btn.disabled = true;
    estado("estado-generar", "Generando actas…", "cargando");
    try {
      const cuerpo = { ...exp, delitos_nombres: nombresDelitos() };
      const resp = await fetch("/api/expediente/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      if (!resp.ok) throw new Error(await leerError(resp));
      const blob = await resp.blob();
      const det = exp.personas.find((p) => p.rol === "detenido");
      const nombre = `Expediente ${(exp.general.fecha || hoyTexto())} ${det ? det.persona_nombre.split(" ").slice(-2).join(" ") : ""}`.trim() + ".zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      estado("estado-generar", `✓ Descargado: ${nombre}`, "ok");
    } catch (e) {
      estado("estado-generar", e.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Navegación ----------

  function irPaso(n) {
    paso = n;
    [1, 2, 3].forEach((i) => $(`#paso-${i}`).classList.toggle("hidden", i !== n));
    $$("header.top nav button").forEach((b) => b.classList.toggle("activo", Number(b.dataset.ir) === n));
    if (n === 2) { pintarHechos(); pintarLineaTiempo(); pintarDelitos(); }
    if (n === 3) { recalcularHoras(false); pintarActas(); pintarExtras(); pintarRevision(); }
    $("#btn-atras").classList.toggle("hidden", n === 1);
    $("#btn-siguiente").classList.toggle("hidden", n === 3);
    actualizarBarra();
    window.scrollTo(0, 0);
  }

  function actualizarBarra() {
    if (paso === 3) {
      const pend = revisiones().filter((r) => !r[0]).length;
      $("#barra-txt").innerHTML = pend ? `<b>${pend} punto(s) por revisar.</b> <span>Puedes generar igual; lo que falte saldrá en blanco.</span>` : "<b>Todo listo para generar.</b>";
    } else {
      const det = exp.personas.filter((p) => p.rol === "detenido").length;
      $("#barra-txt").innerHTML = `<b>${exp.personas.length} persona(s)</b> <span>· ${det} detenido(s) · borrador guardado en este equipo</span>`;
    }
  }

  // ---------- Ubigeo ----------

  function llenarDatalist(id, lista) {
    $(id).innerHTML = (lista || []).map((n) => `<option value="${esc(n)}"></option>`).join("");
  }
  function actualizarUbigeo() {
    if (!ubigeo) return;
    llenarDatalist("#dl-dep", ubigeo.departamentos.map((d) => d.nombre));
    llenarDatalist("#dl-prov", ubigeo.provincias[exp.general.departamento] || []);
    llenarDatalist("#dl-dist", ubigeo.distritos[`${exp.general.departamento}|${exp.general.provincia}`] || []);
  }

  // ---------- Eventos ----------

  function enlazarValores() {
    $$("[data-bind]").forEach((el) => {
      const v = getRuta(exp, el.dataset.bind);
      if (el.value !== (v || "")) el.value = v || "";
    });
  }

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.bind) return;
    let valor = el.value;
    if (/doc_numero|edad|celular|_cip|_dni$/.test(el.dataset.bind)) {
      valor = valor.replace(/\D/g, "");
      if (valor !== el.value) el.value = valor;
    }
    setRuta(exp, el.dataset.bind, valor);
    delete exp.auto[el.dataset.bind];
    const lab = el.closest("label.f");
    if (lab) { lab.classList.remove("auto"); if (valor) lab.classList.remove("falta"); }
    if (el.dataset.bind === "hechos.motivo_detencion") exp.motivoEditado = true;
    if (el.dataset.perfil !== undefined) {
      const p = leerLS(CLAVE_PERFIL) || {};
      p[el.dataset.bind.split(".").pop()] = valor;
      escribirLS(CLAVE_PERFIL, p);
    }
    if (/^general\.(departamento|provincia)$/.test(el.dataset.bind)) actualizarUbigeo();
    if (/persona_nombre$/.test(el.dataset.bind)) {
      const card = el.closest("[data-persona]");
      if (card) $(".nombre", card).textContent = valor || "Sin nombre";
    }
    if (el.dataset.bind === "general.hora_inicio") recalcularHoras(false);
    guardar();
    if (paso !== 3) actualizarBarra();
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.rol !== undefined) {
      exp.personas[Number(el.dataset.rol)].rol = el.value;
      guardar(); pintarPersonas(); pintarExtras(); actualizarBarra();
    } else if (el.dataset.delito) {
      const id = el.dataset.delito;
      exp.delitos = el.checked ? [...exp.delitos, id] : exp.delitos.filter((x) => x !== id);
      actualizarBaseLegal(); pintarDelitos();
    } else if (el.dataset.acta) {
      marcarActa(el.dataset.acta, el.checked);
      pintarActas(); pintarExtras(); pintarRevision(); actualizarBarra();
    } else if (el.dataset.bind && el.dataset.bind.startsWith("vehiculo.vehiculo_doc.")) {
      setRuta(exp, el.dataset.bind, el.value);
      armarConstatacion(); guardar();
    } else if (el.tagName === "SELECT" && el.dataset.bind) {
      setRuta(exp, el.dataset.bind, el.value); guardar();
    } else if (el.id === "archivo-ficha" || el.id === "foto-ficha") {
      subirFicha(el.files[0]);
      el.value = "";
    }
    if (paso === 3 && el.dataset.bind) { pintarRevision(); actualizarBarra(); }
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-ir], [data-quitar], [data-quitar-tl]");
    if (!t) return;
    if (t.dataset.ir) { e.preventDefault(); irPaso(Number(t.dataset.ir)); }
    if (t.dataset.quitar !== undefined) {
      const i = Number(t.dataset.quitar);
      const p = exp.personas[i];
      if (!confirmarQuitar(p)) return;
      exp.personas.splice(i, 1);
      // reindexar marcas automáticas
      const nuevo = {};
      Object.entries(exp.auto).forEach(([ruta, v]) => {
        const m = ruta.match(/^personas\.(\d+)\.(.+)$/);
        if (!m) nuevo[ruta] = v;
        else if (Number(m[1]) < i) nuevo[ruta] = v;
        else if (Number(m[1]) > i) nuevo[`personas.${Number(m[1]) - 1}.${m[2]}`] = v;
      });
      exp.auto = nuevo;
      guardar(); pintarPersonas(); pintarExtras(); actualizarBarra();
    }
    if (t.dataset.quitarTl !== undefined) {
      exp.hechos.linea_tiempo.splice(Number(t.dataset.quitarTl), 1);
      guardar(); pintarLineaTiempo();
    }
  });

  // Sin cuadros de diálogo del navegador: el botón pide un segundo clic para confirmar
  let quitarPendiente = null;
  function confirmarQuitar(p) {
    if (quitarPendiente === p) { quitarPendiente = null; return true; }
    quitarPendiente = p;
    estado("estado-ficha", `Toca «Quitar» otra vez para quitar a ${p.persona_nombre || "esta persona"}.`, "error");
    setTimeout(() => { if (quitarPendiente === p) quitarPendiente = null; }, 4000);
    return false;
  }

  // Arrastrar y soltar la ficha
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("sobre"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("sobre"); }));
  drop.addEventListener("drop", (e) => subirFicha(e.dataTransfer.files[0]));

  $("#btn-dni").addEventListener("click", consultarDni);
  $("#dni-consulta").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); consultarDni(); } });
  $("#btn-manual").addEventListener("click", () => nuevaPersona($("#rol-nuevo").value, {}, false));
  $("#btn-placa").addEventListener("click", consultarPlaca);
  $("#btn-hoy").addEventListener("click", () => { exp.general.fecha = hoyTexto(); enlazarValores(); guardar(); });
  $("#btn-ahora").addEventListener("click", () => { exp.general.hora_inicio = ahoraTexto(); recalcularHoras(false); enlazarValores(); guardar(); });
  $("#btn-tl").addEventListener("click", () => { exp.hechos.linea_tiempo.push({ hora: "", texto: "" }); guardar(); pintarLineaTiempo(); });
  $("#btn-redactar").addEventListener("click", redactar);
  $("#buscar-delito").addEventListener("input", pintarDelitos);
  $("#btn-recalcular").addEventListener("click", () => { recalcularHoras(true); guardar(); pintarActas(); pintarRevision(); actualizarBarra(); });
  $("#btn-generar").addEventListener("click", generar);
  $("#btn-siguiente").addEventListener("click", () => irPaso(Math.min(3, paso + 1)));
  $("#btn-atras").addEventListener("click", () => irPaso(Math.max(1, paso - 1)));
  let nuevoPendiente = false;
  $("#btn-nuevo").addEventListener("click", (e) => {
    if (!nuevoPendiente) {
      nuevoPendiente = true;
      e.target.textContent = "¿Borrar todo? Toca otra vez";
      setTimeout(() => { nuevoPendiente = false; e.target.textContent = "Nuevo expediente"; }, 4000);
      return;
    }
    nuevoPendiente = false;
    e.target.textContent = "Nuevo expediente";
    exp = estadoVacio();
    const pf = leerLS(CLAVE_PERFIL) || {};
    Object.assign(exp.general, pf);
    escribirLS(CLAVE_BORRADOR, exp);
    iniciarPantalla();
  });

  function iniciarPantalla() {
    pintarPersonas();
    pintarVehiculo();
    enlazarValores();
    actualizarUbigeo();
    irPaso(1);
  }

  // ---------- Inicio ----------

  async function init() {
    iniciarPantalla();
    try {
      const [cap, bl, ub] = await Promise.all([
        fetch("/api/capacidades").then((r) => r.json()),
        fetch("/api/base-legal").then((r) => r.json()),
        fetch("/api/ubigeo").then((r) => r.json()),
      ]);
      catalogo = bl;
      ubigeo = ub;
      actualizarUbigeo();
      const avisos = [];
      if (!cap.consulta_dni) avisos.push("Consulta por DNI no configurada (RENIEC_API_URL / RENIEC_API_TOKEN).");
      if (!cap.consulta_placa) avisos.push("Consulta de placa no configurada (PLACA_API_URL / PLACA_API_TOKEN): llena el vehículo a mano.");
      $("#aviso-capacidades").innerHTML = avisos.length ? `<div class="aviso" style="margin-bottom:14px">${avisos.map(esc).join("<br>")}</div>` : "";
    } catch (e) {
      $("#aviso-capacidades").innerHTML = `<div class="aviso">No se pudo cargar la configuración: ${esc(e.message)}</div>`;
    }
  }

  init();
})();
