// services/voiceBridge.test.js
// ═══════════════════════════════════════════════════════════════════════════
// [2026-08-31] Prueba el CABLEADO: que el texto que sale hacia el TTS venga
// normalizado por textoParaVoz(). Este es el test que FALLA con el codigo
// viejo (mandaba `text` crudo a ElevenLabs) y PASA con el arreglo.
//
// No pega a ninguna API: se stubea global.fetch y se lee el body enviado.
// Las credenciales son de mentira, a proposito (nunca secretos reales aca).
//
// Correr:  node --test services/voiceBridge.test.js
// ═══════════════════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';

// El modulo lee process.env al importarse -> hay que setear ANTES del import.
process.env.VOICE_ENABLED = 'true';
process.env.VOICE_TTS_PROVIDER = 'elevenlabs';
process.env.ELEVENLABS_API_KEY = 'test-no-es-una-key-real';
process.env.ELEVENLABS_VOICE_ID = 'voz-de-prueba';

const { synthesizeVoiceBuffer } = await import('./voiceBridge.js');

// Captura el texto que se le manda al proveedor y devuelve un audio falso.
function stubFetch(capturado) {
  const original = global.fetch;
  global.fetch = async (_url, opts) => {
    capturado.body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'audio/ogg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      text: async () => '',
    };
  };
  return () => { global.fetch = original; };
}

test('el monto va como palabras al TTS, no en digitos', async () => {
  const cap = {};
  const restore = stubFetch(cap);
  try {
    const out = await synthesizeVoiceBuffer({
      text: 'Marcelo, la cotizacion quedo en $6.200.000',
      waId: 'test',
    });
    assert.ok(out && out.buffer, 'deberia devolver audio');
    assert.equal(cap.body.text, 'Marcelo, la cotizacion quedo en seis millones doscientos mil pesos');
    assert.ok(!cap.body.text.includes('6.200.000'), 'no debe quedar el numero en digitos');
  } finally {
    restore();
  }
});

test('telefono y medida llegan intactos al TTS', async () => {
  const cap = {};
  const restore = stubFetch(cap);
  try {
    await synthesizeVoiceBuffer({
      text: 'Ventana 1500x1200, te llamo al +56957296035',
      waId: 'test',
    });
    assert.equal(cap.body.text, 'Ventana 1500x1200, te llamo al +56957296035');
  } finally {
    restore();
  }
});

test('emojis y markdown no llegan al TTS', async () => {
  const cap = {};
  const restore = stubFetch(cap);
  try {
    await synthesizeVoiceBuffer({ text: '✅ *Listo* Marcelo', waId: 'test' });
    assert.equal(cap.body.text, 'Listo Marcelo');
  } finally {
    restore();
  }
});

test('texto que queda vacio tras limpiar no llama al proveedor', async () => {
  let llamado = false;
  const original = global.fetch;
  global.fetch = async () => { llamado = true; throw new Error('no deberia llamar'); };
  try {
    const out = await synthesizeVoiceBuffer({ text: '👍', waId: 'test' });
    assert.equal(out, null);
    assert.equal(llamado, false);
  } finally {
    global.fetch = original;
  }
});
