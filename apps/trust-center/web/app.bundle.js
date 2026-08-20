(() => {
  // ../../packages/dapp-connect-sdk/src/constants.js
  var YNX_TESTNET = Object.freeze({
    cosmosChainId: "ynx_6423-1",
    evmChainId: 6423,
    evmChainHex: "0x1917",
    nativeAsset: "YNXT",
    externalAccountFormat: "0x-prefixed EVM account only"
  });
  var WALLET_PROTOCOL_REFERENCE = Object.freeze({
    version: "p0-wallet-connection-v1",
    sourceCommit: "66003e76e804da16d472255efde50cb879055b96",
    contractPath: "packages/wallet-auth/integration/p0-wallet-connectivity-candidate.json"
  });
  var EIP1193_METHODS = Object.freeze({
    accounts: "eth_requestAccounts",
    chainId: "eth_chainId",
    addChain: "wallet_addEthereumChain",
    switchChain: "wallet_switchEthereumChain",
    sign: "personal_sign",
    signTypedData: "eth_signTypedData_v4",
    sendTransaction: "eth_sendTransaction"
  });

  // ../../packages/dapp-connect-sdk/src/errors.js
  var EIP1193_CODES = /* @__PURE__ */ new Map([
    [4001, "WALLET_USER_REJECTED"],
    [4100, "WALLET_UNAUTHORIZED"],
    [4200, "WALLET_UNSUPPORTED_METHOD"],
    [4900, "WALLET_DISCONNECTED"],
    [4901, "WALLET_CHAIN_DISCONNECTED"]
  ]);
  var PROTOCOL_CODES = /* @__PURE__ */ new Set(["UNKNOWN_OR_MISSING_FIELD", "NON_CANONICAL_JSON", "INVALID_JSON", "INVALID_FIELD", "INVALID_PROOF_HEADER"]);
  var DEVICE_CODES = /* @__PURE__ */ new Set(["INVALID_DEVICE_PROOF", "INVALID_DEVICE_KEY", "DEVICE_MISMATCH", "SESSION_BINDING_MISMATCH"]);
  var EXPIRY_CODES = /* @__PURE__ */ new Set(["EXPIRED", "INVALID_EXPIRY", "INVALID_TIME", "ISSUED_IN_FUTURE"]);
  var GATEWAY_STATUSES = /* @__PURE__ */ new Set([502, 503, 504]);
  var DAppConnectError = class extends Error {
    constructor(code, message, { cause, requestId, traceId, errorId, details } = {}) {
      super(message, { cause });
      this.name = "DAppConnectError";
      this.code = code;
      this.requestId = requestId;
      this.traceId = traceId;
      this.errorId = errorId;
      this.details = details;
    }
  };
  function classifyWalletError(error) {
    const status = Number(error?.status ?? error?.response?.status);
    const serverCode = error?.code ?? error?.response?.data?.code;
    const correlation = { requestId: error?.requestId ?? error?.response?.headers?.["x-request-id"], traceId: error?.traceId ?? error?.response?.headers?.["x-trace-id"], errorId: error?.errorId ?? error?.response?.headers?.["x-error-id"] };
    if (EIP1193_CODES.has(Number(serverCode))) return new DAppConnectError(EIP1193_CODES.get(Number(serverCode)), error?.message || "Wallet request failed", { cause: error, ...correlation });
    if (DEVICE_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_DEVICE_PROOF_REJECTED", error?.message || "Product Session device proof was rejected", { cause: error, ...correlation });
    if (PROTOCOL_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_PROTOCOL_REJECTED", error?.message || "Product Session protocol was rejected", { cause: error, ...correlation });
    if (EXPIRY_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW", error?.message || "Product Session expired or clock is incorrect", { cause: error, ...correlation });
    if (GATEWAY_STATUSES.has(status) || error?.name === "AbortError" || error?.network === true) return new DAppConnectError("PRODUCT_SESSION_GATEWAY_UNREACHABLE", error?.message || "Product Session gateway is unreachable", { cause: error, ...correlation });
    return new DAppConnectError(serverCode || "WALLET_CONNECTION_FAILED", error?.message || "Wallet connection failed", { cause: error, ...correlation });
  }

  // ../../packages/dapp-connect-sdk/src/provider.js
  function validAddress(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
  }
  function assertProvider(provider) {
    if (!provider || typeof provider.request !== "function") throw new DAppConnectError("PROVIDER_REQUIRED", "A standard EIP-1193 wallet provider is required.");
  }
  var StandardWalletConnection = class {
    constructor(provider, { chain = YNX_TESTNET } = {}) {
      assertProvider(provider);
      this.provider = provider;
      this.chain = chain;
      this.account = null;
      this.chainId = null;
    }
    async connect() {
      try {
        const accounts = await this.provider.request({ method: EIP1193_METHODS.accounts });
        if (!Array.isArray(accounts) || !validAddress(accounts[0])) throw new DAppConnectError("INVALID_EVM_ACCOUNT", "Wallet did not return an approved 0x EVM account.");
        this.account = accounts[0];
        this.chainId = await this.provider.request({ method: EIP1193_METHODS.chainId });
        return { account: this.account, chainId: this.chainId, state: "STANDARD_CONNECTED" };
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async ensureYNXTestnet({ addChain } = {}) {
      try {
        const current = await this.provider.request({ method: EIP1193_METHODS.chainId });
        if (String(current).toLowerCase() === this.chain.evmChainHex) return { chainId: current, switched: false };
        try {
          await this.provider.request({ method: EIP1193_METHODS.switchChain, params: [{ chainId: this.chain.evmChainHex }] });
        } catch (error) {
          if (Number(error?.code) !== 4902 || !addChain) throw error;
          await this.provider.request({ method: EIP1193_METHODS.addChain, params: [addChain] });
        }
        this.chainId = await this.provider.request({ method: EIP1193_METHODS.chainId });
        if (String(this.chainId).toLowerCase() !== this.chain.evmChainHex) throw new DAppConnectError("WRONG_CHAIN", "Wallet did not switch to YNX Testnet.");
        return { chainId: this.chainId, switched: true };
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async signMessage(message, account = this.account) {
      if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.sign, params: [message, account] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async signTypedData(typedData, account = this.account) {
      if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.signTypedData, params: [account, JSON.stringify(typedData)] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async sendTransaction(transaction) {
      if (!this.account) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before sending a transaction.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.sendTransaction, params: [{ ...transaction, from: transaction.from || this.account }] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    on(event, listener) {
      if (typeof this.provider.on !== "function") throw new DAppConnectError("PROVIDER_EVENTS_UNSUPPORTED", "Wallet provider does not expose EIP-1193 events.");
      this.provider.on(event, listener);
      return () => this.provider.removeListener?.(event, listener);
    }
  };

  // ../../packages/dapp-connect-sdk/src/discovery.js
  async function discoverEIP6963(windowLike, { timeoutMs = 250 } = {}) {
    if (!windowLike?.addEventListener || !windowLike?.dispatchEvent) throw new DAppConnectError("DISCOVERY_ENVIRONMENT_REQUIRED", "EIP-6963 discovery requires a browser event target.");
    const providers = /* @__PURE__ */ new Map();
    const receive = (event) => {
      const detail = event?.detail;
      if (detail?.info?.uuid && detail?.provider?.request) providers.set(detail.info.uuid, detail);
    };
    windowLike.addEventListener("eip6963:announceProvider", receive);
    windowLike.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    windowLike.removeEventListener("eip6963:announceProvider", receive);
    return [...providers.values()];
  }

  // web/app.js
  var $ = (s) => document.querySelector(s);
  var $$ = (s) => [...document.querySelectorAll(s)];
  var tr = (k) => YNXI18n.t(k);
  var selectedCase = "";
  var preparedAI = "";
  var allCases = [];
  var currentFilter = "all";
  var standardWallet = null;
  var key = () => crypto.randomUUID();
  var identity = () => ({});
  async function api(path, options = {}) {
    const r = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...identity(), ...options.headers || {} } });
    let body = {};
    try {
      body = await r.json();
    } catch {
      body = { error: `Invalid API response (${r.status})` };
    }
    if (!r.ok) throw new Error(body.error || `Request failed: ${r.status}`);
    return body;
  }
  function setStatus(text, error = false) {
    const root = $("#status");
    root.classList.toggle("error", error);
    root.querySelector("span").textContent = text;
  }
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function activate(view) {
    $$(".nav").forEach((x) => x.classList.toggle("active", x.dataset.view === view));
    $$(".view").forEach((x) => x.classList.toggle("hidden", x.id !== view));
    const names2 = { cases: "Request desk", submit: "Evidence intake", authority: "Review & appeal", ai: "AI explanation", transparency: "Transparency" };
    $("#view-title").textContent = names2[view];
    if (view === "transparency") loadTransparency();
  }
  $$(".nav").forEach((b) => b.onclick = () => activate(b.dataset.view));
  async function load() {
    setStatus(tr("loadingCases"));
    try {
      const d = await api("/api/state");
      allCases = d.cases || [];
      renderCases();
      setStatus(`${YNXI18n.number(allCases.length)} ${tr("cases")}`);
    } catch (e) {
      allCases = [];
      renderCases();
      setStatus(`${tr("unavailable")}: ${e.message}`, true);
    }
  }
  function matches(c) {
    if (currentFilter === "all") return true;
    if (currentFilter === "rejected") return ["illegal_or_abusive", "overbroad", "out_of_scope", "rejected"].includes(c.status);
    return c.status === currentFilter;
  }
  function renderCases() {
    const root = $("#case-list");
    root.replaceChildren();
    const cases = allCases.filter(matches);
    if (!cases.length) {
      root.append($("#empty").content.cloneNode(true));
      const action = root.querySelector("[data-empty-action]");
      if (action) action.onclick = () => activate("submit");
      $("#case-detail").className = "detail-empty";
      $("#case-detail").innerHTML = '<p class="eyebrow">EVIDENCE INSPECTOR</p><h3>No request selected</h3><p>Empty and unavailable states never contain synthetic cases.</p>';
      return;
    }
    cases.forEach((c) => {
      const b = document.createElement("button");
      b.className = `case-row ${c.id === selectedCase ? "active" : ""}`;
      b.dataset.id = c.id;
      b.innerHTML = `<span class="row-top"><b>${esc(c.subject)}</b><span class="state ${esc(c.status)}">${esc(c.status.replaceAll("_", " "))}</span></span><p>${esc(c.purpose)}</p><small>${esc(c.id)} \xB7 ${YNXI18n.date(c.updatedAt)}</small>`;
      b.onclick = () => {
        selectedCase = c.id;
        renderCases();
        renderDetail(c);
      };
      root.append(b);
    });
    const selected = cases.find((c) => c.id === selectedCase) || cases[0];
    selectedCase = selected.id;
    root.querySelector(`[data-id="${CSS.escape(selected.id)}"]`)?.classList.add("active");
    renderDetail(selected);
  }
  function renderDetail(c) {
    const evidence = (c.evidence || []).map((e) => `<div class="evidence-event"><b>${esc(e.source)}</b><p>${esc(e.summary)}</p><div class="hash">packet ${esc(e.packet || "missing")}<br>source ${esc(e.sourceHash || e.digest)}</div><small>${esc(e.authority || "authority missing")} \xB7 ${esc(e.jurisdiction || "jurisdiction missing")} \xB7 ${e.expiresAt ? YNXI18n.date(e.expiresAt) : "expiry missing"}</small></div>`).join("");
    $("#case-detail").className = "";
    $("#case-detail").innerHTML = `<div class="detail-head"><div><p class="eyebrow">${esc(c.id)}</p><h3>${esc(c.subject)}</h3></div><span class="state ${esc(c.status)}">${esc(c.status.replaceAll("_", " "))}</span></div><div class="validity-banner ${esc(c.status)}"><b>Request validity</b>${esc(c.validityReason)}</div><dl class="facts"><dt>Requester</dt><dd>${esc(c.requester)}</dd><dt>Authority</dt><dd>${esc(c.authority || "Not supplied")}</dd><dt>Jurisdiction</dt><dd>${esc(c.jurisdiction || "Not supplied")}</dd><dt>Scope</dt><dd>${esc(c.requestScope)}</dd><dt>Asset boundary</dt><dd>${esc(c.assetBoundary || "Not supplied")}</dd><dt>Request expiry</dt><dd>${c.requestExpiresAt && !c.requestExpiresAt.startsWith("0001-") ? YNXI18n.date(c.requestExpiresAt) : "Not supplied"}</dd><dt>User notice</dt><dd>${c.notice ? `${YNXI18n.date(c.notice.sentAt)} \xB7 ${esc(c.notice.reason)}` : "Pending"}</dd><dt>Appeals</dt><dd>${(c.appeals || []).length} \xB7 correction path remains open</dd><dt>Advisory label</dt><dd>${c.label ? `${esc(c.label.value)} \xB7 ${esc(c.label.confidence)} confidence \xB7 ${esc(c.label.severity)} \xB7 advisory only` : "None"}</dd></dl><p class="eyebrow">EVIDENCE TIMELINE</p><div class="timeline">${evidence || '<div class="evidence-event">No evidence packet.</div>'}</div><div class="detail-actions"><button data-ai-case="${esc(c.id)}">Explain with AI</button><button data-appeal-case="${esc(c.id)}">Open appeal path</button></div>`;
    $("#case-detail [data-ai-case]").onclick = () => {
      selectedCase = c.id;
      activate("ai");
      setStatus(`Selected ${c.id}; preview context before permission.`);
    };
    $("#case-detail [data-appeal-case]").onclick = () => activate("authority");
  }
  $$(".filter").forEach((b) => b.onclick = () => {
    currentFilter = b.dataset.filter;
    $$(".filter").forEach((x) => x.classList.toggle("active", x === b));
    renderCases();
  });
  $("#refresh").onclick = load;
  $("#case-form").onsubmit = async (e) => {
    e.preventDefault();
    setStatus("Private Trust submission is degraded because the accepted App Gateway is unavailable. Your form remains on this device; no local or synthetic authority record was created.", true);
  };
  $("#ai-prepare").onclick = async () => {
    if (!selectedCase) {
      setStatus(tr("selectCase"), true);
      return;
    }
    const context = $$("#ai-context input:checked").map((x) => x.value);
    try {
      const r = await api("/api/actions", { method: "POST", body: JSON.stringify({ type: "ai_prepare", idempotencyKey: key(), caseId: selectedCase, purpose: "Explain evidence, validity and appeal options", context, language: $("#ai-language").value }) });
      preparedAI = r.ai.id;
      $("#ai-result").innerHTML = `<p class="eyebrow">PERMISSION PREVIEW</p><b>${esc(tr("privacyPreview"))}</b><p>${esc(r.ai.privacyPreview)}</p><dl class="facts"><dt>Provider / model</dt><dd>${esc(r.ai.provider)} / ${esc(r.ai.model)}</dd><dt>Status</dt><dd>${esc(r.ai.status)}</dd><dt>Language</dt><dd>${esc(r.ai.outputLanguage)}</dd><dt>Estimated cost</dt><dd>${YNXI18n.number(r.ai.estimatedCredits)} AI Credits</dd></dl><button id="run-ai">${esc(tr("allowAI"))}</button> <button id="cancel-ai">${esc(tr("cancel"))}</button>`;
      $("#run-ai").onclick = runAI;
      $("#cancel-ai").onclick = cancelAI;
    } catch (e) {
      setStatus(`${tr("unavailable")}: ${e.message}`, true);
    }
  };
  async function runAI() {
    try {
      $(`#ai-result`).textContent = tr("loading");
      const r = await api("/api/actions", { method: "POST", body: JSON.stringify({ type: "ai_run", idempotencyKey: key(), aiId: preparedAI, permission: true }) });
      if (r.ai.status === "completed") $("#ai-result").innerHTML = `<p class="eyebrow">HUMAN REVIEW REQUIRED</p><p>${esc(r.ai.result)}</p><button id="apply-ai">Apply explanation</button> <button id="reject-ai">Reject explanation</button>`, $("#apply-ai").onclick = () => reviewAI("apply"), $("#reject-ai").onclick = () => reviewAI("reject");
      else $("#ai-result").textContent = `${tr("providerFailure")}: ${r.ai.error}`;
      setStatus(tr("aiStored"));
    } catch (e) {
      setStatus(`${tr("providerFailure")}: ${e.message}`, true);
    }
  }
  async function reviewAI(decision) {
    try {
      const r = await api("/api/actions", { method: "POST", body: JSON.stringify({ type: "ai_review", idempotencyKey: key(), aiId: preparedAI, decision }) });
      $("#ai-result").textContent = `Explanation ${r.ai.status}. No Trust decision or label changed.`;
    } catch (e) {
      setStatus(e.message, true);
    }
  }
  async function cancelAI() {
    try {
      await api("/api/actions", { method: "POST", body: JSON.stringify({ type: "ai_cancel", idempotencyKey: key(), aiId: preparedAI }) });
      $("#ai-result").textContent = tr("aiCancelled");
    } catch (e) {
      setStatus(e.message, true);
    }
  }
  async function loadTransparency() {
    try {
      const path = sessionStorage.getItem("ynxTrustSessionBinding") ? "/api/authority/transparency" : "/api/transparency";
      const d = await api(path);
      $("#transparency-data").innerHTML = `<pre>${esc(JSON.stringify(d, null, 2))}</pre>`;
    } catch (e) {
      $("#transparency-data").innerHTML = `<div class="validity-banner"><b>Unavailable</b>${esc(e.message)}. No local transparency result substituted.</div>`;
    }
  }
  $("#authority-query").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), base = { evidence: "evidence", governance: "governance/requests", appeal: "appeals" }[f.get("kind")];
    try {
      $("#authority-result").textContent = JSON.stringify(await api(`/api/authority/${base}/${encodeURIComponent(f.get("id"))}`), null, 2);
    } catch (x) {
      $("#authority-result").textContent = `${x.message}. ${tr("localResultBlocked")}`;
    }
  };
  $("#appeal-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      $(`#authority-result`).textContent = JSON.stringify(await api("/api/authority/appeals", { method: "POST", body: JSON.stringify({ idempotencyKey: key(), subjectId: f.get("subjectId"), reason: f.get("reason"), evidence: JSON.parse(f.get("evidence")) }) }), null, 2);
    } catch (x) {
      $("#authority-result").textContent = x.message;
    }
  };
  $("#review-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      $(`#authority-result`).textContent = JSON.stringify(await api(`/api/authority/governance/requests/${encodeURIComponent(f.get("id"))}/review`, { method: "POST", body: JSON.stringify(JSON.parse(f.get("review"))) }), null, 2);
    } catch (x) {
      $("#authority-result").textContent = x.message;
    }
  };
  var names = { en: "English", "zh-Hans": "\u7B80\u4F53\u4E2D\u6587", "zh-Hant": "\u7E41\u9AD4\u4E2D\u6587", ja: "\u65E5\u672C\u8A9E", ko: "\uD55C\uAD6D\uC5B4", es: "Espa\xF1ol", fr: "Fran\xE7ais", de: "Deutsch", pt: "Portugu\xEAs", ru: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", ar: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", id: "Bahasa Indonesia" };
  $$(".locale-select,#ai-language").forEach((s) => {
    s.innerHTML = YNXI18n.codes.map((c) => `<option value="${c}">${names[c]}</option>`).join("");
    s.value = s.id === "ai-language" ? localStorage.getItem("ynxTrustAILocale") || YNXI18n.locale : YNXI18n.locale;
  });
  function syncLocaleLabel() {
    const n = $(".locale-current");
    if (n) n.textContent = names[YNXI18n.locale];
  }
  syncLocaleLabel();
  $(".locale-select").onchange = (e) => {
    YNXI18n.set(e.target.value);
    syncLocaleLabel();
    const menu = e.target.closest("details");
    if (menu) menu.open = false;
    load();
  };
  $("#ai-language").onchange = (e) => localStorage.setItem("ynxTrustAILocale", e.target.value);
  $("#wallet-open").onclick = () => $("#wallet").classList.remove("hidden");
  $(".sheet-close").onclick = () => $("#wallet").classList.add("hidden");
  async function availableProviders() {
    const announced = await discoverEIP6963(window, { timeoutMs: 180 });
    if (window.ethereum?.request && !announced.some((x) => x.provider === window.ethereum)) announced.push({ info: { uuid: "legacy-injected", name: "Injected wallet" }, provider: window.ethereum });
    return announced;
  }
  async function connectStandard({ metamaskOnly = false } = {}) {
    const result = $("#wallet-result");
    result.textContent = "Looking for an approved standard wallet\u2026";
    try {
      const providers = await availableProviders(), chosen = (metamaskOnly ? providers.find((x) => /metamask/i.test(x.info?.name || "")) : providers.find((x) => /ynx/i.test(x.info?.name || ""))) || providers[0];
      if (!chosen) {
        result.innerHTML = `No compatible wallet was detected. <a href="${globalThis.YNX_TRUST_RUNTIME.walletDownload}" target="_blank" rel="noopener noreferrer">Download YNX Wallet</a> or <a href="${globalThis.YNX_TRUST_RUNTIME.metamaskDownload}" target="_blank" rel="noopener noreferrer">install MetaMask</a>.`;
        return;
      }
      const connection = new StandardWalletConnection(chosen.provider, { chain: YNX_TESTNET }), connected = await connection.connect();
      await connection.ensureYNXTestnet({ addChain: { chainId: "0x1917", chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: [globalThis.YNX_TRUST_RUNTIME.evmRpc.url], blockExplorerUrls: [globalThis.YNX_TRUST_RUNTIME.explorer.url] } });
      standardWallet = connection;
      $("#wallet-account").textContent = `${connected.account.slice(0, 8)}\u2026${connected.account.slice(-6)}`;
      $("#wallet-standard-state").textContent = "CONNECTED \xB7 0x1917";
      $("#wallet-open").textContent = "Wallet connected";
      result.textContent = "Standard Wallet Connection is active. The unavailable private Trust service did not remove it.";
      chosen.provider.on?.("accountsChanged", (accounts) => {
        if (!accounts?.[0]) {
          $("#wallet-standard-state").textContent = "DISCONNECTED";
          $("#wallet-account").textContent = "Not connected";
        }
      });
      chosen.provider.on?.("chainChanged", (chainId) => {
        $("#wallet-standard-state").textContent = String(chainId).toLowerCase() === "0x1917" ? "CONNECTED \xB7 0x1917" : "WRONG CHAIN";
      });
    } catch (error) {
      result.textContent = `Wallet connection failed: ${error.code || "WALLET_CONNECTION_FAILED"}. Public Trust records remain available.`;
    }
  }
  $("#wallet-connect").onclick = () => connectStandard();
  $("#wallet-metamask").onclick = () => connectStandard({ metamaskOnly: true });
  function applyPrefs() {
    document.body.classList.toggle("large-text", localStorage.getItem("ynxTrustLargeText") === "1");
    document.body.classList.toggle("theme-dark", localStorage.getItem("ynxTrustTheme") === "dark");
    $("#text-size").setAttribute("aria-pressed", String(document.body.classList.contains("large-text")));
    $("#theme-toggle").setAttribute("aria-pressed", String(document.body.classList.contains("theme-dark")));
  }
  $("#text-size").onclick = () => {
    localStorage.setItem("ynxTrustLargeText", document.body.classList.contains("large-text") ? "0" : "1");
    applyPrefs();
  };
  $("#theme-toggle").onclick = () => {
    localStorage.setItem("ynxTrustTheme", document.body.classList.contains("theme-dark") ? "light" : "dark");
    applyPrefs();
  };
  applyPrefs();
  load();
})();
