const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let snapshot = { paper: {}, strategies: {}, experiments: {}, audit: [] };
const publicMode = !["127.0.0.1", "localhost", "::1"].includes(location.hostname);
let publicStatus = null;
let pendingMandate = null;
const READ_RETRY_DELAYS = [0, 600, 1600];
const tenantKey = "ynx.quant.tenant.v1";
let tenantId = localStorage.getItem(tenantKey);
if (!/^[0-9a-f]{64}$/.test(tenantId || "")) {
  tenantId = [...crypto.getRandomValues(new Uint8Array(32))].map((value) => value.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(tenantKey, tenantId);
}
const supportedLocales = QuantI18n.locales;
let locale = localStorage.getItem("ynx.quant.locale") || navigator.languages.find((value) => supportedLocales.includes(value)) || navigator.language.split("-")[0];
if (!supportedLocales.includes(locale)) locale = "en";
const t = (key) => QuantI18n.t(locale, key);
const localDate = (value) => new Intl.DateTimeFormat(locale, {dateStyle:"medium",timeStyle:"medium"}).format(new Date(value));
function applyLocale() {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  $("#locale").value = locale;
  $$('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  const active = $('nav button.active'); if (active) $('#view-title').textContent = active.textContent;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const connectionStatus = (message, className = "ready") => { const element = $("#network-status"); if (element) { element.textContent = message; element.className = className; } };
const api = async (path, opt = {}) => {
  const method = String(opt.method || "GET").toUpperCase(), readOnly = method === "GET", attempts = readOnly ? READ_RETRY_DELAYS.length : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) { connectionStatus(`Reconnecting ${attempt}/${attempts - 1}…`, "warning"); await wait(READ_RETRY_DELAYS[attempt]); }
    try {
      const r = await fetch("/api" + path, {
        ...opt, method, signal: AbortSignal.timeout(10_000),
        headers: {"content-type":"application/json","x-ynx-preview-mode":"local-paper","x-ynx-tenant-id":tenantId,...(opt.headers || {})},
      });
      const b = await r.json();
      if (!r.ok) { const error = new Error(b.error || `HTTP ${r.status}`); error.status = r.status; if (!readOnly || ![502,503,504].includes(r.status) || attempt === attempts - 1) throw error; continue; }
      connectionStatus("YNX Testnet connected"); return b;
    } catch (error) {
      if (!readOnly || error?.status || attempt === attempts - 1) { if (!error?.status || [502,503,504].includes(error.status)) connectionStatus("Connection unavailable · press Refresh", "danger"); throw error; }
    }
  }
  throw new Error("Read connection retry exhausted.");
};
const toast = (m) => {
  const e = $("#toast");
  e.textContent = m;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3000);
};
async function refresh() {
  publicStatus = await api("/v1/public/status");
  const market = publicStatus.marketData || {};
  $("#market-status").textContent = market.status === "ready" ? "Authoritative tape ready" : "Waiting for matched trades";
  $("#market-status").className = market.status === "ready" ? "ready" : "warning";
  $("#market-bars").textContent = market.bars || 0;
  $("#run-backtest").disabled = publicMode && market.status !== "ready";
  snapshot = await api("/v1/snapshot");
  render();
}
function render() {
  const strategies = Object.values(snapshot.strategies || {}),
    experiments = Object.values(snapshot.experiments || {});
  $("#strategy-rows").innerHTML = strategies.length
    ? strategies
        .map(
          (s) =>
            `<tr><td>${safe(s.Name)}</td><td>${safe(s.Family)}</td><td>${safe(s.Stage || "Draft")}</td><td><code>${safe((s.StrategyHash || "").slice(0, 12))}…</code></td><td>${safe(s.License)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">${safe(t("emptyStrategy"))}</td></tr>`;
  $("#experiment-rows").innerHTML = experiments.length
    ? experiments
        .map(
          (e) =>
            `<tr><td>${localDate(e.createdAt)}</td><td>${safe(e.strategy.Name)}</td><td>${e.metrics.ReturnBPS} bps</td><td>${e.metrics.BuyHoldBPS} bps</td><td>${e.metrics.MaxDrawdownBPS} bps</td><td>${e.metrics.Trades}</td><td>${e.metrics.PartialFills}</td><td>${e.sensitivitySpreadBPS} bps</td><td>${e.metrics.DataGaps}</td><td>${e.attribution?.userNetPnl ?? 0}</td><td>${e.attribution?.userRealizedPnl ?? 0}</td><td>${e.attribution?.userUnrealizedPnl ?? 0}</td><td>${e.attribution?.tradingFee ?? 0}</td><td>${e.attribution?.slippage ?? 0}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="14">${safe(t("emptyExperiment"))}</td></tr>`;
  const p = snapshot.paper || {};
  $("#paper-state").innerHTML =
    `<h3>Broker state</h3><dl><div><dt>Cash</dt><dd>${p.Cash ?? 0}</dd></div><div><dt>Position</dt><dd>${p.Position ?? 0}</dd></div><div><dt>Reconciliation</dt><dd>${p.ReconciliationDelta ?? 0}</dd></div><div><dt>Kill switch</dt><dd class="${p.KillSwitch ? "danger" : ""}">${p.KillSwitch ? "ACTIVE" : "Armed"}</dd></div></dl>`;
  $("#audit-rows").innerHTML =
    (snapshot.audit || [])
      .slice()
      .reverse()
      .map(
        (a) =>
          `<li><time>${localDate(a.CreatedAt)}</time><strong>${safe(a.Action)} · ${safe(a.ObjectID)}</strong><code>${safe(a.Hash.slice(0, 16))}…</code></li>`,
      )
      .join("") || "<li>No audited actions yet.</li>";
  const executions=Object.values(snapshot.testnetOrders||{}).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  $("#testnet-execution-rows").innerHTML=executions.length?executions.map((order)=>`<tr><td><code>${safe(order.venueOrderId||"Pending")}</code></td><td>${safe(order.market)}</td><td>${safe(String(order.side||"").toUpperCase())}</td><td>${safe(order.price)}</td><td>${safe(order.amount)}</td><td><strong class="${order.venueStatus==="filled"?"ready":order.venueStatus?"warning":""}">${safe(order.venueStatus||"Outcome pending")}</strong><small>${safe(order.status)}</small></td><td><code>${safe((order.authorizationDigest||"").slice(0,12))}…</code></td></tr>`).join(""):`<tr><td colspan="7">No Wallet-authorized Testnet execution yet.</td></tr>`;
  if (!$("#mandate-strategy").value && strategies.length) {
    $("#mandate-strategy").value = strategies[0].StrategyHash || "";
  }
}
function safe(v) {
  const e = document.createElement("span");
  e.textContent = String(v ?? "");
  return e.innerHTML;
}
$$("nav button").forEach(
  (b) =>
    (b.onclick = () => {
      $$("nav button").forEach((x) => x.classList.toggle("active", x === b));
      $$(".view").forEach((x) =>
        x.classList.toggle("active", x.id === b.dataset.view),
      );
      $("#view-title").textContent = b.textContent;
    }),
);
$("#refresh").onclick = () => refresh().catch((e) => toast(e.message));
window.addEventListener("online", () => refresh().catch((e) => toast(e.message)));
$("#locale").onchange = (e) => {
  locale = e.target.value;
  localStorage.setItem("ynx.quant.locale", locale);
  applyLocale(); render();
};
$("#backtest").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const body = {
      strategy: {
        id: "ma-" + Date.now(),
        name: $("#strategy").value,
        family: "transparent",
        source: "quant://user/ma",
        sourceCommit: "local",
        license: "Apache-2.0",
        seed: +$("#seed").value,
        params: { fast: +$("#fast").value, slow: +$("#slow").value },
        limitations: t("historyWarning"),
      },
      assumptions: {
        feeBPS: +$("#fee").value,
        slippageBPS: +$("#slippage").value,
        latencyBars: 1,
        participationBPS: 1000,
        seed: +$("#seed").value,
        trainEnd: 24,
        walkForwardWindows: 3,
      },
    };
    const result = await api(publicMode ? "/v1/public/research/backtests/from-market" : "/v1/backtests/from-market", { method: "POST", body: JSON.stringify(body) });
    if (publicMode) {
      snapshot.experiments[result.ID || result.id || `run-${Date.now()}`] = result;
      snapshot.strategies[result.Strategy?.ID || result.strategy?.ID || body.strategy.id] = result.Strategy || result.strategy || body.strategy;
    }
    const metrics = result.Metrics || result.metrics;
    if (metrics) {
      $("#latest-result").hidden = false;
      $("#result-return").textContent = `${metrics.ReturnBPS ?? metrics.returnBPS ?? 0} bps`;
      $("#result-baseline").textContent = `${metrics.BuyHoldBPS ?? metrics.buyHoldBPS ?? 0} bps`;
      $("#result-drawdown").textContent = `${metrics.MaxDrawdownBPS ?? metrics.maxDrawdownBPS ?? 0} bps`;
      $("#result-trades").textContent = metrics.Trades ?? metrics.trades ?? 0;
    }
    toast("Out-of-sample experiment completed and audited");
    if (publicMode) render(); else await refresh();
  } catch (e) {
    toast(e.message);
  }
};
$("#paper-order").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/v1/paper/orders", {
      method: "POST",
      body: JSON.stringify({
        StrategyHash: "0".repeat(64),
        Side: $("#side").value,
        Amount: +$("#paper-amount").value,
      }),
    });
    toast("Simulated order recorded");
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};
function quantDeviceId() {
  const key = "ynx.quant.public-device-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = `quant-web-${crypto.randomUUID()}`;
    localStorage.setItem(key, value);
  }
  return value;
}
function mandateDraft() {
  const strategyHash = $("#mandate-strategy").value.trim().toLowerCase();
  return {
    Account: $("#mandate-account").value.trim(),
    StrategyHash: strategyHash,
    Market: "YNXT-YUSD_TEST",
    ProductID: "ynx-quant-lab",
    BundleID: "com.ynxweb4.quant.web",
    DeviceID: quantDeviceId(),
    NonceDomain: "quant:" + strategyHash,
    Scope: "quant:testnet-execute",
    Nonce: Date.now(),
    MaxNotional: +$("#mandate-notional").value,
    MaxPosition: +$("#mandate-position").value,
    MaxDailyLoss: +$("#mandate-loss").value,
    MaxSlippageBPS: +$("#mandate-slippage").value,
    MaxGas: +$("#mandate-gas").value,
    MaxOrdersPerMinute: +$("#mandate-frequency").value,
    MaxLeverageBPS: +$("#mandate-leverage").value,
    MaxDrawdown: +$("#mandate-drawdown").value,
    MinLiquidity: +$("#mandate-liquidity").value,
    MaxVaR: +$("#mandate-var").value,
    MaxExpectedShortfall: +$("#mandate-es").value,
    MaxDepegBPS: +$("#mandate-depeg").value,
    MaxConcentrationBPS: +$("#mandate-concentration").value,
    MaxCancelRateBPS: +$("#mandate-cancel-rate").value,
    MaxConsecutiveAPIFailures: +$("#mandate-api-failures").value,
    ExpiresAt: new Date(Date.now() + +$("#mandate-expiry").value * 60000).toISOString(),
    TestnetOnly: true,
  };
}
$$('#mandate-form input').forEach((input) => {
  input.addEventListener("input", () => {
    pendingMandate = null;
    $("#mandate-payload").hidden = true;
  });
});
$("#preview-mandate").onclick = async () => {
  try {
    pendingMandate = mandateDraft();
    const result = await api("/v1/testnet/signing-payloads/mandate", { method: "POST", body: JSON.stringify(pendingMandate) });
    $("#mandate-payload").textContent = `${result.payload}\n\nSHA-256 ${result.digest}`;
    $("#mandate-payload").hidden = false;
  } catch (e) {
    toast(e.message);
  }
};
$("#mandate-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!pendingMandate) return toast("Preview the exact mandate payload before signing");
  try {
    await window.YNXQuantWallet.approveMandate(pendingMandate);
  } catch (e) {
    toast(e.message);
  }
};
function orderDraft() {
  return {
    Account: $("#mandate-account").value.trim(),
    Market: "YNXT-YUSD_TEST",
    Side: $("#order-side").value,
    Price: +$("#order-price").value,
    Amount: +$("#order-amount").value,
    IdempotencyKey: $("#order-key").value.trim(),
  };
}
$("#preview-order").onclick = async () => {
  try {
    const result = await api("/v1/testnet/signing-payloads/order", { method: "POST", body: JSON.stringify(orderDraft()) });
    $("#order-payload").textContent = `${result.payload}\n\nSHA-256 ${result.digest}`;
    $("#order-payload").hidden = false;
  } catch (e) {
    toast(e.message);
  }
};
$("#testnet-order-form").onsubmit = async (e) => {
  e.preventDefault();
  const draft = orderDraft();
  try {
    await window.YNXQuantWallet.approveOrder(draft, {
        MandateDigest: $("#order-mandate").value.trim(),
        Side: draft.Side,
        Price: draft.Price,
        Amount: draft.Amount,
        IdempotencyKey: draft.IdempotencyKey,
        Risk: {
          referencePrice: +$("#risk-reference").value,
          estimatedGas: +$("#risk-gas").value,
          observedDailyLoss: +$("#risk-loss").value,
          equity: +$("#risk-equity").value,
          grossExposure: +$("#risk-exposure").value,
          peakEquity: +$("#risk-peak").value,
          currentEquity: +$("#risk-current").value,
          availableLiquidity: +$("#risk-liquidity").value,
          depegBps: +$("#risk-depeg").value,
          concentrationBps: +$("#risk-concentration").value,
          ordersObserved: +$("#risk-orders").value,
          cancelsObserved: +$("#risk-cancels").value,
          consecutiveApiFailures: +$("#risk-api-failures").value,
          var: +$("#risk-var").value,
          expectedShortfall: +$("#risk-es").value,
          oracleAsOf: new Date().toISOString(),
          venueHealthy: true,
        },
    });
  } catch (e) {
    toast(e.message);
  }
};
$("#reconcile").onclick = async () => {
  try {
    await api("/v1/paper/reconcile", {
      method: "POST",
      body: JSON.stringify({
        Cash: snapshot.paper.Cash,
        Position: snapshot.paper.Position,
      }),
    });
    toast("Reconciliation completed: zero difference");
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};
$("#kill").onclick = async () => {
  if (!confirm("Activate the persistent paper/testnet kill switch?")) return;
  try {
    await api("/v1/risk/kill", {
      method: "POST",
      body: JSON.stringify({ reason: "operator user confirmation" }),
    });
    toast("Kill switch active");
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};
applyLocale();
window.YNXQuantWallet.takeActionResult().then((result)=>{if(!result)return;if(result.kind==="mandate"&&result.value?.Digest)$("#order-mandate").value=result.value.Digest;const venue=result.value?.venueStatus||result.value?.VenueStatus;toast(result.kind==="mandate"?"Wallet mandate verified by Exchange and registered":venue?`Exchange order ${venue}; authoritative receipt saved`:"Wallet-authorized order submitted to YNX Testnet");return refresh()}).catch((e)=>toast(e.message));
if (publicMode) {
  ["paper-order", "reconcile", "kill"].forEach((id) => { const control = document.getElementById(id); if (control) control.disabled = true; });
}
refresh().catch((e) => toast("Service unavailable: " + e.message));
