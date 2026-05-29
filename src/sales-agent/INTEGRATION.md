# Oliver v2 — Guía de integración (Fase 3, NO ejecutar aún)

Cómo enchufar el esqueleto `src/sales-agent/` al `index.js` de Oliver actual (v11.8.1) **sin romperlo**. Esto es un plan; no se ha modificado `index.js`.

## 1. Dependencia

```powershell
npm install @anthropic-ai/sdk
```

Variables de entorno nuevas (Railway):

| Var | Para qué | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Acceso a Claude Haiku 4.5 | (requerida) |
| `OLIVER_MODEL` | Override del modelo | `claude-haiku-4-5` |
| `ACTIVA_ENGINE_URL` | Base del Engine | `https://ops.activalabs.ai` |
| `ACTIVA_ENGINE_KEY` | Auth del Engine (si aplica) | — |
| `SIMULADOR_URL` | Base del simulador 3D | `https://activalabs.ai/simulador` |

## 2. Arquitectura del esqueleto

```
src/sales-agent/
├── personality.md      ← personalidad (fuente de verdad, editable sin redeploy)
├── system-prompt.js    ← arma system prompt estable (cacheable) + contexto volátil
├── tools.js            ← TOOL_DEFS (schema Anthropic) + runTool() (executors)
├── engine-client.js    ← axios → ACTIVA Engine (TODO: confirmar schemas)
├── agent.js            ← handleTurn(): loop de tool-use con Haiku 4.5 + caché
├── run-demo.js         ← prueba en consola (NO toca WhatsApp)
└── tools.test.js       ← node --test (sin red ni API key)
```

El núcleo es `handleTurn({ history, userText, state, toolCtx })` → `{ reply, history, toolCalls, usage }`.

## 3. Punto de enganche en `index.js`

El bot actual usa GPT en `POST /webhook` (línea ~4508) y en el orquestador 2-pass (líneas 1827-1920 / 4941-5329). **No reemplazar de golpe.** Estrategia de convivencia:

### Opción A — Feature flag por número (recomendada para piloto)

En el handler de `POST /webhook`, después de resolver la sesión, ramear:

```js
import { handleTurn } from "./src/sales-agent/agent.js";

const OLIVER_V2_NUMBERS = (process.env.OLIVER_V2_PHONES || "").split(",");

// ... dentro del webhook, tras getSession():
if (OLIVER_V2_NUMBERS.includes(from)) {
  const { reply, history, toolCalls } = await handleTurn({
    history: ses.v2History || [],
    userText,
    state: {
      fecha: new Date().toISOString().slice(0, 10),
      nombre: ses.data?.name,
      comuna: ses.data?.comuna,
      segmento: ses.data?.segmento,
      lockedData: getLockedData(ses), // reutiliza el helper existente
    },
    toolCtx: {
      telefono: from,
      saveLead: (lead) => trackConversationEvent(ses, "lead", lead), // adaptar
      notifyMarcelo: (p) => sendTemplateEscalamientoMarcelo(p),       // reutiliza la fn existente
    },
  });
  ses.v2History = history;
  await waSendH(from, sanitizeForCustomer(reply)); // reutiliza el sanitizador existente
  return res.sendStatus(200);
}
// ... resto del flujo GPT actual sin cambios
```

Así sólo los números en `OLIVER_V2_PHONES` usan Haiku; el resto sigue con GPT.

### Opción B — Servicio paralelo

Levantar `src/sales-agent` como microservicio aparte y enrutar por proxy. Más aislado, más trabajo de infra. Recomendado sólo si el piloto A funciona.

## 4. Reutilizar piezas del bot actual (no reinventar)

| Necesidad v2 | Helper existente en index.js |
|---|---|
| Limpiar salida al cliente | `sanitizeForCustomer()` |
| Datos confirmados (anti-repregunta) | `getLockedData()` / `buildLockedDataContext()` |
| Enviar mensaje WhatsApp | `waSendH()` |
| Escalar a Marcelo (plantilla) | `sendTemplateEscalamientoMarcelo()` |
| Logging de eventos | `trackConversationEvent()` / tabla `oliver_events` |
| Gate anti-avalancha de cotización | `canGeneratePdf()` (envolver antes de `generar_link_aprobacion`) |

## 5. Pendientes antes de producción (TODOs en el código)

- [ ] **engine-client.js**: confirmar request/response reales de `/api/quotes/calculate`, `calculate-by-area`, `glasses`, `:id/share`. Ajustar campos.
- [ ] **engine-client.js**: confirmar si el Engine requiere auth (Bearer/API key).
- [ ] **tools.js**: cablear `guardar_lead_postgres` a la BD real (hoy es hook stub).
- [ ] **tools.js**: cablear `notificar_marcelo` al canal real de handoff.
- [ ] Persistir `ses.v2History` con el mismo TTL/almacenamiento que el resto de la sesión.
- [ ] Manejar audio entrante (hoy v2 asume texto): reusar la transcripción Whisper actual antes de `handleTurn`.
- [ ] Métricas comparativas v1 (GPT) vs v2 (Haiku): tasa de cierre, costo/conversación, latencia.

## 6. Cómo probar ahora (sin riesgo)

```powershell
# Tests del esqueleto (sin red ni API key):
node --test src/sales-agent/tools.test.js

# Conversación real en consola con Haiku (no toca WhatsApp):
$env:ANTHROPIC_API_KEY="sk-..."
node src/sales-agent/run-demo.js
```
