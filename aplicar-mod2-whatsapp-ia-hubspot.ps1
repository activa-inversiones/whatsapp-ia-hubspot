param(
    [string]$RepoPath = "C:\Users\whatsapp-ia-hubspot"
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) {
    Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "[OK]   $msg" -ForegroundColor Green
}

function Write-WarnMsg($msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Write-Fail($msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
}

function Ensure-Exists($path) {
    if (-not (Test-Path $path)) {
        throw "No existe: $path"
    }
}

function Replace-Exact {
    param(
        [string]$Content,
        [string]$Old,
        [string]$New,
        [string]$Label
    )

    if ($Content.Contains($New)) {
        Write-WarnMsg "$Label ya estaba aplicado. Se omite."
        return $Content
    }

    if (-not $Content.Contains($Old)) {
        throw "No encontré el bloque esperado para: $Label"
    }

    Write-Info "Aplicando: $Label"
    return $Content.Replace($Old, $New)
}

function Insert-Before {
    param(
        [string]$Content,
        [string]$Anchor,
        [string]$Insert,
        [string]$Label
    )

    if ($Content.Contains($Insert)) {
        Write-WarnMsg "$Label ya estaba aplicado. Se omite."
        return $Content
    }

    $idx = $Content.IndexOf($Anchor)
    if ($idx -lt 0) {
        throw "No encontré el ancla esperada para: $Label"
    }

    Write-Info "Insertando antes de: $Label"
    return $Content.Insert($idx, $Insert + "`r`n")
}

function Insert-After {
    param(
        [string]$Content,
        [string]$Anchor,
        [string]$Insert,
        [string]$Label
    )

    if ($Content.Contains($Insert)) {
        Write-WarnMsg "$Label ya estaba aplicado. Se omite."
        return $Content
    }

    $idx = $Content.IndexOf($Anchor)
    if ($idx -lt 0) {
        throw "No encontré el ancla esperada para: $Label"
    }

    $pos = $idx + $Anchor.Length
    Write-Info "Insertando después de: $Label"
    return $Content.Insert($pos, "`r`n" + $Insert)
}

$repo = $RepoPath
Ensure-Exists $repo

$indexPath = Join-Path $repo "index.js"
$envPath   = Join-Path $repo ".env.example"

Ensure-Exists $indexPath
Ensure-Exists $envPath

$backupRoot = Join-Path $repo ("backups\mod2_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item $indexPath (Join-Path $backupRoot "index.js.bak")
Copy-Item $envPath   (Join-Path $backupRoot ".env.example.bak")
Write-Ok "Backup creado en: $backupRoot"

$index = Get-Content $indexPath -Raw -Encoding UTF8
$env   = Get-Content $envPath -Raw -Encoding UTF8

# -------------------------------------------------------------------
# A) Import del bridge
# -------------------------------------------------------------------
$oldA = @'
import fs from "fs";
'@

$newA = @'
import fs from "fs";
import {
  pushConversationEvent,
  pushLeadEvent,
  pushQuoteEvent,
  getConversationControl,
  salesOsConfigured,
} from "./services/salesOsBridge.js";
'@

$index = Replace-Exact -Content $index -Old $oldA -New $newA -Label "Import salesOsBridge"

# -------------------------------------------------------------------
# B) AGENT_NAME + INTERNAL_OPERATOR_TOKEN
# -------------------------------------------------------------------
$oldB = @'
const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  PHONE: process.env.COMPANY_PHONE || "+56 9 1234 5678",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT: process.env.COMPANY_RUT || "76.XXX.XXX-X",
};
'@

$newB = @'
const COMPANY = {
  NAME: process.env.COMPANY_NAME || "Activa Inversiones",
  PHONE: process.env.COMPANY_PHONE || "+56 9 1234 5678",
  EMAIL: process.env.COMPANY_EMAIL || "ventas@activa.cl",
  ADDRESS: process.env.COMPANY_ADDRESS || "Temuco, La Araucanía, Chile",
  WEBSITE: process.env.COMPANY_WEBSITE || "www.activa.cl",
  RUT: process.env.COMPANY_RUT || "76.XXX.XXX-X",
};

const AGENT_NAME = process.env.AGENT_NAME || "Asesor ACTIVA";
const INTERNAL_OPERATOR_TOKEN =
  process.env.OPERATOR_API_TOKEN || process.env.SALES_OS_OPERATOR_TOKEN || "";
'@

$index = Replace-Exact -Content $index -Old $oldB -New $newB -Label "AGENT_NAME + INTERNAL_OPERATOR_TOKEN"

# -------------------------------------------------------------------
# C) Helpers del bridge
# -------------------------------------------------------------------
$oldC = @'
function safeJson(x) {
  try { return JSON.stringify(x); } catch { return "{}"; }
}
'@

$newC = @'
function safeJson(x) {
  try { return JSON.stringify(x); } catch { return "{}"; }
}

function fireAndForget(label, promise) {
  Promise.resolve(promise).catch((e) => logErr(label, e));
}

function buildLeadPayload(ses, waId) {
  const d = ses.data || emptyData();
  return {
    source: "whatsapp_ai",
    channel: "whatsapp",
    lead_name: d.name || "",
    name: d.name || "",
    phone: normPhone(waId),
    comuna: d.comuna || "",
    city: d.comuna || "",
    project_type: d.project_type || "",
    product_interest: d.items?.[0]?.product || d.supplier || "ventanas",
    windows_qty: d.items?.length
      ? String(d.items.reduce((acc, it) => acc + (Number(it.qty) || 1), 0))
      : "",
    budget: d.grand_total ? String(d.grand_total) : "",
    message: d.notes || buildDesc(d),
    status: ses.pdfSent ? "quoted" : (isComplete(d) ? "qualified" : "new"),
    zoho_deal_id: ses.zohoDealId || "",
    external_id: waId,
  };
}

function buildQuotePayload(ses, waId, extras = {}) {
  const d = ses.data || emptyData();
  return {
    phone: normPhone(waId),
    channel: "whatsapp",
    customer_name: d.name || "Cliente WhatsApp",
    quote_number: ses.quoteNum || extras.quote_number || null,
    status: extras.status || (ses.pdfSent ? "formal_sent" : "draft"),
    amount_total: d.grand_total || null,
    currency: "CLP",
    zoho_estimate_id: ses.zohoEstimateId || extras.zoho_estimate_id || null,
    zoho_estimate_url: extras.zoho_estimate_url || null,
    lead: buildLeadPayload(ses, waId),
    payload: {
      supplier: d.supplier || "",
      comuna: d.comuna || "",
      items: d.items || [],
      notes: d.notes || "",
    },
  };
}

async function trackConversationEvent(payload) {
  const r = await pushConversationEvent(payload);
  if (!r?.ok && !r?.skipped) {
    throw new Error(r?.error || `conversation_event_failed_${r?.status || "unknown"}`);
  }
}

async function trackLeadEvent(payload) {
  const r = await pushLeadEvent(payload);
  if (!r?.ok && !r?.skipped) {
    throw new Error(r?.error || `lead_event_failed_${r?.status || "unknown"}`);
  }
}

async function trackQuoteEvent(payload) {
  const r = await pushQuoteEvent(payload);
  if (!r?.ok && !r?.skipped) {
    throw new Error(r?.error || `quote_event_failed_${r?.status || "unknown"}`);
  }
}

function validInternalOperatorToken(req) {
  const token = req.get("x-api-key") || req.get("X-API-Key") || "";
  return !!(INTERNAL_OPERATOR_TOKEN && token && token === INTERNAL_OPERATOR_TOKEN);
}
'@

$index = Replace-Exact -Content $index -Old $oldC -New $newC -Label "Helpers bridge"

# -------------------------------------------------------------------
# D) waSendH / waSendMultiH
# -------------------------------------------------------------------
$oldD = @'
async function waSendH(to, text, skipTyping = false) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try { await sleep(humanMs(text)); await waSend(to, text); } finally { stop?.(); }
}

