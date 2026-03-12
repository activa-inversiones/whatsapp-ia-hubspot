param(
    [string]$RepoPath = "C:\Users\whatsapp-ia-hubspot"
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Ensure-Path($path) {
    if (-not (Test-Path $path)) {
        throw "No existe: $path"
    }
}

function Normalize-NewLines([string]$s) {
    return ($s -replace "`r`n", "`n") -replace "`r", "`n"
}

function Replace-ExactNormalized {
    param(
        [string]$Content,
        [string]$Old,
        [string]$New,
        [string]$Label
    )

    $c = Normalize-NewLines $Content
    $o = Normalize-NewLines $Old
    $n = Normalize-NewLines $New

    if ($c.Contains($n.Trim())) {
        Warn "$Label ya existe. Se omite."
        return $c
    }

    if (-not $c.Contains($o)) {
        throw "No encontré el bloque exacto normalizado para: $Label"
    }

    Info "Reemplazando: $Label"
    return $c.Replace($o, $n)
}

function Insert-BeforeLiteralNormalized {
    param(
        [string]$Content,
        [string]$Anchor,
        [string]$Insert,
        [string]$Label
    )

    $c = Normalize-NewLines $Content
    $a = Normalize-NewLines $Anchor
    $i = Normalize-NewLines $Insert

    if ($c.Contains($i.Trim())) {
        Warn "$Label ya existe. Se omite."
        return $c
    }

    $idx = $c.IndexOf($a)
    if ($idx -lt 0) {
        throw "No encontré ancla literal para: $Label"
    }

    Info "Insertando antes de: $Label"
    return $c.Insert($idx, $i + "`n")
}

function Insert-AfterLiteralNormalized {
    param(
        [string]$Content,
        [string]$Anchor,
        [string]$Insert,
        [string]$Label
    )

    $c = Normalize-NewLines $Content
    $a = Normalize-NewLines $Anchor
    $i = Normalize-NewLines $Insert

    if ($c.Contains($i.Trim())) {
        Warn "$Label ya existe. Se omite."
        return $c
    }

    $idx = $c.IndexOf($a)
    if ($idx -lt 0) {
        throw "No encontré ancla literal para: $Label"
    }

    $pos = $idx + $a.Length
    Info "Insertando después de: $Label"
    return $c.Insert($pos, "`n" + $i)
}

function Insert-BeforeRegexNormalized {
    param(
        [string]$Content,
        [string]$Pattern,
        [string]$Insert,
        [string]$Label
    )

    $c = Normalize-NewLines $Content
    $i = Normalize-NewLines $Insert

    if ($c.Contains($i.Trim())) {
        Warn "$Label ya existe. Se omite."
        return $c
    }

    $m = [regex]::Match($c, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $m.Success) {
        throw "No encontré ancla regex para: $Label"
    }

    Info "Insertando por regex antes de: $Label"
    return $c.Insert($m.Index, $i + "`n")
}

$repo = $RepoPath
Ensure-Path $repo

$indexPath = Join-Path $repo "index.js"
$envPath   = Join-Path $repo ".env.example"
$gitPath   = Join-Path $repo ".git"

Ensure-Path $indexPath
Ensure-Path $envPath
Ensure-Path $gitPath

# ------------------------------------------------------------
# 0) BACKUP
# ------------------------------------------------------------
$backupRoot = Join-Path $repo ("backups\mod2f_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item $indexPath (Join-Path $backupRoot "index.js.bak")
Copy-Item $envPath   (Join-Path $backupRoot ".env.example.bak")
Ok "Backup creado en: $backupRoot"

# ------------------------------------------------------------
# 1) RESTAURAR LIMPIO DESDE GIT HEAD
# ------------------------------------------------------------
Push-Location $repo
try {
    Info "Restaurando index.js y .env.example desde Git HEAD"
    git restore --source=HEAD -- index.js .env.example 2>$null
    if ($LASTEXITCODE -ne 0) {
        Warn "git restore no disponible. Usando git checkout --"
        git checkout -- index.js .env.example
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo restaurar index.js y .env.example desde Git HEAD"
        }
    }
    Ok "Base limpia restaurada desde Git"
}
finally {
    Pop-Location
}

$index = Get-Content $indexPath -Raw -Encoding UTF8
$env   = Get-Content $envPath -Raw -Encoding UTF8

# ------------------------------------------------------------
# 2) IMPORT salesOsBridge
# ------------------------------------------------------------
$oldImport = @'
import fs from "fs";
'@

$newImport = @'
import fs from "fs";
import {
  pushConversationEvent,
  pushLeadEvent,
  pushQuoteEvent,
  getConversationControl,
  salesOsConfigured,
} from "./services/salesOsBridge.js";
'@

$index = Replace-ExactNormalized -Content $index -Old $oldImport -New $newImport -Label "Import salesOsBridge"

# ------------------------------------------------------------
# 3) AGENT_NAME + INTERNAL_OPERATOR_TOKEN
# Se inserta ANTES de const STAGES = {
# ------------------------------------------------------------
$agentBlock = @'
const AGENT_NAME = process.env.AGENT_NAME || "Asesor ACTIVA";
const INTERNAL_OPERATOR_TOKEN =
  process.env.OPERATOR_API_TOKEN || process.env.SALES_OS_OPERATOR_TOKEN || "";
'@

$index = Insert-BeforeRegexNormalized `
    -Content $index `
    -Pattern 'const\s+STAGES\s*=\s*\{' `
    -Insert $agentBlock `
    -Label "AGENT_NAME + INTERNAL_OPERATOR_TOKEN"

# ------------------------------------------------------------
# 4) HELPERS bridge después de safeJson
# ------------------------------------------------------------
$safeJsonAnchor = @'
function safeJson(x) {
  try { return JSON.stringify(x); } catch { return "{}"; }
}
'@

$helpersBlock = @'
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

$index = Insert-AfterLiteralNormalized -Content $index -Anchor $safeJsonAnchor -Insert $helpersBlock -Label "Helpers bridge"

# ------------------------------------------------------------
# 5) waSendH / waSendMultiH
# ------------------------------------------------------------
$oldSendBlock = @'
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

$newSendBlock = @'
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

$index = Replace-ExactNormalized -Content $index -Old $oldSendBlock -New $newSendBlock -Label "waSendH + waSendMultiH"

# ------------------------------------------------------------
# 6) /health
# ------------------------------------------------------------
$oldHealth = @'
app.get("/health", (_req, res) => {
  res.json({
    ok: true, v: "9.2.3",
    pricer_mode: PRICER_MODE,
    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",
    zoho_books: ZOHO.ORG_ID ? "enabled" : "disabled",
  });
});
'@

$newHealth = @'
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    v: "9.2.3-mod2f",
    pricer_mode: PRICER_MODE,
    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",
    zoho_books: ZOHO.ORG_ID ? "enabled" : "disabled",
    sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",
    internal_operator_bridge: INTERNAL_OPERATOR_TOKEN ? "enabled" : "missing",
  });
});
'@

