// services/informesThermal.js — los informes PDF se piden a ACTIVA THERMAL (2026-10-17).
// ═══════════════════════════════════════════════════════════════════════════════════════════
// Decision del dueno (17-oct, textual): *"solo debemos implementar lo mismo en thermal y listo y
// cambiar como llamar Oliver: antes a activa, ahora a thermal en las rutas"*.
//
// Mismo NOMBRE y misma FIRMA que los generadores locales (generarInformeTermicoPdf /
// generarInformeVientosPdf): webhook.js solo cambia de donde los importa. THERMAL corre el MISMO
// codigo (trasladado 1:1, hashes en activa-thermal/informes_pdf/ORIGEN.md) y le agrega la marca
// ACTIVA THERMAL en la cabecera.
//
//   POST {THERMAL_API_URL}/api/v1/informes/termico.pdf   (CM-FR-006)
//   POST {THERMAL_API_URL}/api/v1/informes/vientos.pdf   (CM-FR-007)
//
// Contrato de vuelta (igual que el generador local):
//   Buffer  → el PDF
//   null    → THERMAL respondio 422 = no hay dato duro que reportar (el local tambien daba null)
//
// RESPALDO: si THERMAL no contesta (caido, timeout, 5xx, sin Node), se usa el generador LOCAL de
// siempre y se deja un log `[informes] RESPALDO LOCAL` para medir cuantas veces pasa. Es una red
// de seguridad TRANSITORIA: con cero respaldos en el periodo que el dueno defina, el generador
// local se retira y queda una sola verdad (THERMAL). El respaldo usa los MISMOS generadores con la
// MISMA cabecera ACTIVA THERMAL (services/marcaThermal.js, copia del de THERMAL): el cliente no ve
// dos marcas. Timeout del bot (30 s) > el de THERMAL (25 s): THERMAL corta antes y no cobra un PDF
// que el bot ya descarto.
//
// INFORMES_DESDE_THERMAL=0 apaga la ruta nueva (vuelve 100% al local) sin redeploy de codigo.
import { generarInformeTermicoPdf as termicoLocal } from './informeTermicoPdf.js';
import { generarInformeVientosPdf as vientosLocal } from './informeVientosPdf.js';

const URL_BASE = () => (process.env.THERMAL_API_URL || 'https://activa-thermal-production.up.railway.app').replace(/\/$/, '');
const TIMEOUT_MS = () => Number(process.env.THERMAL_INFORMES_TIMEOUT_MS || 30000);
const ACTIVO = () => String(process.env.INFORMES_DESDE_THERMAL ?? '1').trim() !== '0';

/** Buffers → {"__b64__": "..."} (convencion explicita de informes_pdf/render.mjs). */
export function serializarBinarios(v) {
  if (Buffer.isBuffer(v)) return { __b64__: v.toString('base64') };
  if (v instanceof Uint8Array) return { __b64__: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(serializarBinarios);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = serializarBinarios(x);
    return out;
  }
  return v;
}

/** Pide el PDF a THERMAL. Devuelve {pdf} | {sinDatos:true} | {error} — nunca lanza. */
export async function pedirPdfAThermal(tipo, datos, opciones, { fetchImpl = fetch } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS());
  try {
    const h = { 'Content-Type': 'application/json' };
    if (process.env.THERMAL_API_KEY) h['X-API-Key'] = process.env.THERMAL_API_KEY;
    const r = await fetchImpl(`${URL_BASE()}/api/v1/informes/${tipo}.pdf`, {
      method: 'POST', headers: h, signal: ctl.signal,
      body: JSON.stringify({ datos: serializarBinarios(datos), opciones: serializarBinarios(opciones) }),
    });
    if (r.status === 422) return { sinDatos: true };
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') return { error: 'la respuesta no es un PDF' };
    return { pdf: buf };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? `timeout ${TIMEOUT_MS()} ms` : String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function conRespaldo(tipo, local, datos, opciones, deps = {}) {
  if (!ACTIVO()) return local(datos, opciones);
  const res = await pedirPdfAThermal(tipo, datos, opciones, deps);
  if (res.pdf) return res.pdf;
  if (res.sinDatos) return null;
  if (/^HTTP (401|403|429)$/.test(res.error || '')) {
    // Thermos 17-oct: un RECHAZO no es una caida — es la key mal puesta, sin permiso de emisor o la
    // cuota agotada. Si se tratara igual que una caida, el 100 % saldria del respaldo sin que nadie lo note.
    console.error(`[informes] ALERTA THERMAL RECHAZO ${tipo}: ${res.error} — revisar THERMAL_API_KEY / INFORMES_EMISOR_CLIENTES / cuota`);
  }
  console.warn(`[informes] RESPALDO LOCAL ${tipo} folio=${opciones?.numeroInforme || '-'}: ${res.error}`);
  return local(datos, opciones);
}

export function generarInformeTermicoPdf(datos, opciones = {}) {
  return conRespaldo('termico', termicoLocal, datos, opciones);
}

export function generarInformeVientosPdf(datos, opciones = {}) {
  return conRespaldo('vientos', vientosLocal, datos, opciones);
}

export const _paraTests = { conRespaldo };