async function waSendMultiH(to, msgs, skipTyping = false) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    for (const m of msgs) {
      if (!m?.trim()) continue;
      await sleep(humanMs(m)); await waSend(to, m); await sleep(250 + Math.random() * 450);
    }
  } finally { stop?.(); }
}
'@

$newD = @'
async function waSendH(to, text, skipTyping = false, meta = {}) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    await sleep(humanMs(text));
    await waSend(to, text);

    if (meta.track !== false) {
      fireAndForget(
        "trackConversationEvent.outbound",
        trackConversationEvent({
          channel: "whatsapp",
          external_id: to,
          customer_name: meta.customer_name || "",
          direction: "outbound",
          actor_type: meta.actor_type || "assistant",
          actor_name: meta.actor_name || AGENT_NAME,
          message_type: meta.message_type || "text",
          body: text,
          metadata: meta.metadata || { source: "whatsapp_ia" },
          quote_status: meta.quote_status,
          unread_count: 0,
        })
      );
    }
  } finally {
    stop?.();
  }
}

async function waSendMultiH(to, msgs, skipTyping = false, meta = {}) {
  const stop = skipTyping ? null : startTypingLoop(to);
  try {
    for (const m of msgs) {
      if (!m?.trim()) continue;

      await sleep(humanMs(m));
      await waSend(to, m);

      if (meta.track !== false) {
        fireAndForget(
          "trackConversationEvent.outbound_multi",
          trackConversationEvent({
            channel: "whatsapp",
            external_id: to,
            customer_name: meta.customer_name || "",
            direction: "outbound",
            actor_type: meta.actor_type || "assistant",
            actor_name: meta.actor_name || AGENT_NAME,
            message_type: meta.message_type || "text",
            body: m,
            metadata: meta.metadata || { source: "whatsapp_ia" },
            quote_status: meta.quote_status,
            unread_count: 0,
          })
        );
      }

      await sleep(250 + Math.random() * 450);
    }
  } finally {
    stop?.();
  }
}
'@

