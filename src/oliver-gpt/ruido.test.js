// ruido.test.js — GUARDIAS de la compuerta de ruido (#1505). Cada test defiende una decisión del dueño (12-oct) o una
// corrección de la compuerta (r2: Copilot + NIM, 13-oct).   node --test src/oliver-gpt/ruido.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidirEntrada, decidirAudio, esSoloLink, esTextoVacio, esArchivoPeligroso, debeAvisar } from './ruido.js';

const SIN_HISTORIAL = [];
const CON_HISTORIAL = [{ role: 'user', content: 'hola, quiero cotizar' }, { role: 'assistant', content: '…' }];
const env = {};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('#1505 primer contacto sin intención = ruido (no lead, no cerebro, no dueño)', () => {
  test('sticker y unsupported en el PRIMER mensaje son ruido, con su motivo', () => {
    for (const type of ['sticker', 'unsupported']) {
      const r = decidirEntrada({ inbound: { type, text: `[${type}]` }, history: SIN_HISTORIAL, env });
      assert.equal(r.accion, 'ruido', type); assert.equal(r.motivo, `tipo_${type}`);
    }
  });
  test('texto vacío, un signo, un emoji o «k» en el primer mensaje son ruido; «hola» y «cotizar» NO', () => {
    for (const text of ['', '   ', '?', '👍', '...', 'k', 'jj']) assert.equal(decidirEntrada({ inbound: { type: 'text', text }, history: SIN_HISTORIAL, env }).accion, 'ruido', JSON.stringify(text));
    for (const text of ['hola', 'Hola!', 'cotizar', 'precio ventana', 'Buenas']) assert.equal(decidirEntrada({ inbound: { type: 'text', text }, history: SIN_HISTORIAL, env }).accion, 'seguir', text);
  });
  test('SOLO un link (TikTok, YouTube, wa.me, dominio pelado) es ruido; un link con una frase real sigue; un CORREO no es un link', () => {
    for (const text of ['https://vm.tiktok.com/ZMabc/', 'mira https://youtube.com/shorts/x jaja', 'https://wa.me/56912345678', 'www.ventanas.cl']) {
      assert.equal(esSoloLink(text), true, text);
      assert.equal(decidirEntrada({ inbound: { type: 'text', text }, history: SIN_HISTORIAL, env }).motivo, 'solo_link', text);
    }
    assert.equal(decidirEntrada({ inbound: { type: 'text', text: 'hola, vi esta ventana https://instagram.com/p/x y quiero una igual en Temuco' }, history: SIN_HISTORIAL, env }).accion, 'seguir');
    assert.equal(esSoloLink('juan@gmail.com'), false, '[Copilot r2] un correo no es un link');
    for (const text of ['ventanas.cl', 'quiero ventanas.cl', 'cotizar en Temuco.co']) assert.equal(esSoloLink(text), false, `[Thermos r2] dominio pelado no es link: ${text}`);
    assert.equal(esSoloLink('https://a.cl y https://b.cl'), true, 'dos links sin texto siguen siendo solo link');
    assert.equal(decidirEntrada({ inbound: { type: 'text', text: 'mi correo es juan@gmail.com' }, history: SIN_HISTORIAL, env }).accion, 'seguir');
  });
  test('un audio de primer contacto que SÍ se transcribió y no dijo nada (bolsillo) es ruido; con palabras sigue; con historial nunca', () => {
    assert.equal(decidirAudio({ transcript: '', mediaResolved: true, history: SIN_HISTORIAL }).motivo, 'audio_sin_texto');
    assert.equal(decidirAudio({ transcript: 'eh', mediaResolved: true, history: SIN_HISTORIAL }).accion, 'ruido');
    assert.equal(decidirAudio({ transcript: 'hola quiero cotizar dos ventanas', mediaResolved: true, history: SIN_HISTORIAL }).accion, 'seguir');
    assert.equal(decidirAudio({ transcript: '', mediaResolved: true, history: CON_HISTORIAL }).accion, 'seguir');
  });
});

describe('#1505 r2 · lo que NO es ruido aunque sea el primer mensaje (Copilot + NIM: clientes reales lo mandan así)', () => {
  test('una foto sin texto, una ubicación, un video o un contacto SIGUEN al cerebro', () => {
    for (const type of ['image', 'location', 'video', 'contacts', 'reaction']) {
      assert.equal(decidirEntrada({ inbound: { type, text: `[${type}]` }, raw: { [type]: { id: 'm1' } }, history: SIN_HISTORIAL, env }).accion, 'seguir', type);
    }
  });
  test('un botón o un interactive (respuesta a una plantilla) siguen siempre, aunque el texto sea corto o vacío', () => {
    for (const inbound of [{ type: 'button', text: 'Sí' }, { type: 'button', text: '' }, { type: 'interactive', text: 'ok' }]) {
      assert.equal(decidirEntrada({ inbound, history: SIN_HISTORIAL, env }).accion, 'seguir', JSON.stringify(inbound));
    }
  });
  test('«ok», «sí», «no», «ya», «dale» son respuestas, no vacío (una plantilla del operador no está en el historial del bot)', () => {
    for (const text of ['ok', 'Sí', 'si', 'NO', 'ya', 'dale', 'Ok!']) {
      assert.equal(esTextoVacio(text), false, text);
      assert.equal(decidirEntrada({ inbound: { type: 'text', text }, history: SIN_HISTORIAL, env }).accion, 'seguir', text);
    }
  });
  test('un audio con la transcripción CAÍDA (mediaResolved=false) NO es ruido: el cerebro ya pide texto en ese caso', () => {
    assert.equal(decidirAudio({ transcript: '', mediaResolved: false, history: SIN_HISTORIAL }).accion, 'seguir');
  });
  test('un PDF o un Excel en el primer contacto SIGUEN (un plano real es el caso de uso); solo lo peligroso va a cuarentena', () => {
    assert.equal(decidirEntrada({ inbound: { type: 'document' }, raw: { document: { id: 'd', filename: 'plano.pdf', mime_type: 'application/pdf' } }, history: SIN_HISTORIAL, env }).accion, 'seguir');
    assert.equal(decidirEntrada({ inbound: { type: 'document' }, raw: { document: { id: 'd', filename: 'ventanas.xlsx', mime_type: XLSX } }, history: SIN_HISTORIAL, env }).accion, 'seguir');
  });
});

