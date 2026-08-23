import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarComuna, pedirInformeComuna, armarMensaje, informeParaComuna } from './informeTermico.js';

// Respuesta real de THERMAL para Temuco, recortada. Se usa la forma REAL medida contra
// produccion el 21-ago, no una inventada: si el contrato cambia, estos tests lo cazan.
const TEMUCO = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, zona_termica_NCh1079: 'F',
  criterio_ref: 'PDA Temuco-Padre Las Casas art. 27, Tabla N.10 (DO 07-03-2025)',
  condensacion: {
    metodo: 'NCh 1973:2014 (difusion de vapor) + Res. Ex. 1802 MINVU 26-11-2025',
    clima: { theta_e_C: 3.8, phi_e: 0.94 },
    f_rsi_minimo: { '0.65': { valor: 0.5576, theta_si_min_C: 12.29 },
                    '0.75': { valor: 0.7024, theta_si_min_C: 14.5 } },
  },
};
const VILLARRICA = { ...TEMUCO, comuna: 'Villarrica', regimen: 'sin_PDA', uw_max_Wm2K: null, criterio_ref: null };

const respuesta = (body, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });

// ── El bug que este modulo existe para tapar ────────────────────────────────

test('🔴 las comunas con tilde se normalizan: THERMAL las rechaza tal cual', () => {
  // Medido contra produccion: Pucón FALLA, Pucon OK. Son 70 cotizaciones en 45 dias
  // (Vilcun 33 + Pucon 15 + Pitrufquen 10 + Curacautin 6 + Traiguen 6).
  assert.equal(normalizarComuna('Pucón'), 'Pucon');
  assert.equal(normalizarComuna('Vilcún'), 'Vilcun');
  assert.equal(normalizarComuna('Pitrufquén'), 'Pitrufquen');
  assert.equal(normalizarComuna('Curacautín'), 'Curacautin');
  assert.equal(normalizarComuna('Traiguén'), 'Traiguen');
});

test('la Ñ se PRESERVA: "Nunoa" tampoco esta en el registro oficial', () => {
  assert.equal(normalizarComuna('Ñuñoa'), 'Ñuñoa');
  assert.equal(normalizarComuna('Ñiquén'), 'Ñiquen', 'la ñ queda, el acento de la e se va');
});

test('normaliza espacios y no rompe con basura', () => {
  assert.equal(normalizarComuna('  Padre   Las  Casas '), 'Padre Las Casas');
  for (const x of [null, undefined, '', '   ', 0]) assert.equal(normalizarComuna(x), '');
});

test('la comuna viaja URL-encodeada a THERMAL', async () => {
  let url = null;
  await pedirInformeComuna('Padre Las Casas', {
    fetchFn: async (u) => { url = u; return respuesta(TEMUCO); }, baseUrl: 'https://t',
  });
  assert.match(url, /comuna=Padre%20Las%20Casas/);
});

// ── Nunca puede romper la conversacion ni inventar un dato ──────────────────

test('REGLA DURA: ningun fallo se propaga — devuelve null y Oliver sigue', async () => {
  const casos = [
    ['red caida',     async () => { throw new Error('ECONNREFUSED'); }],
    ['404 comuna',    async () => respuesta({ detail: 'no esta en el registro' }, false)],
    ['json invalido', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })],
    ['body vacio',    async () => respuesta({})],
    ['null',          async () => null],
  ];
  for (const [nombre, fetchFn] of casos) {
    const r = await pedirInformeComuna('Temuco', { fetchFn, baseUrl: 'https://t' });
    assert.equal(r, null, `${nombre} deberia dar null, no romper`);
  }
});

