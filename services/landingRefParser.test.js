// landingRefParser.test.js — [#966 2026-09-27] GUARDIA del parser REAL de la referencia de landing.
// Antes ningún test lo ejercía: los dos tests del webhook lo mockeaban (Codex/CodeGraph, relevamiento #966).
// Fija: el regex acepta/rechaza lo medido en producción; la clasificación del primer mensaje; el uuid
// determinístico del quote_started (landing_events.event_id es uuid: el texto 'oliver_wa_…' fallaba SIEMPRE);
// y que el texto de un botón sin frase no deja a Oliver callado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLandingRef, clasificarPrimerMensaje, esTextoDeLanding, tieneTagRoto, limpiarTagRoto, quoteStartedEventId, buildLandingLeadPayload, TEXTO_SOLO_REF, BODY_SOLO_REF, INACTIVIDAD_RECLASIFICAR_MS, VERSION } from './landingRefParser.js';

const UUID = '3fbf86b0-1234-4abc-9def-0123456789ab';

test('#966 · parseLandingRef: acepta el tag completo en cualquier posición y con mayúsculas; rechaza lo mutilado', () => {
  assert.equal(VERSION, '1.2.0');
  assert.deepEqual(parseLandingRef(`Hola, vi su web y quiero cotizar ventanas pvc en Temuco [Ref:${UUID}]`), { hasRef: true, leadId: UUID, cleanText: 'Hola, vi su web y quiero cotizar ventanas pvc en Temuco' });
  assert.deepEqual(parseLandingRef(`[REF:${UUID.toUpperCase()}] hola`), { hasRef: true, leadId: UUID, cleanText: 'hola' }, 'insensible a mayúsculas, uuid en minúsculas');
  assert.deepEqual(parseLandingRef(` [Ref:${UUID}]`), { hasRef: true, leadId: UUID, cleanText: '' }, 'botón sin frase: solo el tag ⇒ texto vacío');
  for (const roto of [`[Ref:${UUID}`, `[Ref:3fbf86b0-1234-Balor venta 4abc-9def-0123456789ab]`, `[Ref:3fbf86b0-1234-4abc-9def-0123456789a]`, `[Ref: ${UUID}]`, `Ref:${UUID}`]) {
    assert.equal(parseLandingRef(roto).hasRef, false, `no captura un tag roto: ${roto}`);
  }
  assert.deepEqual(parseLandingRef(''), { hasRef: false, leadId: null, cleanText: '' });
  assert.deepEqual(parseLandingRef(null), { hasRef: false, leadId: null, cleanText: '' });
});

test('#966 · clasificarPrimerMensaje: los seis estados medidos en producción', () => {
  assert.equal(clasificarPrimerMensaje(`Hola Activa, quiero cotizar ventanas de PVC. [Ref:${UUID}]`), 'con_ref');
  assert.equal(clasificarPrimerMensaje(`Quiero una corredera [Ref:${UUID}]`), 'con_ref', 'texto propio + tag también es con_ref');
  assert.equal(clasificarPrimerMensaje(` [Ref:${UUID}]`), 'solo_ref', 'nav/menú móvil: solo el tag');
  assert.equal(clasificarPrimerMensaje(`Hola [Ref:${UUID}`), 'ref_mutilada', 'sin el ] final');
  assert.equal(clasificarPrimerMensaje('Hola [Ref:c5ff3f7f-d8ef-Balor venta 4cc3-9def-0123456789ab]'), 'ref_mutilada', 'texto insertado adentro');
  assert.equal(clasificarPrimerMensaje('Hola, vi su web y quiero cotizar ventanas pvc en Temuco'), 'texto_landing_sin_ref', 'frase WordPress sin tag');
  assert.equal(clasificarPrimerMensaje('Hola Activa, quiero cotizar ventanas de PVC en Temuco.'), 'texto_landing_sin_ref', 'frase V3 sin tag');
  assert.equal(clasificarPrimerMensaje('hola, necesito cotizar ventanas pvc en villarrica'), 'texto_landing_sin_ref', 'variante «necesito» vista 11 veces');
  assert.equal(clasificarPrimerMensaje('¡Hola! Quiero más información'), 'otro_texto', 'el texto por defecto de Meta CTWA NO es de la web');
  assert.equal(clasificarPrimerMensaje('hola'), 'otro_texto');
  assert.equal(clasificarPrimerMensaje('   '), 'vacio'); assert.equal(clasificarPrimerMensaje(undefined), 'vacio');
  assert.equal(esTextoDeLanding('Hola, vi su web y quiero cotizar vidrio templado en Pucón'), true); assert.equal(esTextoDeLanding('Hola, quiero saber precios'), false);
  assert.equal(tieneTagRoto(`[Ref:${UUID}]`), false, 'un tag sano no es roto'); assert.equal(tieneTagRoto('[ref: 1234'), true);
  assert.equal(limpiarTagRoto(`Hola [Ref:${UUID.slice(0, 20)}`), 'Hola', 'el tag roto se quita del texto'); assert.equal(limpiarTagRoto(`Hola [Ref:${UUID}]`), `Hola [Ref:${UUID}]`, 'un tag sano no se toca acá (lo maneja parseLandingRef)');
  assert.ok(BODY_SOLO_REF.startsWith('[') && !BODY_SOLO_REF.includes('Salúdelo'), 'el marcador para el operador no es la instrucción al LLM'); assert.equal(INACTIVIDAD_RECLASIFICAR_MS, 7 * 86400000);
});

