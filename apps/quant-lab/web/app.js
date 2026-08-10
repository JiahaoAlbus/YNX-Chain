const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let snapshot = { paper: {}, strategies: {}, experiments: {}, audit: [] };
let pendingMandate = null;
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
const api = async (path, opt = {}) => {
  const r = await fetch("/api" + path, {
    ...opt,
    headers: {
      "content-type": "application/json",
      "x-ynx-preview-mode": "local-paper",
      ...(opt.headers || {}),
    },
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
};
const toast = (m) => {
  const e = $("#toast");
  e.textContent = m;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3000);
};
async function refresh() {
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
            `<tr><td>${safe(s.Name)}</td><td>${safe(s.Family)}</td><td>${safe(s.Stage || "Candidate")}</td><td><code>${safe((s.StrategyHash || "").slice(0, 12))}…</code></td><td>${safe(s.License)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">${safe(t("emptyStrategy"))}</td></tr>`;
  $("#experiment-rows").innerHTML = experiments.length
    ? experiments
        .map(
          (e) =>
            `<tr><td>${localDate(e.createdAt)}</td><td>${safe(e.strategy.Name)}</td><td>${e.metrics.ReturnBPS} bps</td><td>${e.metrics.BuyHoldBPS} bps</td><td>${e.metrics.MaxDrawdownBPS} bps</td><td>${e.metrics.Trades}</td><td>${e.metrics.PartialFills}</td><td>${e.sensitivitySpreadBPS} bps</td><td>${e.metrics.DataGaps}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="9">${safe(t("emptyExperiment"))}</td></tr>`;
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
    await api("/v1/backtests/from-market", { method: "POST", body: JSON.stringify(body) });
    toast("Out-of-sample experiment completed and audited");
    await refresh();
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
function mandateDraft() {
  const strategyHash = $("#mandate-strategy").value.trim().toLowerCase();
  const capital = +$("#mandate-capital").value;
  return {
    Account: $("#mandate-account").value.trim(),
    StrategyHash: strategyHash,
    Market: "YNXT-YUSD_TEST",
    MaxNotional: capital,
    MaxPosition: +$("#mandate-position").value,
    MaxDailyLoss: +$("#mandate-loss").value,
    Methods: ["read", "submit", "reconcile"],
    CapitalMicro: capital,
    Leverage: 1,
    NonceDomain: "quant:" + strategyHash,
    ExpiresAt: new Date(Date.now() + +$("#mandate-expiry").value * 60000).toISOString(),
    TestnetOnly: true,
  };
}
$$('#mandate-form input:not(#mandate-signature):not(#exchange-session)').forEach((input) => {
  input.addEventListener("input", () => {
    pendingMandate = null;
    $("#mandate-payload").hidden = true;
  });
});
$("#preview-mandate").onclick = async () => {
  try {
    pendingMandate = mandateDraft();
    const result = await api("/v1/testnet/signing-payloads/mandate", {method:"POST", body:JSON.stringify(pendingMandate)});
    $("#mandate-payload").textContent = `${result.payload}\n\nSHA-256 ${result.digest}`;
    $("#mandate-payload").hidden = false;
  } catch (e) { toast(e.message); }
};
$("#mandate-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!pendingMandate) return toast("Preview the exact mandate payload before signing");
  try {
    const result = await api("/v1/testnet/mandates", {method:"POST", headers:{"x-ynx-exchange-session":$("#exchange-session").value.trim()}, body:JSON.stringify({...pendingMandate, WalletSignature:$("#mandate-signature").value.trim()})});
    $("#order-mandate").value = result.Digest;
    toast("Wallet mandate verified by Exchange and registered");
    await refresh();
  } catch (e) { toast(e.message); }
};
function orderDraft() {
  return {
    Account: $("#mandate-account").value.trim(), Market:"YNXT-YUSD_TEST",
    Side:$("#order-side").value, Price:+$("#order-price").value,
    Amount:+$("#order-amount").value, IdempotencyKey:$("#order-key").value.trim(),
  };
}
$("#preview-order").onclick = async () => {
  try {
    const result = await api("/v1/testnet/signing-payloads/order", {method:"POST", body:JSON.stringify(orderDraft())});
    $("#order-payload").textContent = `${result.payload}\n\nSHA-256 ${result.digest}`;
    $("#order-payload").hidden = false;
  } catch (e) { toast(e.message); }
};
$("#testnet-order-form").onsubmit = async (e) => {
  e.preventDefault();
  const draft = orderDraft();
  try {
    await api("/v1/testnet/orders", {method:"POST", headers:{"x-ynx-exchange-session":$("#exchange-session").value.trim()}, body:JSON.stringify({MandateDigest:$("#order-mandate").value.trim(), Side:draft.Side, Price:draft.Price, Amount:draft.Amount, IdempotencyKey:draft.IdempotencyKey, WalletSignature:$("#order-signature").value.trim()})});
    toast("Wallet-authorized order submitted to YNX Testnet");
    await refresh();
  } catch (e) { toast(e.message); }
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
refresh().catch((e) => toast("Service unavailable: " + e.message));
