import test from 'node:test';
import assert from 'node:assert/strict';
import { pedirVientos } from './vientosThermal.js';

/* =========================================================================
 * 🔴 EL NUMERO DE VENTANA SE PERDIA EN EL ULTIMO SALTO (2026-09-19)
 *
 * El informe de vientos NO se dibuja con las ventanas que nosotros mandamos: se dibuja con las
 * que DEVUELVE el motor de ACTIVA THERMAL. Y THERMAL no devuelve el `pos`.
 * MEDIDO en vivo contra https://activa-thermal-production.up.railway.app/api/v1/vientos:
 *   · le mandas `pos: 14` y lo ACEPTA (no rechaza campos desconocidos) — asi que agregarlo no
 *     rompe nada, que era el riesgo que levanto Codex;
 *   · pero su respuesta trae solo nombre / ancho_mm / alto_mm / vidrio / cantidad / capacidad /
 *     veredicto / flechas. El `pos` no vuelve.
 * Resultado: la propuesta decia "V14" y el informe de vientos "V2", para la misma ventana.
 *
 * ⚠️ NO se le pide a THERMAL que lo devuelva: es un PROVEEDOR —"se le pide, no se le mete mano",
 * regla de la casa—. Se re-asocia de este lado, por nombre + medidas, que es lo que se le mando.
 * ========================================================================= */

function conThermal(respuesta, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return respuesta; } });
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = orig; });
}

const ventanaQueMandamos = (pos, nombre, a, al) => ({
  pos, nombre, ancho_mm: a, alto_mm: al, cantidad: 1,
  vidrio: { ext_mm: 5, cam_mm: 12, int_mm: 5, tratamiento: 'recocido' },
});

test('🔴 el numero del cliente vuelve a pegarse a lo que devuelve THERMAL', async () => {
  const ventanas = [
    ventanaQueMandamos(12, 'Corredera A', 770, 1747),
    ventanaQueMandamos(14, 'Corredera B', 900, 1200),
  ];
  // THERMAL responde sin `pos` — asi es de verdad, medido en vivo.
  const respuesta = {
    ventanas: [
      { nombre: 'Corredera A', ancho_mm: 770, alto_mm: 1747, veredicto: 'cumple' },
      { nombre: 'Corredera B', ancho_mm: 900, alto_mm: 1200, veredicto: 'cumple' },
    ],
    curvas: {
      interseccion_por_ventana: [
        { nombre: 'Corredera A', ancho_mm: 770, alto_mm: 1747 },
        { nombre: 'Corredera B', ancho_mm: 900, alto_mm: 1200 },
      ],
    },
  };
  const r = await conThermal(respuesta, () => pedirVientos({ comuna: 'Vilcun', cliente: 'x', ventanas }));
  assert.deepEqual(r.ventanas.map((v) => v.pos), [12, 14], 'las ventanas del informe');
  assert.deepEqual(r.curvas.interseccion_por_ventana.map((v) => v.pos), [12, 14], 'y las del grafico');
});

test('🔒 si dos ventanas son IDENTICAS, no se adivina cual es cual', async () => {
  // Mismo nombre y mismas medidas: el match no es unico. Mejor sin numero que con el de otra.
  const ventanas = [
    ventanaQueMandamos(3, 'Proyectante', 410, 580),
    ventanaQueMandamos(8, 'Proyectante', 410, 580),
  ];
  const respuesta = { ventanas: [{ nombre: 'Proyectante', ancho_mm: 410, alto_mm: 580 }] };
  const r = await conThermal(respuesta, () => pedirVientos({ comuna: 'Vilcun', cliente: 'x', ventanas }));
  assert.equal(r.ventanas[0].pos, undefined, 'ambigua: no se le pone numero');
});

test('🔒 si THERMAL ya devolviera el pos algun dia, no se pisa', async () => {
  const ventanas = [ventanaQueMandamos(12, 'Corredera A', 770, 1747)];
  const respuesta = { ventanas: [{ nombre: 'Corredera A', ancho_mm: 770, alto_mm: 1747, pos: 99 }] };
  const r = await conThermal(respuesta, () => pedirVientos({ comuna: 'Vilcun', cliente: 'x', ventanas }));
  assert.equal(r.ventanas[0].pos, 99, 'lo que manda el motor manda');
});

test('🔒 una respuesta rara no tumba el informe', async () => {
  const ventanas = [ventanaQueMandamos(1, 'X', 100, 100)];
  for (const resp of [{}, { ventanas: null }, { ventanas: [null] }, { curvas: {} }]) {
    const r = await conThermal(resp, () => pedirVientos({ comuna: 'Vilcun', cliente: 'x', ventanas }));
    assert.ok(r !== undefined, JSON.stringify(resp));
  }
});
