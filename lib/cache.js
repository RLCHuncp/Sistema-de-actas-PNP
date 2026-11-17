// Guarda en disco las consultas ya hechas a proveedores pagados (DNI, placa)
// para que repetir la misma búsqueda no gaste créditos.
//
// - Archivo: data/cache-consultas.json (excluido de git, contiene datos personales).
// - Vigencia: CACHE_DIAS en .env (por defecto 30 días). CACHE_DIAS=0 lo desactiva.
// - Solo se guardan respuestas exitosas; los errores nunca se guardan.

const fs = require("fs");
const path = require("path");

const ARCHIVO = process.env.CACHE_ARCHIVO || path.join(__dirname, "..", "data", "cache-consultas.json");
const MAX_ENTRADAS = 2000;

let memoria = null;

function dias() {
  const d = Number(process.env.CACHE_DIAS ?? 30);
  return Number.isFinite(d) && d >= 0 ? d : 30;
}

function cargar() {
  if (memoria) return memoria;
  try {
    memoria = JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
  } catch (e) {
    memoria = {};
  }
  return memoria;
}

function guardarDisco() {
  try {
    fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
    const tmp = ARCHIVO + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(memoria));
    fs.renameSync(tmp, ARCHIVO);
  } catch (e) {
    console.error("No se pudo guardar la caché de consultas:", e.message);
  }
}

function obtener(clave) {
  if (dias() === 0) return null;
  const c = cargar();
  const e = c[clave];
  if (!e) return null;
  if (Date.now() - e.t > dias() * 86400000) {
    delete c[clave];
    guardarDisco();
    return null;
  }
  return e.v;
}

function guardar(clave, valor) {
  if (dias() === 0) return;
  const c = cargar();
  c[clave] = { t: Date.now(), v: valor };
  // Si crece demasiado, se descartan las más antiguas
  const claves = Object.keys(c);
  if (claves.length > MAX_ENTRADAS) {
    claves
      .sort((a, b) => c[a].t - c[b].t)
      .slice(0, claves.length - MAX_ENTRADAS)
      .forEach((k) => delete c[k]);
  }
  guardarDisco();
}

// Evita que dos clics seguidos con la misma clave hagan dos llamadas pagadas:
// la segunda espera el resultado de la primera.
const enCurso = new Map();

async function conCache(clave, consultar) {
  const previo = obtener(clave);
  if (previo) return { ...previo, desde_cache: true };
  if (enCurso.has(clave)) return enCurso.get(clave);
  const promesa = (async () => {
    try {
      const valor = await consultar();
      guardar(clave, valor);
      return { ...valor, desde_cache: false };
    } finally {
      enCurso.delete(clave);
    }
  })();
  enCurso.set(clave, promesa);
  return promesa;
}

function limpiar() {
  memoria = {};
  guardarDisco();
}

module.exports = { conCache, obtener, guardar, limpiar, ARCHIVO };
