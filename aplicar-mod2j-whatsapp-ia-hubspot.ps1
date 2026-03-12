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

function New-StringList([object[]]$items) {
    $list = [System.Collections.ArrayList]::new()
    foreach ($it in $items) {
        [void]$list.Add([string]$it)
    }
    return $list
}

function To-LineList([string]$text) {
    $norm = Normalize-NewLines $text
    return New-StringList ($norm -split "`n")
}

function Join-Lines($lines) {
    return [string]::Join("`r`n", [string[]]$lines)
}

function Find-LineIndex($lines, [string]$pattern, [int]$start = 0) {
    for ($i = $start; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) { return $i }
    }
    return -1
}

function Insert-BeforeIndex($lines, [int]$idx, [string[]]$block) {
    $out = [System.Collections.ArrayList]::new()
    for ($i = 0; $i -lt $idx; $i++) { [void]$out.Add($lines[$i]) }
    foreach ($b in $block) { [void]$out.Add($b) }
    for ($i = $idx; $i -lt $lines.Count; $i++) { [void]$out.Add($lines[$i]) }
    return $out
}

function Insert-AfterIndex($lines, [int]$idx, [string[]]$block) {
    $out = [System.Collections.ArrayList]::new()
    for ($i = 0; $i -le $idx; $i++) { [void]$out.Add($lines[$i]) }
    foreach ($b in $block) { [void]$out.Add($b) }
    for ($i = $idx + 1; $i -lt $lines.Count; $i++) { [void]$out.Add($lines[$i]) }
    return $out
}

function Replace-Range($lines, [int]$startIdx, [int]$endIdxExclusive, [string[]]$block) {
    $out = [System.Collections.ArrayList]::new()
    for ($i = 0; $i -lt $startIdx; $i++) { [void]$out.Add($lines[$i]) }
    foreach ($b in $block) { [void]$out.Add($b) }
    for ($i = $endIdxExclusive; $i -lt $lines.Count; $i++) { [void]$out.Add($lines[$i]) }
    return $out
}

function Find-FunctionEndIndex($lines, [int]$startIdx) {
    $depth = 0
    $started = $false
    for ($i = $startIdx; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        $opens = ([regex]::Matches($line, '\{')).Count
        $closes = ([regex]::Matches($line, '\}')).Count
        if ($opens -gt 0) { $started = $true }
        $depth += $opens
        $depth -= $closes
        if ($started -and $depth -eq 0) {
            return $i
        }
    }
    return -1
}

$repo = $RepoPath
Ensure-Path $repo

$indexPath  = Join-Path $repo "index.js"
$envPath    = Join-Path $repo ".env.example"
$gitPath    = Join-Path $repo ".git"
$bridgePath = Join-Path $repo "services\salesOsBridge.js"

Ensure-Path $indexPath
Ensure-Path $envPath
Ensure-Path $gitPath
Ensure-Path $bridgePath