test('sin comuna NO se le pide ningun dato extra al cliente', async () => {
  // [2026-08-21] Este test afirmaba "sin comuna no hay informe". El dueno cambio la regla:
  // "y si no entrega comuna indicar la de Temuco, como capital region". Lo que NO cambia
  // —y es lo que este test cuida— es que jamas se le pregunte un dato nuevo al cliente:
  // el informe se arma con lo ya capturado o con la referencia regional, nunca preguntando.
  let url = null;
  const m = await informeParaComuna('', {
    fetchFn: async (u) => { url = u; return respuesta(TEMUCO); },
  });
  assert.ok(m, 'con el fallback hay informe igual');
  assert.match(url, /comuna=Temuco/, 'pide la referencia regional, no un dato al cliente');
  assert.doesNotMatch(m, /\?.*comuna.*\?/, 'no puede terminar interrogando al cliente');
});

test('pedirInformeComuna (el nivel bajo) SIGUE sin llamar si no hay comuna', async () => {
  // El fallback vive en informeParaComuna, no acá: el nivel bajo no inventa una comuna.
  let llamadas = 0;
  const r = await pedirInformeComuna('', { fetchFn: async () => { llamadas++; return respuesta(TEMUCO); } });
  assert.equal(r, null);
  assert.equal(llamadas, 0);
});

test('ANTI-ALUCINACION: sin condensacion NI tope, no se manda nada', () => {
  const pelado = { comuna: 'X', regimen: 'sin_PDA', uw_max_Wm2K: null, zona_termica_NCh1079: null };
  assert.equal(armarMensaje(pelado), null, 'un informe sin un solo dato duro no es un informe');
});

// ── Lo que el cliente lee ───────────────────────────────────────────────────

test('con PDA se dice "obligatorio" y se cita el decreto', () => {
  const m = armarMensaje(TEMUCO, { nombre: 'Jorge Rojas' });
  assert.match(m, /obligatorio/);
  assert.match(m, /3,2 W\/m²K/);
  assert.match(m, /DO 07-03-2025/, 'sin la fuente es marketing, no un informe');
  assert.match(m, /^Mientras le preparo la propuesta, Jorge,/, 'usa solo el primer nombre');
});

test('SIN PDA no se afirma que sea obligatorio — seria falso', () => {
  const m = armarMensaje(VILLARRICA);
  // Ojo: la palabra "obligatorio" SI aparece, pero NEGADA ("no hay tope obligatorio").
  // Lo que no puede aparecer es la AFIRMACION ni un numero de Uw exigido que no existe.
  assert.doesNotMatch(m, /tienen un tope \*obligatorio\*/, 'en Villarrica no hay tope por elemento: afirmarlo es mentir');
  assert.match(m, /no hay tope obligatorio/, 'tiene que decir explicitamente que ahi NO rige');
  assert.doesNotMatch(m, /W\/m²K/, 'sin PDA no hay Uw maximo que citar');
  assert.doesNotMatch(m, /decreto/, 'no hay decreto que citar en una comuna sin PDA');
  assert.match(m, /zona térmica \*F\*/);
  assert.match(m, /NCh 1973/, 'igual cita la fuente de la condensacion');
});

test('los decimales van con COMA, como se escribe en Chile', () => {
  const m = armarMensaje(TEMUCO);
  assert.equal((m.match(/[0-9]\.[0-9]/g) || []).length, 0, `quedaron decimales con punto: ${m.match(/[0-9]\.[0-9]/g)}`);
  assert.match(m, /12,3 °C/);
  assert.match(m, /14,5 °C/);
});

test('el mensaje entra en una burbuja de WhatsApp sin trocearse feo', () => {
  const m = armarMensaje(TEMUCO, { nombre: 'Jorge' });
  assert.ok(m.length < 900, `mide ${m.length}: se partiria en varias burbujas y perderia el efecto`);
  assert.ok(m.includes('En un momento le mando su propuesta'), 'tiene que cerrar anunciando la cotizacion');
});

test('sin nombre, el mensaje sigue siendo correcto', () => {
  const m = armarMensaje(TEMUCO);
  assert.match(m, /^Mientras le preparo la propuesta, le dejo/);
  assert.doesNotMatch(m, /undefined|null|, ,/);
});

