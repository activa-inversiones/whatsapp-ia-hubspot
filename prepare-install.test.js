// Guardia #1058: el script "prepare" NUNCA puede romper un `npm ci --omit=dev` de despliegue.
// Caso real: `"prepare": "node .husky/install.mjs"` rompió el build de Railway, porque el Dockerfile
// copia SOLO package*.json antes de `npm ci` => .husky/ no existe todavía y node sale con error.
// Este test reproduce ese escenario: carpeta temporal con SOLO package.json, y corre `npm run prepare`
// (offline, sin node_modules). Si prepare falla ahí, falla el deploy.
// Límite documentado: no corre `npm ci` completo (necesita red y tarda); eso se verificó a mano el 30-sep.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('#1058 prepare no falla sin .husky/ ni devDependencies (escenario Docker)', () => {
  const prep = pkg.scripts && pkg.scripts.prepare;
  if (!prep) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prep1058-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
    const r = spawnSync('npm', ['run', 'prepare', '--silent', '--offline'], {
      cwd: dir, shell: true, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, NODE_ENV: '', CI: '' },
    });
    assert.strictEqual(r.status, 0, 'prepare falló sin .husky/: ' + (r.stderr || r.stdout));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#1058 prepare usa el patrón import().catch (estático)', () => {
  const prep = pkg.scripts && pkg.scripts.prepare;
  if (!prep) return;
  assert.match(prep, /import\([^)]*\)\.catch\(/, 'prepare debe tolerar que el archivo no exista');
});

test('#1058 Dockerfile instala con --omit=dev (no el obsoleto --only=production)', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(df, /npm ci --omit=dev/);
  assert.doesNotMatch(df, /--only=production/);
});