$index = Replace-ExactNormalized -Content $index -Old $oldHealth -New $newHealth -Label "/health"

# ------------------------------------------------------------
# 7) endpoint interno operador
# ------------------------------------------------------------
$webhookAnchor = 'app.post("/webhook", async (req, res) => {'

$operatorEndpoint = @'
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

$index = Insert-BeforeLiteralNormalized -Content $index -Anchor $webhookAnchor -Insert $operatorEndpoint -Label "/internal/operator-send"

# ------------------------------------------------------------
# 8) Tracking inbound + takeover
# ------------------------------------------------------------
$pdfAnchor = @'
    if (type === "document" && inc.docId && inc.docMime === "application/pdf") {
      const meta = await waMediaUrl(inc.docId);
      const { buffer } = await waDownload(meta.url);
      const t = await readPdf(buffer);
      userText = t
        ? `[PDF ANALIZADO]:\n${t}\n\nINSTRUCCIÓN: extrae TODOS los items y envíalos con update_quote.`
        : "[PDF sin texto]";
    }
'@

$inboundBlock = @'
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

$index = Insert-AfterLiteralNormalized -Content $index -Anchor $pdfAnchor -Insert $inboundBlock -Label "Tracking inbound + takeover"

# ------------------------------------------------------------
# 9) Reset con customer_name
# ------------------------------------------------------------
$oldReset = @'
      await waSendH(waId, "🔄 Listo, empecemos de cero.\n¿Qué ventanas o puertas necesitas?", true);
'@

$newReset = @'
      await waSendH(
        waId,
        "🔄 Listo, empecemos de cero.\n¿Qué ventanas o puertas necesitas?",
        true,
        { customer_name: "" }
      );
'@

$index = Replace-ExactNormalized -Content $index -Old $oldReset -New $newReset -Label "Reset waSendH"

# ------------------------------------------------------------
# 10) pushLeadEvent en zhUpsert
# ------------------------------------------------------------
$oldZhTail = @'
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

$newZhTail = @'
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

$index = Replace-ExactNormalized -Content $index -Old $oldZhTail -New $newZhTail -Label "pushLeadEvent en zhUpsert"

# ------------------------------------------------------------
# 11) pushQuoteEvent formal
# ------------------------------------------------------------
$oldQuoteBlock = @'
            zhUpsert(ses, waId).then(() => {
              if (ses.zohoDealId && estimate.estimate_number) {
                return zhNote("Deals", ses.zohoDealId, `Cotización ${qn}`, `Estimate generado: ${estimate.estimate_number}\nTotal: $${Number(d.grand_total).toLocaleString("es-CL")} +IVA`);
              }
            }).catch(() => {});
'@

$newQuoteBlock = @'
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

$index = Replace-ExactNormalized -Content $index -Old $oldQuoteBlock -New $newQuoteBlock -Label "pushQuoteEvent formal"

# ------------------------------------------------------------
# 12) .env.example
# ------------------------------------------------------------
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

$envNorm = Normalize-NewLines $env
if ($envNorm -notmatch '(?m)^AGENT_NAME=') {
    Info "Agregando bloque SALES OS BRIDGE a .env.example"
    $env = $envNorm.TrimEnd() + "`n" + (Normalize-NewLines $envBlock) + "`n"
} else {
    Warn ".env.example ya contiene AGENT_NAME."
    $env = $envNorm
}

# ------------------------------------------------------------
# 13) Validaciones
# ------------------------------------------------------------
$index = Normalize-NewLines $index

$needles = @(
    'pushConversationEvent',
    'const AGENT_NAME = process.env.AGENT_NAME || "Asesor ACTIVA";',
    'function fireAndForget(label, promise)',
    'app.post("/internal/operator-send", async (req, res) => {',
    'const control = await getConversationControl(waId);',
    'sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",',
    'trackLeadEvent.zhUpsert',
    'trackQuoteEvent.formal'
)

foreach ($n in $needles) {
    if ($index -notlike "*$n*") {
        throw "Validación falló. No quedó aplicado: $n"
    }
}

Set-Content -Path $indexPath -Value $index -Encoding UTF8
Set-Content -Path $envPath   -Value $env   -Encoding UTF8

Ok "M2F aplicado correctamente."
Write-Host ""
Write-Host "Siguiente paso:"
Write-Host "  git add ."
Write-Host '  git commit -m "mod2f integrate sales os bridge and operator handoff"'
Write-Host "  git push"