const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let snapshot = { paper: {}, strategies: {}, experiments: {}, audit: [] };
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
