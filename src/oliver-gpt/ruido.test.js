// ruido.test.js — GUARDIAS de la compuerta de ruido (#1505). Cada test defiende una decisión del dueño (12-oct).
//   node --test src/oliver-gpt/ruido.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidirEntrada, decidirAudio, esSoloLink, esTextoVacio, esArchivoPeligroso, debeAvisar } from './ruido.js';

const SIN_HISTORIAL = [];
const CON_HISTORIAL = [{ role: 'user', content: 'hola, quiero cotizar' }, { role: 'assistant', content: '…' }];
const env = {};

describe('#1505 primer contacto sin intención = ruido (no lead, no cerebro, no dueño)', () => {
  test('sticker, reacción, unsupported, ubicación, contacto y video en el PRIMER mensaje son ruido, con su motivo', () => {
    for (const type of ['sticker', 'reaction', 'unsupported', 'location', 'contacts', 'video']) {
      const r = decidirEntrada({ inbound: { type, text: `[${type}]` }, history: SIN_HISTORIAL, env });
      assert.equal(r.accion, 'ruido', type); assert.equal(r.motivo, `tipo_${type}`);
    }
  });
  test('texto vacío, un signo, un emoji o «k» en el primer mensaje son ruido; «hola» y «cotizar» NO (una persona escribió)', () => {
    for (const text of ['', '   ', '?', '👍', '...', 'k', 'jj']) assert.equal(decidirEntrada({ inbound: { type: 'text', text }, history: SIN_HISTORIAL, env }).accion, 'ruido', JSON.stringify(text));
    for (const text of ['hola', 'Hola!', 'cotizar', 'precio ventana', 'Buenas']) assert.equal(decidirEntrada({ inbound: { type: 'text', text }, history: SIN_HISTORIAL, env }).accion, 'seguir', text);
  });
  test('SOLO un link (TikTok, YouTube, wa.me, dominio pelado) es ruido; un link con una frase real sigue', () => {
    for (const text of ['https://vm.tiktok.com/ZMabc/', 'mira https://youtube.com/shorts/x jaja', 'https://wa.me/56912345678', 'www.ventanas.cl', 'ventanas.cl']) {
      assert.equal(esSoloLink(text), true, text);
      assert.equal(decidirEntrada({ inbound: { type: 'text', text }, history: SIN_HISTORIAL, env }).motivo, 'solo_link', text);
    }
    const r = decidirEntrada({ inbound: { type: 'text', text: 'hola, vi esta ventana https://instagram.com/p/x y quiero una igual en Temuco' }, history: SIN_HISTORIAL, env });
    assert.equal(r.accion, 'seguir');
  });
  test('imagen SIN caption en el primer contacto es ruido; con caption sigue; un audio siempre se transcribe primero', () => {
    assert.equal(decidirEntrada({ inbound: { type: 'image', text: '[image]' }, raw: { image: { id: 'm1' } }, history: SIN_HISTORIAL, env }).motivo, 'imagen_sin_texto');
    assert.equal(decidirEntrada({ inbound: { type: 'image', text: '[image]' }, raw: { image: { id: 'm1', caption: 'esta ventana, 1.2x1.5' } }, history: SIN_HISTORIAL, env }).accion, 'seguir');
    assert.equal(decidirEntrada({ inbound: { type: 'audio', text: '[audio]' }, raw: { audio: { id: 'a1' } }, history: SIN_HISTORIAL, env }).accion, 'seguir');
  });
  test('un audio de primer contacto que no dijo nada (bolsillo) es ruido; uno con palabras sigue; con historial nunca', () => {
    assert.equal(decidirAudio({ transcript: '', mediaResolved: false, history: SIN_HISTORIAL }).motivo, 'audio_sin_texto');
    assert.equal(decidirAudio({ transcript: 'eh', mediaResolved: true, history: SIN_HISTORIAL }).accion, 'ruido');
    assert.equal(decidirAudio({ transcript: 'hola quiero cotizar dos ventanas', mediaResolved: true, history: SIN_HISTORIAL }).accion, 'seguir');
    assert.equal(decidirAudio({ transcript: '', mediaResolved: false, history: CON_HISTORIAL }).accion, 'seguir');
  });
});

describe('#1505 un cliente con historial NUNCA pasa por la compuerta de ruido', () => {
  test('sticker, link solo, imagen sin caption o texto vacío de un cliente conocido siguen al cerebro como hoy', () => {
    for (const inbound of [{ type: 'sticker', text: '[sticker]' }, { type: 'text', text: 'https://youtu.be/x' }, { type: 'image', text: '[image]' }, { type: 'text', text: '👍' }]) {
      assert.equal(decidirEntrada({ inbound, raw: { image: { id: 'x' } }, history: CON_HISTORIAL, env }).accion, 'seguir', inbound.type);
    }
  });
});

describe('#1505 archivos: cuarentena', () => {
  test('ejecutables, scripts, comprimidos, apk y html NUNCA se descargan, con o sin historial; el nombre y el tipo quedan', () => {
    for (const filename of ['factura.exe', 'foto.jpg.scr', 'plano.zip', 'app.apk', 'pagina.html', 'script.js', 'instalar.bat', 'x.lnk']) {
      const r = decidirEntrada({ inbound: { type: 'document' }, raw: { document: { id: 'd', filename, mime_type: 'application/octet-stream' } }, history: CON_HISTORIAL, env });
      assert.equal(r.accion, 'cuarentena', filename); assert.equal(r.motivo, 'archivo_peligroso'); assert.equal(r.archivo.filename, filename);
    }
    assert.equal(esArchivoPeligroso({ filename: 'lista', mime: 'application/zip' }), true);
    assert.equal(esArchivoPeligroso({ filename: 'plano.pdf', mime: 'application/pdf' }), false);
    assert.equal(esArchivoPeligroso({ filename: 'ventanas.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), false);
  });
  test('un documento (pdf/excel) en el PRIMER contacto va a cuarentena sin descargar; con historial sigue como hoy (plano, Excel)', () => {
    const doc = { type: 'document' }; const raw = { document: { id: 'd', filename: 'ventanas.xlsx', mime_type: 'application/vnd.ms-excel' } };
    assert.equal(decidirEntrada({ inbound: doc, raw, history: SIN_HISTORIAL, env }).motivo, 'documento_en_primer_contacto');
    assert.equal(decidirEntrada({ inbound: doc, raw, history: CON_HISTORIAL, env }).accion, 'seguir');
  });
});

describe('#1505 guardas', () => {
  test('killswitch RUIDO_COMPUERTA=off deja pasar todo', () => {
    assert.equal(decidirEntrada({ inbound: { type: 'sticker' }, history: SIN_HISTORIAL, env: { RUIDO_COMPUERTA: 'off' } }).accion, 'seguir');
  });
  test('se contesta una vez por número cada 24 h', () => {
    const ahora = 1_700_000_000_000;
    assert.equal(debeAvisar({}, ahora), true);
    assert.equal(debeAvisar({ ruido_aviso_at: ahora - 3600_000 }, ahora), false);
    assert.equal(debeAvisar({ ruido_aviso_at: ahora - 25 * 3600_000 }, ahora), true);
  });
  test('esTextoVacio: «k», «?», «👍🏽» son vacíos; «ok» no es intención pero «sí» tampoco: ambos ≤ 2 letras → vacíos; «hola» no', () => {
    for (const t of ['k', '?', '👍🏽', 'ok', 'sí', '..']) assert.equal(esTextoVacio(t), true, t);
    for (const t of ['hola', 'si quiero', 'uno']) assert.equal(esTextoVacio(t), false, t);
  });
});