describe('#1505 un cliente con historial NUNCA pasa por la compuerta de ruido', () => {
  test('sticker, link solo o texto vacío de un cliente conocido siguen al cerebro como hoy', () => {
    for (const inbound of [{ type: 'sticker', text: '[sticker]' }, { type: 'text', text: 'https://youtu.be/x' }, { type: 'text', text: '👍' }]) {
      assert.equal(decidirEntrada({ inbound, history: CON_HISTORIAL, env }).accion, 'seguir', inbound.type);
    }
  });
});

describe('#1505 archivos: cuarentena', () => {
  test('ejecutables, scripts, macros de Office, comprimidos, apk, html, accesos directos NUNCA se descargan, con o sin historial; quedan id, nombre y tipo', () => {
    for (const filename of ['factura.exe', 'foto.jpg.scr', 'plano.zip', 'app.apk', 'pagina.html', 'script.js', 'instalar.bat', 'x.lnk', 'lista.xlsm', 'carta.docm', 'nota.rtf', 'ayuda.chm', 'sitio.url', 'disco.vhd', 'pack.cab', 'plano.pdf ']) {
      const r = decidirEntrada({ inbound: { type: 'document' }, raw: { document: { id: 'media-9', filename, mime_type: 'application/octet-stream' } }, history: CON_HISTORIAL, env });
      if (filename === 'plano.pdf ') { assert.equal(r.accion, 'seguir', 'un pdf con espacio final sigue (trim)'); continue; }
      assert.equal(r.accion, 'cuarentena', filename); assert.equal(r.motivo, 'archivo_peligroso');
      assert.deepEqual(r.archivo, { id: 'media-9', filename: filename.trim(), mime: 'application/octet-stream' }, '[Copilot r2] el media id queda para que el operador lo baje a mano');
    }
    assert.equal(esArchivoPeligroso({ filename: 'lista', mime: 'application/zip' }), true);
    assert.equal(esArchivoPeligroso({ filename: 'lista', mime: 'application/x-zip-compressed' }), true);
    assert.equal(esArchivoPeligroso({ filename: 'macro', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12' }), true);
  });
  test('PDF, Excel (MIME real de OOXML), Word e imágenes NO son peligrosos', () => {
    assert.equal(esArchivoPeligroso({ filename: 'plano.pdf', mime: 'application/pdf' }), false);
    assert.equal(esArchivoPeligroso({ filename: 'ventanas.xlsx', mime: XLSX }), false);
    assert.equal(esArchivoPeligroso({ filename: 'carta.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), false);
    assert.equal(esArchivoPeligroso({ filename: 'foto.jpg', mime: 'image/jpeg' }), false);
  });
});

describe('#1505 guardas', () => {
  test('killswitch RUIDO_COMPUERTA=off deja pasar todo', () => {
    assert.equal(decidirEntrada({ inbound: { type: 'sticker' }, history: SIN_HISTORIAL, env: { RUIDO_COMPUERTA: 'off' } }).accion, 'seguir');
  });
  test('se contesta una vez por número cada 24 h, con reloj aparte para la cuarentena', () => {
    const ahora = 1_700_000_000_000;
    assert.equal(debeAvisar({}, ahora), true);
    assert.equal(debeAvisar({ ruido_aviso_at: ahora - 3600_000 }, ahora), false);
    assert.equal(debeAvisar({ ruido_aviso_at: ahora - 25 * 3600_000 }, ahora), true);
    assert.equal(debeAvisar({ ruido_aviso_at: ahora - 3600_000 }, ahora, undefined, 'cuarentena_aviso_at'), true, 'el reloj del ruido no tapa el de la cuarentena');
    assert.equal(debeAvisar({ cuarentena_aviso_at: ahora - 3600_000 }, ahora, undefined, 'cuarentena_aviso_at'), false);
  });
  test('esTextoVacio: «k», «?», «👍🏽», «..» son vacíos; «hola», «uno» y las respuestas cortas no', () => {
    for (const t of ['k', '?', '👍🏽', '..', 'jm']) assert.equal(esTextoVacio(t), true, t);
    for (const t of ['hola', 'si quiero', 'uno', 'ok', 'sí']) assert.equal(esTextoVacio(t), false, t);
  });
});
