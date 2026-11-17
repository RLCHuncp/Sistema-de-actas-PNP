// Consulta los datos de un vehículo por placa mediante un proveedor externo
// configurable en .env (PLACA_API_URL y PLACA_API_TOKEN), igual que la
// consulta de DNI. SUNARP no ofrece una API pública abierta; se usa un
// intermediario. La respuesta se normaliza a los campos vehiculo_* de las actas.

const { fetch, leerJson, mensajeProveedor } = require("./http");

function normalizarPlaca(placa) {
  const p = String(placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{5,7}$/.test(p)) return null;
  return p.length === 6 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

function primero(obj, claves) {
  for (const k of claves) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") return String(obj[k]).trim();
  }
  return "";
}

function normalizarVehiculo(raw, placa) {
  const d =
    (raw && typeof raw.data === "object" && raw.data) ||
    (raw && typeof raw.result === "object" && raw.result) ||
    raw ||
    {};
  const propietarios = Array.isArray(d.propietarios)
    ? d.propietarios.map((p) => p.nombre || p.name || p).join(", ")
    : primero(d, ["propietario", "propietarios", "owner", "titular"]);
  return {
    vehiculo_placa: primero(d, ["placa", "plate"]) || placa,
    vehiculo_clase: primero(d, ["clase", "categoria", "tipo", "class"]),
    vehiculo_marca: primero(d, ["marca", "brand", "make"]),
    vehiculo_modelo: primero(d, ["modelo", "model"]),
    vehiculo_anio: primero(d, ["anio", "año", "ano", "anio_modelo", "year"]),
    vehiculo_color: primero(d, ["color"]),
    vehiculo_motor: primero(d, ["motor", "numero_motor", "nro_motor", "engine"]),
    vehiculo_serie: primero(d, ["serie", "numero_serie", "vin", "nro_serie"]),
    vehiculo_propietario: propietarios,
    vehiculo_estado: primero(d, ["estado", "status"]),
  };
}

async function consultarPlaca(placaIngresada) {
  const placa = normalizarPlaca(placaIngresada);
  if (!placa) throw Object.assign(new Error("Placa no válida"), { status: 400 });

  const apiUrl = process.env.PLACA_API_URL;
  const apiToken = process.env.PLACA_API_TOKEN;
  if (!apiUrl || !apiToken) {
    throw Object.assign(
      new Error("Consulta de placa no configurada. Define PLACA_API_URL y PLACA_API_TOKEN en .env, o llena los datos a mano."),
      { status: 501 }
    );
  }

  const usaTokenEnUrl = apiUrl.includes("{token}");
  const url = apiUrl
    .replace("{placa}", encodeURIComponent(placa.replace("-", "")))
    .replace("{token}", encodeURIComponent(apiToken));
  const headers = { Accept: "application/json" };
  if (!usaTokenEnUrl) headers.Authorization = `Bearer ${apiToken}`;

  let resp;
  try {
    resp = await fetch(url, { headers });
  } catch (e) {
    throw Object.assign(new Error(`No se pudo conectar con el proveedor de placas (${e.message})`), { status: 502 });
  }
  const cuerpo = await leerJson(resp);
  if (!resp.ok || cuerpo.success === false || (cuerpo.status && Number(cuerpo.status) >= 400)) {
    const detalle = mensajeProveedor(cuerpo);
    const estado = resp.ok ? Number(cuerpo.status) || 404 : resp.status;
    let msg = `El proveedor de placas respondió ${estado}${detalle ? `: ${detalle}` : ""}`;
    if (estado === 401 || estado === 403) msg += " (revisa el token o si tu plan incluye consulta de placas)";
    if (estado === 404) msg = `No se encontraron datos para la placa ${placa}${detalle ? ` (${detalle})` : ""}`;
    throw Object.assign(new Error(msg), { status: estado >= 400 && estado < 600 ? estado : 502 });
  }
  const vehiculo = normalizarVehiculo(cuerpo, placa);
  if (!vehiculo.vehiculo_marca && !vehiculo.vehiculo_modelo && !vehiculo.vehiculo_serie) {
    throw Object.assign(new Error(`No se encontraron datos para la placa ${placa}`), { status: 404 });
  }
  return vehiculo;
}

module.exports = { consultarPlaca, normalizarVehiculo, normalizarPlaca };
