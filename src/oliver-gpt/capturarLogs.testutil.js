// capturarLogs.testutil.js — helper de TESTS (no termina en .test.js: `npm test` no lo corre).
//
// El bot loguea por `console.log` (los `warn` incluidos). Esto corre `fn` y devuelve las lineas que
// se loguearon mientras tanto, en silencio. Una sola copia para los tests de webhook.js y de
// channel-agent.js (antes habia dos, y dos copias de un helper se desincronizan).

/** @param {() => (void|Promise<void>)} fn @returns {Promise<string[]>} */
export async function capturarLogs(fn) {
  const lineas = [];
  const original = console.log;
  console.log = (...a) => { lineas.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lineas;
}