$index = Replace-Exact -Content $index -Old $oldD -New $newD -Label "waSendH + waSendMultiH"

# -------------------------------------------------------------------
# E) /health endurecido
# -------------------------------------------------------------------
$oldE = @'
app.get("/health", (_req, res) => {
  res.json({
    ok: true, v: "9.2.3",
    pricer_mode: PRICER_MODE,
    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",
    zoho_books: ZOHO.ORG_ID ? "enabled" : "disabled",
  });
});
'@

$newE = @'
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    v: "9.2.3-mod2",
    pricer_mode: PRICER_MODE,
    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",
    zoho_books: ZOHO.ORG_ID ? "enabled" : "disabled",
    sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",
    internal_operator_bridge: INTERNAL_OPERATOR_TOKEN ? "enabled" : "missing",
  });
});
'@

$index = Replace-Exact -Content $index -Old $oldE -New $newE -Label "/health"

# -------------------------------------------------------------------
# F) endpoint /internal/operator-send antes de /webhook
# -------------------------------------------------------------------
$anchorF = 'app.post("/webhook", async (req, res) => {'

$insertF = @'
app.post("/internal/operator-send", async (req, res) => {
  try {
    if (!validInternalOperatorToken(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const phone = normPhone(req.body?.phone || "");
    const text = String(req.body?.text || "").trim();
    const operatorName =
      String(req.body?.operator_name || "Operador").trim() || "Operador";

    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    if (!text) return res.status(400).json({ ok: false, error: "text_required" });

    const ses = getSession(phone);
    ses.history.push({ role: "assistant", content: text });
    saveSession(phone, ses);

    await waSendH(phone, text, true, {
      actor_type: "operator",
      actor_name: operatorName,
      customer_name: ses.data?.name || "",
      metadata: { source: "sales_os_operator" },
      quote_status: ses.data?.stageKey || undefined,
      track: false,
    });

    res.json({ ok: true, sent: true, phone });
  } catch (e) {
    logErr("/internal/operator-send", e);
    res.status(500).json({ ok: false, error: "internal_operator_send_failed" });
  }
});
'@

$index = Insert-Before -Content $index -Anchor $anchorF -Insert $insertF -Label "/internal/operator-send"

# -------------------------------------------------------------------
# G) inbound tracking + takeover humano
# -------------------------------------------------------------------
$anchorG = @'
    if (type === "document" && inc.docId && inc.docMime === "application/pdf") {
      const meta = await waMediaUrl(inc.docId);
      const { buffer } = await waDownload(meta.url);
      const t = await readPdf(buffer);
      userText = t
        ? `[PDF ANALIZADO]:\n${t}\n\nINSTRUCCIÓN: extrae TODOS los items y envíalos con update_quote.`
        : "[PDF sin texto]";
    }
'@

$insertG = @'
    fireAndForget(
      "trackConversationEvent.inbound",
      trackConversationEvent({
        channel: "whatsapp",
        external_id: waId,
        customer_name: ses.data?.name || "",
        direction: "inbound",
        actor_type: "customer",
        actor_name: "Cliente",
        message_type: type || "text",
        body: userText,
        metadata: { source: "whatsapp_webhook", msg_id: msgId, raw_type: type },
        quote_status: ses.data?.stageKey || undefined,
        unread_count: 1,
      })
    );

    const control = await getConversationControl(waId);
    if (control?.ai_paused || control?.operator_status === "human") {
      ses.history.push({ role: "user", content: userText });
      saveSession(waId, ses);
      logInfo("takeover", `AI en pausa para ${waId}`);
      return;
    }
'@

$index = Insert-After -Content $index -Anchor $anchorG -Insert $insertG -Label "Tracking inbound + takeover"

# -------------------------------------------------------------------
# H) reset con meta mínima
# -------------------------------------------------------------------
$oldH = @'
      await waSendH(waId, "🔄 Listo, empecemos de cero.\n¿Qué ventanas o puertas necesitas?", true);
'@

$newH = @'
      await waSendH(
        waId,
        "🔄 Listo, empecemos de cero.\n¿Qué ventanas o puertas necesitas?",
        true,
        { customer_name: "" }
      );
'@

$index = Replace-Exact -Content $index -Old $oldH -New $newH -Label "Reset waSendH"

# -------------------------------------------------------------------
# I) push lead event dentro de zhUpsert
# -------------------------------------------------------------------
$oldI = @'
  if (ex?.id) {
    ses.zohoDealId = ex.id;
    await zhUpdate("Deals", ex.id, deal);
  } else {
    const a = await zhDefaultAcct();
    if (a) deal.Account_Name = { id: a };
    ses.zohoDealId = await zhCreate("Deals", deal);
  }
}
'@

$newI = @'
  if (ex?.id) {
    ses.zohoDealId = ex.id;
    await zhUpdate("Deals", ex.id, deal);
  } else {
    const a = await zhDefaultAcct();
    if (a) deal.Account_Name = { id: a };
    ses.zohoDealId = await zhCreate("Deals", deal);
  }

  fireAndForget("trackLeadEvent.zhUpsert", trackLeadEvent(buildLeadPayload(ses, waId)));
}
'@

