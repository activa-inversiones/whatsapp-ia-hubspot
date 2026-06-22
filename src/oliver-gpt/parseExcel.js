// src/oliver-gpt/parseExcel.js
//
// Lee un Excel (.xlsx) entrante del cliente y extrae la LISTA DE VENTANAS para cotizar.
// Sin dependencias nuevas: el .xlsx es un ZIP; se descomprime con zlib nativo (Node 18+).
//
// Objetivo (caso real Yarett, 22-jun-2026): el cliente manda el cuadro de ventanas en Excel;
// Oliver debe LEERLO y cotizar TODO, en vez de pedir que lo reescriba a mano.
//
// Devuelve { ok, items: [{ categoria, cantidad, ancho_cm, alto_cm, material }], promptText }.
// promptText = texto listo para inyectar como mensaje del cliente al cerebro (con unidades EXPLÍCITAS
// en cm para evitar el bug cm/mm) + instrucción de cotizar todo de una y entregar.

import zlib from 'zlib';

function unzipEntries(buf) {
  // localizar End Of Central Directory
  let eo = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; } }
  if (eo < 0) throw new Error('xlsx: EOCD no encontrado');
  const cdOff = buf.readUInt32LE(eo + 16), nEnt = buf.readUInt16LE(eo + 10);
  const files = {}; let p = cdOff;
  for (let k = 0; k < nEnt; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const fnl = buf.readUInt16LE(p + 28), efl = buf.readUInt16LE(p + 30), cml = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fnl);
    const lfnl = buf.readUInt16LE(lho + 26), lefl = buf.readUInt16LE(lho + 28), dso = lho + 30 + lfnl + lefl;
    const raw = buf.subarray(dso, dso + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    p += 46 + fnl + efl + cml;
  }
  return files;
}

function colNum(ref) { const m = (ref || '').match(/^([A-Z]+)/); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function sheetRows(files) {
  const ss = [];
  (files['xl/sharedStrings.xml'] || '').replace(/<si>([\s\S]*?)<\/si>/g, (m, inner) => { let s = ''; inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, t) => { s += t; return ''; }); ss.push(unesc(s)); return ''; });
  const sheetName = Object.keys(files).find((f) => /xl\/worksheets\/sheet1\.xml/.test(f)) || Object.keys(files).find((f) => /xl\/worksheets\/sheet\d+\.xml/.test(f));
  const rows = [];
  (files[sheetName] || '').replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (m, inner) => {
    const cells = [];
    inner.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (mm, attrs, body) => {
      const tm = attrs.match(/\st="([^"]*)"/), t = tm ? tm[1] : null;
      const rm = attrs.match(/\sr="([^"]*)"/), ci = rm ? colNum(rm[1]) : cells.length;
      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      let val = '';
      if (vm) { val = (t === 's') ? (ss[+vm[1]] ?? '') : vm[1]; }
      else { const im = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); if (im) val = unesc(im[1]); }
      cells[ci] = (val || '').toString().trim();
      return '';
    });
    rows.push(cells);
    return '';
  });
  return rows;
}

const num = (v) => { const m = (v || '').toString().replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

// Mapea la categoría/apertura del Excel a un término claro de apertura.
function aperturaDe(texto) {
  const t = (texto || '').toLowerCase();
  if (/puerta/.test(t)) return 'puerta';
  if (/corred/.test(t)) return 'ventana corredera';
  if (/oscilo/.test(t)) return 'ventana oscilobatiente';
  if (/proyect/.test(t)) return 'ventana proyectante';
  if (/abat|batiente/.test(t)) return 'ventana abatible';
  if (/fij/.test(t)) return 'ventana fija';
  return texto || '';
}

/**
 * Extrae la lista de ventanas de un buffer .xlsx.
 * @param {Buffer} buffer
 * @returns {{ ok:boolean, items?:Array, promptText?:string, reason?:string }}
 */
export function parseExcelWindows(buffer) {
  let rows;
  try { rows = sheetRows(unzipEntries(buffer)); } catch (e) { return { ok: false, reason: 'parse_error:' + (e.message || e) }; }
  if (!rows || !rows.length) return { ok: false, reason: 'sin_filas' };

  // localizar la fila de encabezado: la que tiene ANCHO y ALTO (y tipo/categoría)
  let hi = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map((c) => (c || '').toString().toLowerCase());
    const idxAncho = r.findIndex((c) => /ancho/.test(c));
    const idxAlto = r.findIndex((c) => /alto/.test(c));
    if (idxAncho >= 0 && idxAlto >= 0) {
      hi = i;
      col.ancho = idxAncho; col.alto = idxAlto;
      col.cat = r.findIndex((c) => /categor|apertura|product|ventana|puerta/.test(c));
      col.cant = r.findIndex((c) => /cant|n°|nº|qty|unidad/.test(c));
      col.tipo = r.findIndex((c) => /\btipo\b|material|vidrio|termo/.test(c));
      break;
    }
  }
  if (hi < 0) return { ok: false, reason: 'sin_encabezado' };

  const items = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const ancho_cm = num(r[col.ancho]);
    const alto_cm = num(r[col.alto]);
    if (!ancho_cm || !alto_cm) continue; // fila sin medidas → no es item
    const categoria = col.cat >= 0 ? (r[col.cat] || '') : '';
    const cantidad = (col.cant >= 0 ? num(r[col.cant]) : null) || 1;
    const material = col.tipo >= 0 ? (r[col.tipo] || '') : '';
    items.push({ categoria, apertura: aperturaDe(categoria), cantidad, ancho_cm, alto_cm, material });
  }
  if (!items.length) return { ok: false, reason: 'sin_items' };

  // texto para el cerebro: lista con unidades EXPLÍCITAS en cm + instrucción de cotizar todo y entregar.
  const lineas = items.map((it, n) =>
    `${n + 1}. ${it.apertura || it.categoria} — ${it.ancho_cm}×${it.alto_cm} cm — cantidad ${it.cantidad}${it.material ? ` — ${it.material}` : ''}`);
  const promptText =
    'El cliente adjuntó un Excel con su lista de ventanas/puertas para cotizar. Ya la leí — acá está ' +
    '(MEDIDAS EN CENTÍMETROS, convertí a mm multiplicando ×10 al cotizar):\n' +
    lineas.join('\n') +
    '\n\nCotiza TODAS de inmediato con calcular_cotizacion (una por una para ir sumando) y entrega UN SOLO PDF con el total. ' +
    'Usa el color que el cliente ya indicó (si no lo indicó, pregúntalo UNA vez junto con la entrega, no frenes la cotización). ' +
    'Si alguna medida supera el estándar de fábrica, el motor la marca como REFERENCIAL: cotízala IGUAL y avisa que se confirma ' +
    'en la visita técnica — NO pidas confirmar medidas antes de cotizar, NO frenes la propuesta.';

  return { ok: true, items, promptText };
}