// ── Fallback a la capital regional (decision del dueno, 21-ago) ─────────────

test('sin comuna cae a Temuco, pero lo ANUNCIA como referencia regional', async () => {
  const m = await informeParaComuna('', { fetchFn: async () => respuesta(TEMUCO) });
  assert.ok(m, 'con el fallback SI tiene que haber informe');
  assert.match(m, /dato técnico de la región/, 'no puede decir "de su comuna": no la sabemos');
  assert.match(m, /como referencia \(es la capital regional\)/);
  assert.match(m, /cuando me confirme su comuna/, 'tiene que pedirla sin exigirla');
});

test('🔴 el fallback NUNCA le atribuye al cliente una obligacion legal que quiza no tiene', async () => {
  // Temuco esta bajo PDA; Villarrica, Pucon, Lautaro y casi toda la region NO. Decirle a
  // alguien de Villarrica "usted tiene este tope obligatorio" es falso, y una cita normativa
  // mal aplicada destruye justo la credibilidad que el informe viene a construir.
  const m = await informeParaComuna(null, { fetchFn: async () => respuesta(TEMUCO) });
  assert.doesNotMatch(m, /Su comuna está bajo Plan de Descontaminación/);
  assert.doesNotMatch(m, /tienen un tope \*obligatorio\*/);
  assert.match(m, /En otras comunas de la región no hay ese tope/,
    'tiene que decir explicitamente que en otras comunas NO rige');
});

test('con comuna conocida NO se usa el fallback', async () => {
  let pedida = null;
  const m = await informeParaComuna('Pucón', {
    fetchFn: async (u) => { pedida = decodeURIComponent(u); return respuesta(VILLARRICA); },
  });
  assert.match(pedida, /comuna=Pucon/, 'pide Pucon (sin tilde), no Temuco');
  assert.doesNotMatch(m, /capital regional/);
});

test('si THERMAL no responde ni para Temuco, no hay informe y Oliver sigue', async () => {
  const m = await informeParaComuna('', { fetchFn: async () => { throw new Error('caido'); } });
  assert.equal(m, null);
});

// ── Regresiones de la revision cruzada de Codex (2026-08-21) ────────────────

test('🔴 CODEX: un clima sin numeros NO puede imprimir "NaN °C" en un texto que cita un decreto', () => {
  const m = armarMensaje({ comuna: 'X', regimen: 'PDA', uw_max_Wm2K: 3.2, criterio_ref: 'ref',
    condensacion: { clima: {}, f_rsi_minimo: { '0.65': { theta_si_min_C: 12.3 } } } });
  assert.doesNotMatch(m || '', /NaN|Infinity|undefined/);
  assert.doesNotMatch(m || '', /humedad exterior/, 'sin clima valido, el bloque entero se omite');
  assert.match(m, /3,2 W\/m²K/, 'pero el tope de Uw, que SI es valido, se conserva');
});

test('🔴 CODEX: un tope de Uw valido NO se pierde por falta de datos de condensacion', () => {
  // El bloque PDA empuja exactamente 3 elementos y el gate viejo era `lineas.length <= 3`:
  // devolvia null y se perdia un informe con dato normativo verificado.
  const m = armarMensaje({ comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2, criterio_ref: 'decreto X' });
  assert.ok(m, 'habia un tope verificado: ese informe vale');
  assert.match(m, /3,2 W\/m²K/);
});

test('CODEX: valores no finitos se descartan en vez de imprimirse', () => {
  for (const uw of ['Infinity', NaN, 'abc', Infinity, -0]) {
    const m = armarMensaje({ comuna: 'Y', regimen: 'PDA', uw_max_Wm2K: uw, criterio_ref: 'r' });
    assert.doesNotMatch(m || '', /Infinity|NaN/, `uw=${String(uw)} se colo al mensaje`);
  }
});

