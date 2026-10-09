// USO: node tools/e2e-acuses.mjs <ruta-del-repo-del-bot>   (levanta index.js REAL en :38991 con sales-os falso en :38992)
// E2E del enrutador del bot (#1403): un webhook de SOLO acuses tiene que llegar a oliver-gpt y
// terminar como `mensaje_leido` en sales-os. Corre index.js REAL, con sales-os FALSO, sin BD
// (DATABASE_URL anulada) y sin tokens de WhatsApp/LLM: no puede escribir ni enviar nada real.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';

const REPO = process.argv[2];
const PUERTO_BOT = 38991, PUERTO_SOS = 38992, SECRET = 'secreto-de-prueba-e2e';
const recibidos = [];

const sos = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    let j = null; try { j = JSON.parse(b); } catch {}
    recibidos.push({ path: req.url, body: j });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ai_paused: false, operator_status: 'ai' }));
  });
}).listen(PUERTO_SOS);

const env = { ...process.env };
for (const k of Object.keys(env)) if (/^(DATABASE_URL|PG|REDIS|WHATSAPP|WA_|META_|ANTHROPIC|OPENAI|ZOHO|GEMINI|SALES_OS)/i.test(k)) delete env[k];
Object.assign(env, {
  PORT: String(PUERTO_BOT), NODE_ENV: 'test', APP_SECRET: SECRET,
  OLIVER_GPT_ENABLED: 'true', OLIVER_GPT_ALL: 'true',
  SALES_OS_URL: `http://127.0.0.1:${PUERTO_SOS}`, SALES_OS_INGEST_TOKEN: 't', SALES_OS_OPERATOR_TOKEN: 't',
  // Credenciales FALSAS (el bot no arranca sin ellas). Zoho apunta al sales-os falso local; WhatsApp y
  // OpenAI con tokens inválidos rebotan 401: no hay forma de enviar nada real.
  WHATSAPP_TOKEN: 'FALSO-e2e-no-es-un-token-real-xxxxxxxx', PHONE_NUMBER_ID: '000000000000000', VERIFY_TOKEN: 'falso',
  OPENAI_API_KEY: 'sk-falso-e2e', ZOHO_CLIENT_ID: 'falso', ZOHO_CLIENT_SECRET: 'falso', ZOHO_REFRESH_TOKEN: 'falso-refresh-e2e',
  ZOHO_ACCOUNTS_DOMAIN: `http://127.0.0.1:${PUERTO_SOS}`, ZOHO_API_DOMAIN: `http://127.0.0.1:${PUERTO_SOS}`,
});
const bot = spawn(process.execPath, ['index.js'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
bot.stdout.on('data', (d) => { log += d; });
bot.stderr.on('data', (d) => { log += d; });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function arriba() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PUERTO_BOT}/health`); if (r.ok) return true; } catch {}
    await espera(500);
  }
  return false;
}
function firmar(raw, secreto = SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secreto).update(raw).digest('hex');
}
async function postear(body, secreto) {
  const raw = JSON.stringify(body);
  const r = await fetch(`http://127.0.0.1:${PUERTO_BOT}/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firmar(raw, secreto) }, body: raw,
  });
  return r.status;
}
const acuse = (id, status, extra = {}) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { phone_number_id: '1' },
  statuses: [{ id, status, recipient_id: '56911112222', timestamp: '1791500100', ...extra }] } }] }] });

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };
try {
  ok(await arriba(), 'el bot real levantó (GET /health)');
  const leidos = () => recibidos.filter((x) => x.body && x.body.event_type === 'mensaje_leido');

  ok(await postear(acuse('wamid.E2E1', 'read')) === 200, 'Meta recibe 200 por el acuse read');
  await espera(1500);
  const l1 = leidos();
  ok(l1.length === 1, `llega 1 mensaje_leido a sales-os (llegaron ${l1.length})`);
  ok(l1[0] && l1[0].body.payload.phone === '56911112222' && l1[0].body.payload.wamid === 'wamid.E2E1', 'con teléfono y wamid correctos');
  ok(l1[0] && l1[0].body.payload.leido_at === new Date(1791500100 * 1000).toISOString(), 'con la hora de Meta');

  ok(await postear(acuse('wamid.E2E2', 'read'), 'firma-falsa') === 200, 'firma falsa: igual 200 (no se le dice a nadie)');
  await espera(1200);
  ok(leidos().length === 1, 'firma falsa: NO se registra nada');

  ok(await postear(acuse('wamid.DESCONOCIDO', 'failed', { errors: [{ code: 131026, title: 'x' }] })) === 200, 'acuse failed de algo no rastreado: 200');
  await espera(1200);
  ok(!/acuses_route/.test(log), 'el enrutador no registró errores (acuses_route)');
} finally {
  bot.kill();
  sos.close();
  await espera(300);
  if (fallos) { console.log('--- log del bot (últimas líneas) ---'); console.log(log.split('\n').slice(-40).join('\n')); }
  console.log(fallos ? `E2E: ${fallos} FALLAS` : 'E2E: TODO OK');
  process.exit(fallos ? 1 : 0);
}