# ------------------------------------------------------------
# 0) BACKUP
# ------------------------------------------------------------
$backupRoot = Join-Path $repo ("backups\mod2j_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item $indexPath (Join-Path $backupRoot "index.js.bak")
Copy-Item $envPath   (Join-Path $backupRoot ".env.example.bak")
Ok "Backup creado en: $backupRoot"

# ------------------------------------------------------------
# 1) RESTAURAR BASE LIMPIA DESDE GIT HEAD
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

$indexText = Get-Content $indexPath -Raw -Encoding UTF8
$envText   = Get-Content $envPath -Raw -Encoding UTF8
$lines     = To-LineList $indexText

# ------------------------------------------------------------
# 2) IMPORT salesOsBridge
# ------------------------------------------------------------
$idxFs = Find-LineIndex $lines '^\s*import fs from "fs";\s*$'
if ($idxFs -lt 0) { throw "No encontré import fs en index.js" }

$importBlock = @(
'// @patch:sales-os:imports:start',
'import {',
'  pushConversationEvent,',
'  pushLeadEvent,',
'  pushQuoteEvent,',
'  getConversationControl,',
'  salesOsConfigured,',
'} from "./services/salesOsBridge.js";',
'// @patch:sales-os:imports:end'
)

$lines = Insert-AfterIndex $lines $idxFs $importBlock
Info "Import salesOsBridge agregado"

# ------------------------------------------------------------
# 3) AGENT_NAME + INTERNAL_OPERATOR_TOKEN
# ------------------------------------------------------------
$idxStages = Find-LineIndex $lines '^\s*const STAGES = \{\s*$'
if ($idxStages -lt 0) { throw "No encontré const STAGES en index.js" }

$agentBlock = @(
'// @patch:sales-os:config:start',
'const AGENT_NAME = process.env.AGENT_NAME || "Asesor ACTIVA";',
'const INTERNAL_OPERATOR_TOKEN =',
'  process.env.OPERATOR_API_TOKEN || process.env.SALES_OS_OPERATOR_TOKEN || "";',
'// @patch:sales-os:config:end'
)

$lines = Insert-BeforeIndex $lines $idxStages $agentBlock
Info "AGENT_NAME + INTERNAL_OPERATOR_TOKEN agregado"

# ------------------------------------------------------------
# 4) HELPERS bridge
# ------------------------------------------------------------
$idxSafeJson = Find-LineIndex $lines '^\s*function safeJson\(x\)\s*\{\s*$'
if ($idxSafeJson -lt 0) { throw "No encontré function safeJson" }

$idxSafeJsonEnd = Find-FunctionEndIndex $lines $idxSafeJson
if ($idxSafeJsonEnd -lt 0) { throw "No encontré cierre de safeJson" }

$helpersBlock = @(
'// @patch:sales-os:helpers:start',
'function fireAndForget(label, promise) {',
'  Promise.resolve(promise).catch((e) => logErr(label, e));',
'}',
'',
'function buildLeadPayload(ses, waId) {',
'  const d = ses.data || emptyData();',
'  return {',
'    source: "whatsapp_ai",',
'    channel: "whatsapp",',
'    lead_name: d.name || "",',
'    name: d.name || "",',
'    phone: normPhone(waId),',
'    comuna: d.comuna || "",',
'    city: d.comuna || "",',
'    project_type: d.project_type || "",',
'    product_interest: d.items?.[0]?.product || d.supplier || "ventanas",',
'    windows_qty: d.items?.length',
'      ? String(d.items.reduce((acc, it) => acc + (Number(it.qty) || 1), 0))',
'      : "",',
'    budget: d.grand_total ? String(d.grand_total) : "",',
'    message: d.notes || buildDesc(d),',
'    status: ses.pdfSent ? "quoted" : (isComplete(d) ? "qualified" : "new"),',
'    zoho_deal_id: ses.zohoDealId || "",',
'    external_id: waId,',
'  };',
'}',
'',
'function buildQuotePayload(ses, waId, extras = {}) {',
'  const d = ses.data || emptyData();',
'  return {',
'    phone: normPhone(waId),',
'    channel: "whatsapp",',
'    customer_name: d.name || "Cliente WhatsApp",',
'    quote_number: ses.quoteNum || extras.quote_number || null,',
'    status: extras.status || (ses.pdfSent ? "formal_sent" : "draft"),',
'    amount_total: d.grand_total || null,',
'    currency: "CLP",',
'    zoho_estimate_id: ses.zohoEstimateId || extras.zoho_estimate_id || null,',
'    zoho_estimate_url: extras.zoho_estimate_url || null,',
'    lead: buildLeadPayload(ses, waId),',
'    payload: {',
'      supplier: d.supplier || "",',
'      comuna: d.comuna || "",',
'      items: d.items || [],',
'      notes: d.notes || "",',
'    },',
'  };',
'}',
'',
'async function trackConversationEvent(payload) {',
'  const r = await pushConversationEvent(payload);',
'  if (!r?.ok && !r?.skipped) {',
'    throw new Error(r?.error || `conversation_event_failed_${r?.status || "unknown"}`);',
'  }',
'}',
'',
'async function trackLeadEvent(payload) {',
'  const r = await pushLeadEvent(payload);',
'  if (!r?.ok && !r?.skipped) {',
'    throw new Error(r?.error || `lead_event_failed_${r?.status || "unknown"}`);',
'  }',
'}',
'',
'async function trackQuoteEvent(payload) {',
'  const r = await pushQuoteEvent(payload);',
'  if (!r?.ok && !r?.skipped) {',
'    throw new Error(r?.error || `quote_event_failed_${r?.status || "unknown"}`);',
'  }',
'}',
'',
'function validInternalOperatorToken(req) {',
'  const token = req.get("x-api-key") || req.get("X-API-Key") || "";',
'  return !!(INTERNAL_OPERATOR_TOKEN && token && token === INTERNAL_OPERATOR_TOKEN);',
'}',
'// @patch:sales-os:helpers:end'
)

$lines = Insert-AfterIndex $lines $idxSafeJsonEnd $helpersBlock
Info "Helpers bridge agregados"

# ------------------------------------------------------------
# 5) waSendH / waSendMultiH
# ------------------------------------------------------------
$idxWaSendH = Find-LineIndex $lines '^\s*async function waSendH\('
$idxWaRead  = Find-LineIndex $lines '^\s*async function waRead\('

if ($idxWaSendH -lt 0 -or $idxWaRead -lt 0 -or $idxWaRead -le $idxWaSendH) {
    throw "No encontré bloque waSendH/waSendMultiH"
}

$sendBlock = @(
'// @patch:sales-os:send:start',
'async function waSendH(to, text, skipTyping = false, meta = {}) {',
'  const stop = skipTyping ? null : startTypingLoop(to);',
'  try {',
'    await sleep(humanMs(text));',
'    await waSend(to, text);',
'',
'    if (meta.track !== false) {',
'      fireAndForget(',
'        "trackConversationEvent.outbound",',
'        trackConversationEvent({',
'          channel: "whatsapp",',
'          external_id: to,',
'          customer_name: meta.customer_name || "",',
'          direction: "outbound",',
'          actor_type: meta.actor_type || "assistant",',
'          actor_name: meta.actor_name || AGENT_NAME,',
'          message_type: meta.message_type || "text",',
'          body: text,',
'          metadata: meta.metadata || { source: "whatsapp_ia" },',
'          quote_status: meta.quote_status,',
'          unread_count: 0,',
'        })',
'      );',
'    }',
'  } finally { stop?.(); }',
'}',
'',
'async function waSendMultiH(to, msgs, skipTyping = false, meta = {}) {',
'  const stop = skipTyping ? null : startTypingLoop(to);',
'  try {',
'    for (const m of msgs) {',
'      if (!m?.trim()) continue;',
'      await sleep(humanMs(m));',
'      await waSend(to, m);',
'',
'      if (meta.track !== false) {',
'        fireAndForget(',
'          "trackConversationEvent.outbound_multi",',
'          trackConversationEvent({',
'            channel: "whatsapp",',
'            external_id: to,',
'            customer_name: meta.customer_name || "",',
'            direction: "outbound",',
'            actor_type: meta.actor_type || "assistant",',
'            actor_name: meta.actor_name || AGENT_NAME,',
'            message_type: meta.message_type || "text",',
'            body: m,',
'            metadata: meta.metadata || { source: "whatsapp_ia" },',
'            quote_status: meta.quote_status,',
'            unread_count: 0,',
'          })',
'        );',
'      }',
'',
'      await sleep(250 + Math.random() * 450);',
'    }',
'  } finally { stop?.(); }',
'}',
'// @patch:sales-os:send:end'
)

$lines = Replace-Range $lines $idxWaSendH $idxWaRead $sendBlock
Info "waSendH + waSendMultiH actualizados"

# ------------------------------------------------------------
# 6) /health
# ------------------------------------------------------------
$idxHealth = Find-LineIndex $lines '^\s*app\.get\("/health",'
$idxWebhookGet = Find-LineIndex $lines '^\s*app\.get\("/webhook",'

if ($idxHealth -lt 0 -or $idxWebhookGet -lt 0 -or $idxWebhookGet -le $idxHealth) {
    throw "No encontré bloque /health"
}

$healthBlock = @(
'app.get("/health", (_req, res) => {',
'  res.json({',
'    ok: true,',
'    v: "9.2.3-mod2j",',
'    pricer_mode: PRICER_MODE,',
'    winperfil_api: WINPERFIL_API_BASE ? "set" : "missing",',
'    zoho_books: ZOHO.ORG_ID ? "enabled" : "disabled",',
'    sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",',
'    internal_operator_bridge: INTERNAL_OPERATOR_TOKEN ? "enabled" : "missing",',
'  });',
'});'
)

$lines = Replace-Range $lines $idxHealth $idxWebhookGet $healthBlock
Info "/health actualizado"

# ------------------------------------------------------------
# 7) /internal/operator-send
# ------------------------------------------------------------
$idxWebhookPost = Find-LineIndex $lines '^\s*app\.post\("/webhook",\s*async'
if ($idxWebhookPost -lt 0) { throw "No encontré app.post(/webhook)" }

$operatorEndpoint = @(
'// @patch:sales-os:operator-route:start',
'app.post("/internal/operator-send", async (req, res) => {',
'  try {',
'    if (!validInternalOperatorToken(req)) {',
'      return res.status(401).json({ ok: false, error: "unauthorized" });',
'    }',
'',
'    const phone = normPhone(req.body?.phone || "");',
'    const text = String(req.body?.text || "").trim();',
'    const operatorName =',
'      String(req.body?.operator_name || "Operador").trim() || "Operador";',
'',
'    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });',
'    if (!text) return res.status(400).json({ ok: false, error: "text_required" });',
'',
'    const ses = getSession(phone);',
'    ses.history.push({ role: "assistant", content: text });',
'    saveSession(phone, ses);',
'',
'    await waSendH(phone, text, true, {',
'      actor_type: "operator",',
'      actor_name: operatorName,',
'      customer_name: ses.data?.name || "",',
'      metadata: { source: "sales_os_operator" },',
'      quote_status: ses.data?.stageKey || undefined,',
'      track: false,',
'    });',
'',
'    res.json({ ok: true, sent: true, phone });',
'  } catch (e) {',
'    logErr("/internal/operator-send", e);',
'    res.status(500).json({ ok: false, error: "internal_operator_send_failed" });',
'  }',
'});',
'// @patch:sales-os:operator-route:end'
)

$lines = Insert-BeforeIndex $lines $idxWebhookPost $operatorEndpoint
Info "/internal/operator-send agregado"

# ------------------------------------------------------------
# 8) Tracking inbound + takeover
# ------------------------------------------------------------
$idxReset = Find-LineIndex $lines 'if \(/\^reset'
if ($idxReset -lt 0) { throw "No encontré bloque reset para insertar tracking inbound" }

$inboundBlock = @(
'    // @patch:sales-os:inbound-track:start',
'    fireAndForget(',
'      "trackConversationEvent.inbound",',
'      trackConversationEvent({',
'        channel: "whatsapp",',
'        external_id: waId,',
'        customer_name: ses.data?.name || "",',
'        direction: "inbound",',
'        actor_type: "customer",',
'        actor_name: "Cliente",',
'        message_type: type || "text",',
'        body: userText,',
'        metadata: { source: "whatsapp_webhook", msg_id: msgId, raw_type: type },',
'        quote_status: ses.data?.stageKey || undefined,',
'        unread_count: 1,',
'      })',
'    );',
'',
'    const control = await getConversationControl(waId);',
'    if (control?.ai_paused || control?.operator_status === "human") {',
'      ses.history.push({ role: "user", content: userText });',
'      saveSession(waId, ses);',
'      logInfo("takeover", `AI en pausa para ${waId}`);',
'      return;',
'    }',
'    // @patch:sales-os:inbound-track:end'
)

$lines = Insert-BeforeIndex $lines $idxReset $inboundBlock
Info "Tracking inbound + takeover agregado"

# ------------------------------------------------------------
# 9) Reset completo
# ------------------------------------------------------------
$idxResetStart = Find-LineIndex $lines 'if \(/\^reset'
if ($idxResetStart -lt 0) { throw "No encontré inicio del bloque reset" }

$idxResetEnd = -1
for ($i = $idxResetStart; $i -lt [Math]::Min($lines.Count, $idxResetStart + 12); $i++) {
    if ($lines[$i] -match '^\s*\}$') {
        $idxResetEnd = $i
        break
    }
}
if ($idxResetEnd -lt 0) { throw "No encontré cierre del bloque reset" }

$resetBlock = @(
'    if (/^reset|nueva cotizaci[oó]n|empezar de nuevo/i.test(userText)) {',
'      ses.data = emptyData();',
'      ses.pdfSent = false;',
'      await waSendH(',
'        waId,',
'        "🔄 Listo, empecemos de cero.\n¿Qué ventanas o puertas necesitas?",',
'        true,',
'        { customer_name: "" }',
'      );',
'      saveSession(waId, ses);',
'      return;',
'    }'
)

$lines = Replace-Range $lines $idxResetStart ($idxResetEnd + 1) $resetBlock
Info "Bloque reset actualizado"

# ------------------------------------------------------------
# 10) pushLeadEvent en zhUpsert
# ------------------------------------------------------------
$idxZhUpsert = Find-LineIndex $lines '^\s*async function zhUpsert\(ses, waId\) \{'
if ($idxZhUpsert -lt 0) { throw "No encontré zhUpsert" }

$idxZhUpsertEnd = Find-FunctionEndIndex $lines $idxZhUpsert
if ($idxZhUpsertEnd -lt 0) { throw "No encontré cierre de zhUpsert" }

$leadEventBlock = @(
'  // @patch:sales-os:lead-event:start',
'  fireAndForget("trackLeadEvent.zhUpsert", trackLeadEvent(buildLeadPayload(ses, waId)));',
'  // @patch:sales-os:lead-event:end'
)

$lines = Insert-BeforeIndex $lines $idxZhUpsertEnd $leadEventBlock
Info "pushLeadEvent agregado"

# ------------------------------------------------------------
# 11) pushQuoteEvent formal
# ------------------------------------------------------------
$idxQuoteStart = Find-LineIndex $lines '^\s*zhUpsert\(ses, waId\)\.then\(\(\) => \{$'
if ($idxQuoteStart -lt 0) { throw "No encontré inicio del bloque quote formal" }

$idxQuoteCatch = Find-LineIndex $lines '^\s*\}\)\.catch\(\(\) => \{\}\);$' $idxQuoteStart
if ($idxQuoteCatch -lt 0) { throw "No encontré .catch(() => {}); del bloque quote formal" }

$quoteEventBlock = @(
'',
'            // @patch:sales-os:quote-event:start',
'            fireAndForget(',
'              "trackQuoteEvent.formal",',
'              trackQuoteEvent(',
'                buildQuotePayload(ses, waId, {',
'                  status: "formal_sent",',
'                  zoho_estimate_id: estimate.estimate_id,',
'                  zoho_estimate_url: estimateUrl,',
'                  quote_number: qn,',
'                })',
'              )',
'            );',
'            // @patch:sales-os:quote-event:end'
)

$lines = Insert-AfterIndex $lines $idxQuoteCatch $quoteEventBlock
Info "pushQuoteEvent formal agregado"

# ------------------------------------------------------------
# 12) .env.example
# ------------------------------------------------------------
$envNorm = (($envText -replace "`r`n", "`n") -replace "`r", "`n")
if ($envNorm -notmatch '(?m)^AGENT_NAME=') {
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
    $envNorm = $envNorm.TrimEnd() + "`n" + ($envBlock -replace "`r`n", "`n") + "`n"
    $envText = $envNorm
    Info "Bloque SALES OS BRIDGE agregado a .env.example"
} else {
    Warn ".env.example ya contiene AGENT_NAME."
    $envText = $envNorm
}

# ------------------------------------------------------------
# 13) Validaciones finales
# ------------------------------------------------------------
$finalIndex = Join-Lines $lines

$mustHave = @(
    'pushConversationEvent',
    'const AGENT_NAME = process.env.AGENT_NAME || "Asesor ACTIVA";',
    'function fireAndForget(label, promise)',
    'app.post("/internal/operator-send", async (req, res) => {',
    'const control = await getConversationControl(waId);',
    'sales_os_bridge: salesOsConfigured() ? "enabled" : "disabled",',
    'trackLeadEvent.zhUpsert',
    'trackQuoteEvent.formal'
)

foreach ($m in $mustHave) {
    if ($finalIndex -notlike "*$m*") {
        throw "Validación falló. No quedó aplicado: $m"
    }
}

Set-Content -Path $indexPath -Value $finalIndex -Encoding UTF8
Set-Content -Path $envPath   -Value $envText -Encoding UTF8

Ok "M2J aplicado correctamente."
Write-Host ""
Write-Host "Ahora ejecuta solo esto:"
Write-Host "git add ."
Write-Host 'git commit -m "mod2j integrate sales os bridge and operator handoff"'
Write-Host "git push"