$index = Replace-Exact -Content $index -Old $oldI -New $newI -Label "pushLeadEvent en zhUpsert"

# -------------------------------------------------------------------
# J) push quote event formal
# -------------------------------------------------------------------
$oldJ = @'
            zhUpsert(ses, waId).then(() => {
              if (ses.zohoDealId && estimate.estimate_number) {
                return zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, `Estimate generado: ${estimate.estimate_number}\nTotal: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`);
              }
            }).catch(() => {});
'@

$newJ = @'
            zhUpsert(ses, waId).then(() => {
              if (ses.zohoDealId && estimate.estimate_number) {
                return zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, `Estimate generado: ${estimate.estimate_number}\nTotal: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`);
              }
            }).catch(() => {});

            fireAndForget(
              "trackQuoteEvent.formal",
              trackQuoteEvent(
                buildQuotePayload(ses, waId, {
                  status: "formal_sent",
                  zoho_estimate_id: estimate.estimate_id,
                  zoho_estimate_url: estimateUrl,
                  quote_number: qn,
                })
              )
            );
'@

$index = Replace-Exact -Content $index -Old $oldJ -New $newJ -Label "pushQuoteEvent formal"

# -------------------------------------------------------------------
# K) .env.example
# -------------------------------------------------------------------
$envBlock = @'

# SALES OS BRIDGE / TAKEOVER (RECOMENDADO EN PRODUCCIÓN)
AGENT_NAME=Asesor ACTIVA
SALES_OS_URL=https://ops.activalabs.ai
SALES_OS_INGEST_TOKEN=
SALES_OS_OPERATOR_TOKEN=
OPERATOR_API_TOKEN=

# takeover humano y estilo
HUMAN_HANDOFF_ENABLED=true
'@

if ($env -notmatch '(?m)^AGENT_NAME=') {
    Write-Info "Agregando bloque SALES OS BRIDGE a .env.example"
    $env = $env.TrimEnd() + "`r`n" + $envBlock + "`r`n"
} else {
    Write-WarnMsg ".env.example ya contiene AGENT_NAME=. Se omite bloque env."
}

# -------------------------------------------------------------------
# Validaciones finales
# -------------------------------------------------------------------
$requiredStrings = @(
    'import {',
    'pushConversationEvent',
    'const AGENT_NAME = process.env.AGENT_NAME || "Asesor ACTIVA";',
    'function fireAndForget(label, promise)',
    'app.post("/internal/operator-send", async (req, res) => {',
    'const control = await getConversationControl(waId);',
    'sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",',
    'fireAndForget("trackLeadEvent.zhUpsert", trackLeadEvent(buildLeadPayload(ses, waId)));',
    'trackQuoteEvent(',
    'AGENT_NAME=Asesor ACTIVA'
)

foreach ($needle in $requiredStrings) {
    if (($index -notlike "*$needle*") -and ($env -notlike "*$needle*")) {
        throw "Validación falló. No quedó aplicado: $needle"
    }
}

Set-Content -Path $indexPath -Value $index -Encoding UTF8
Set-Content -Path $envPath   -Value $env   -Encoding UTF8

Write-Ok "M2 aplicado correctamente en:"
Write-Host " - $indexPath"
Write-Host " - $envPath"
Write-Host ""
Write-Host "Siguiente paso:"
Write-Host "  git add ."
Write-Host '  git commit -m "mod2 integrate sales os bridge and operator handoff"'
Write-Host "  git push"