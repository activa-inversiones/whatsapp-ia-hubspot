// nodeYDeps.test.js — [23-sep · decisión del dueño] Node fijado en 22 y las dependencias sin ALTAS.
//
// POR QUÉ EXISTE. `engines: ">=18.0.0"` era un PISO, no un pin: permitía que Railway siguiera
// instalando Node 18, que dejó de recibir parches de seguridad en abril de 2025 (17 meses). Y nadie
// había corrido `npm audit` en este repo: MEDIDO el 23-sep, 7 vulnerabilidades en dependencias de
// PRODUCCIÓN — 3 ALTAS (axios SSRF por NO_PROXY y bypass de autenticación por prototype pollution ·
// form-data inyección CRLF · path-to-regexp ReDoS) y 4 moderadas. Después del arreglo: 0.
//
// ⚠️ Lo que este test NO puede probar y se dice en vez de disimularlo: que las versiones sean seguras
// PARA SIEMPRE. Fija las medidas el 23-sep, para que un downgrade silencioso se note.
// Correr: node --test nodeYDeps.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('./', import.meta.url));
const leer = (f) => readFileSync(raiz + f, 'utf8');

// 🔴 ESTE TEST VIGILABA EL ARCHIVO EQUIVOCADO, y por eso pasó en verde mientras producción seguía
// en Node 18. Comprobaba `engines` en package.json; pero ESTE REPO SE CONSTRUYE CON DOCKERFILE, así
// que la imagen base manda y `engines` se ignora. Lo cazó el log de build de Railway:
//     npm warn EBADENGINE required: { node: '22.x' }, current: { node: 'v18.20.8' }
// Un guardia que mira el archivo que no decide da falsa tranquilidad, que es peor que no tenerlo.
// Ahora se vigila el Dockerfile, que es donde se decide de verdad, Y package.json, para que los dos
// digan lo mismo y nadie se confunda leyendo uno solo.
test('Node queda FIJADO en 22 en el DOCKERFILE, que es lo que manda acá', () => {
  const df = leer('Dockerfile');
  const from = (df.match(/^FROM.*$/m) || [''])[0];
  assert.match(from, /node:22[.-]/, `FROM = "${from.trim()}" — la imagen base es la que fija Node`);
  assert.doesNotMatch(from, /node:(1[0-9]|20)[.-]/, 'Node 18 y 20 ya no reciben parches de seguridad');
});

test('package.json y .nvmrc dicen lo MISMO que el Dockerfile (no deciden, pero no pueden contradecirlo)', () => {
  const e = JSON.parse(leer('package.json')).engines?.node || '';
  assert.match(e, /^22/, `engines.node = "${e}" — si dice otra cosa, npm tira EBADENGINE en cada build`);
  assert.doesNotMatch(e, /^>=/, 'un piso se cumple con Node 18: no garantiza nada');
  assert.ok(existsSync(raiz + '.nvmrc'), 'y .nvmrc para que el local coincida');
  assert.equal(leer('.nvmrc').trim(), '22');
});

test('el lock sigue en git (es lo que hace reproducible el build de Railway)', () => {
  assert.ok(existsSync(raiz + 'package-lock.json'));
  const ig = existsSync(raiz + '.gitignore') ? leer('.gitignore') : '';
  assert.ok(!ig.split('\n').some((l) => l.trim() === 'package-lock.json'),
    'ignorarlo = dos deploys del mismo commit con dependencias distintas');
});

test('las 3 ALTAS del 23-sep siguen cerradas (un downgrade silencioso se nota acá)', () => {
  const lock = JSON.parse(leer('package-lock.json'));
  const v = (n) => lock.packages?.[`node_modules/${n}`]?.version || '';
  const mayorMenor = (s) => s.split('.').slice(0, 2).map(Number);
  const [aMa, aMe] = mayorMenor(v('axios'));
  assert.ok(aMa > 1 || (aMa === 1 && aMe >= 18), `axios ${v('axios')}: las ALTAS iban hasta 1.17.0`);
  assert.ok(v('form-data') >= '4.0.6', `form-data ${v('form-data')}: la CRLF iba hasta 4.0.5`);
  const ptr = v('path-to-regexp');
  if (ptr) assert.ok(ptr >= '0.1.13', `path-to-regexp ${ptr}: el ReDoS iba por debajo de 0.1.13`);
});
