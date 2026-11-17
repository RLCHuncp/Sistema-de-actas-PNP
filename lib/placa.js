// Consulta los datos de un vehículo por placa mediante un proveedor externo
// configurable en .env (PLACA_API_URL y PLACA_API_TOKEN), igual que la
// consulta de DNI. SUNARP no ofrece una API pública abierta; se usa un
// intermediario. La respuesta se normaliza a los campos vehiculo_* de las actas.

const fetch = require("node-fetch");

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

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw Object.assign(new Error(`El proveedor de placas respondió ${resp.status}`), { status: resp.status });
  return normalizarVehiculo(await resp.json(), placa);
}

module.exports = { consultarPlaca, normalizarVehiculo, normalizarPlaca };
