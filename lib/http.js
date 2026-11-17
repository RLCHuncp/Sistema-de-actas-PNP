// fetch para llamar a proveedores externos (RENIEC, placas, Claude).
// Se usa el fetch nativo de Node (18+): node-fetch v2 falla con
// "Premature close" en algunas respuestas de proveedores con Node 20/22.
// Si el Node es antiguo y no trae fetch, se usa node-fetch como respaldo.

const fetchNativo = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
const fetch = fetchNativo || require("node-fetch");

// Lee la respuesta como JSON sin romperse si el proveedor devuelve texto o HTML
async function leerJson(resp) {
  const texto = await resp.text();
  try {
    return JSON.parse(texto);
  } catch (e) {
    return { _texto: texto.slice(0, 300) };
  }
}

// Mensaje entendible a partir de una respuesta de error del proveedor
function mensajeProveedor(cuerpo) {
  if (!cuerpo) return "";
  return String(cuerpo.message || cuerpo.mensaje || cuerpo.error || cuerpo._texto || "").slice(0, 200);
}

module.exports = { fetch, leerJson, mensajeProveedor };