test('CODEX: no se afirma "esta en el decreto" si no hay decreto que citar', () => {
  const sinRef = armarMensaje({ comuna: 'Z', regimen: 'PDA', uw_max_Wm2K: 3.2 });
  assert.doesNotMatch(sinRef, /en el decreto/, 'afirmar una norma sin poder nombrarla es peor que callarla');
  const conRef = armarMensaje({ comuna: 'Z', regimen: 'PDA', uw_max_Wm2K: 3.2, criterio_ref: 'DS 12/2025' });
  assert.match(conRef, /está en el decreto/);
  assert.match(conRef, /DS 12\/2025/);
});

test('🔴 CODEX: la condensacion declara la HUMEDAD INTERIOR que supone', () => {
  // El umbral de 12,3 °C sale de suponer 65 % adentro. Con aire mas seco esa superficie NO
  // condensa: decirlo sin la condicion es una conclusion fisica falsa.
  const m = armarMensaje(TEMUCO);
  assert.match(m, /19 °C adentro y 65 % de humedad/);
  assert.match(m, /75 %/, 'el segundo umbral tambien dice su condicion');
});

test('CODEX: cada fuente respalda lo suyo, no se atribuye una a la otra', () => {
  // criterio_ref respalda el Uw; cond.metodo respalda la condensacion.
  const soloUw = armarMensaje({ comuna: 'A', regimen: 'PDA', uw_max_Wm2K: 3.2, criterio_ref: 'DS 12',
    condensacion: { metodo: 'NCh 1973' } });   // sin clima => sin bloque de condensacion
  assert.match(soloUw, /_Fuente: DS 12_/, 'no puede citar NCh 1973 si no hablo de condensacion');
  const ambas = armarMensaje(TEMUCO);
  assert.match(ambas, /_Fuente: .*Tabla N\.10.* · NCh 1973/,
    'con los dos bloques presentes, las dos fuentes van separadas por " · "');
});

// ── Regresion de la revision cruzada de Gemini (2026-08-21) ────────────────

test('🔴 GEMINI: una comuna que THERMAL no reconoce NO puede dejar al cliente sin mensaje', async () => {
  // El cliente rara vez escribe una comuna: escribe DONDE VIVE. Medido contra la API real,
  // "Labranza", "Cajon", "Metrenco" y "Pedro de Valdivia" —todos sectores de Temuco y Padre
  // Las Casas— devolvian 404 y el modulo se quedaba MUDO, justo despues de que Oliver le
  // prometio un dato tecnico. Quedarse callado ahi es peor que no haber prometido nada.
  let pedidas = [];
  const m = await informeParaComuna('Labranza', {
    fetchFn: async (u) => {
      const c = decodeURIComponent(u).match(/comuna=([^&]+)/)[1];
      pedidas.push(c);
      return c === 'Temuco' ? respuesta(TEMUCO) : respuesta({ detail: 'no esta en el registro' }, false);
    },
  });
  assert.ok(m, 'tiene que caer a la referencia regional en vez de callarse');
  assert.deepEqual(pedidas, ['Labranza', 'Temuco'], 'primero intenta la del cliente, despues la referencia');
  assert.match(m, /como referencia \(es la capital regional\)/);
});

test('GEMINI: si la comuna del cliente SI existe, no se pide la referencia', async () => {
  const pedidas = [];
  await informeParaComuna('Villarrica', {
    fetchFn: async (u) => { pedidas.push(decodeURIComponent(u).match(/comuna=([^&]+)/)[1]); return respuesta(VILLARRICA); },
  });
  assert.deepEqual(pedidas, ['Villarrica'], 'una sola llamada: no se gasta una segunda al pedo');
});

test('GEMINI: si THERMAL esta caido, ni el fallback salva — y eso esta bien', async () => {
  const m = await informeParaComuna('Labranza', { fetchFn: async () => { throw new Error('caido'); } });
  assert.equal(m, null, 'sin dato verificado no se inventa un informe: Oliver sigue sin el');
});