test('#966 · quoteStartedEventId: uuid válido, determinístico por lead, distinto entre leads', () => {
  const a = quoteStartedEventId(UUID), b = quoteStartedEventId(UUID.toUpperCase()), c = quoteStartedEventId('00000000-0000-4000-8000-000000000000');
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'uuid v5 con variante RFC 4122: entra en landing_events.event_id (tipo uuid)');
  assert.equal(a, b, 'mismo lead ⇒ mismo event_id (ON CONFLICT DO NOTHING dedupe)'); assert.notEqual(a, c);
  assert.ok(!a.startsWith('oliver_wa_'), 'el prefijo de texto que reventaba el cast quedó atrás');
});

test('#966 · el marcador del botón sin frase es NEUTRO (no una instrucción) y buildLandingLeadPayload lleva landing_ref y ref_status', () => {
  // [r3 · Codex A + Gemini A] la instrucción en tercera persona quedaba en el historial con rol user y el LLM podía citarla
  assert.equal(TEXTO_SOLO_REF, BODY_SOLO_REF, 'el LLM y el operador ven el MISMO marcador'); assert.ok(BODY_SOLO_REF.startsWith('[') && BODY_SOLO_REF.endsWith(']')); assert.doesNotMatch(BODY_SOLO_REF, /salúdelo|pregúntele/i, 'sin instrucción adentro: la instrucción vive en el system prompt (REGLA #33)');
  const p = buildLandingLeadPayload('56911112222', { lead_id: UUID, gclid: 'g1', landing_slug: 'ventanas-pvc-temuco' }, { name: 'Ana', ref_status: 'solo_ref' });
  assert.equal(p.landing_ref, UUID, 'landing_ref en la raíz: sales-os lo persiste en leads.landing_ref');
  assert.equal(p.metadata.landing_ref, UUID); assert.equal(p.metadata.ref_status, 'solo_ref'); assert.equal(p.ad_click_id_source, 'landing_ref'); assert.equal(p.gclid, 'g1'); assert.equal(p.name, 'Ana');
  const sinClick = buildLandingLeadPayload('56911112222', { lead_id: UUID }, {});
  assert.equal(sinClick.ad_click_id_source, undefined, 'sin click-id no se marca landing_ref como fuente de click-id'); assert.equal(sinClick.metadata.ref_status, undefined);
});

test('#966 r3 · varios tags en un mensaje (Gemini A): se quitan TODOS los sanos, se atribuye el primero, y el roto se limpia aunque haya uno sano', () => {
  const otro = '00000000-0000-4000-8000-000000000000';
  const dos = parseLandingRef(`Hola [Ref:${UUID}] y también [Ref:${otro}] gracias`);
  assert.deepEqual(dos, { hasRef: true, leadId: UUID, cleanText: 'Hola y también gracias' }, 'antes el segundo tag viajaba crudo al LLM y al operador');
  const mixto = `Hola [Ref:${UUID}] [Ref:${otro.slice(0, 20)}`;
  assert.equal(tieneTagRoto(mixto), true, 'antes: con un tag sano presente, el roto no se detectaba');
  assert.equal(limpiarTagRoto(mixto), `Hola [Ref:${UUID}]`, 'se va el roto, queda el sano para que parseLandingRef lo capture');
  assert.deepEqual(parseLandingRef(limpiarTagRoto(mixto)), { hasRef: true, leadId: UUID, cleanText: 'Hola' });
  assert.equal(clasificarPrimerMensaje(mixto), 'con_ref', 'con un uuid sano la clase es con_ref aunque venga basura al lado');
  assert.equal(limpiarTagRoto('Hola, vi su web y quiero cotizar'), 'Hola, vi su web y quiero cotizar', 'sin tags no toca nada');
  assert.equal(tieneTagRoto('[ref: mi casa] tiene 3 ventanas'), false, '[r3 · NIM] un corchete con texto del cliente no es un tag roto (se exigen 4 hex tras «ref:»)');
  assert.equal(limpiarTagRoto('[ref: mi casa] tiene 3 ventanas'), '[ref: mi casa] tiene 3 ventanas');
  assert.equal(limpiarTagRoto(`a\u0000b [Ref:${UUID.slice(0, 20)}`), 'ab', 'un NUL en el texto no se confunde con el placeholder interno');
});
