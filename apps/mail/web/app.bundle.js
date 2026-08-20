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
  var state = {
    token: "",
    user: null,
    folder: "inbox",
    messages: [],
    selected: null,
    attachments: [],
    draft: null,
    aiJob: null,
    standardWallet: null
  };
  if ((navigator.language || "").toLowerCase().startsWith("ar")) {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
  }
  var $ = (s) => document.querySelector(s);
  var $$ = (s) => [...document.querySelectorAll(s)];
  var escapeHTML = (v) => String(v ?? "").replace(
    /[&<>'"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]
  );
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2600);
  }
  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...options.headers || {}
    };
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin"
    });
    const body = await response.json().catch(() => ({ detail: "\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6548\u54CD\u5E94" }));
    if (!response.ok) {
      if (response.status === 401) {
        signOut(false);
      }
      throw new Error(body.detail || body.error || `\u8BF7\u6C42\u5931\u8D25 ${response.status}`);
    }
    return body;
  }
  function updateNetwork() {
    const offline = !navigator.onLine;
    $("#offline").hidden = !offline;
    $("#confirm-send").disabled = offline;
    if (offline) $("#draft-state").textContent = "\u79BB\u7EBF\u8349\u7A3F\u4FDD\u5B58\u5728\u6B64\u8BBE\u5907";
  }
  async function walletProviders() {
    const providers = await discoverEIP6963(window, { timeoutMs: 180 });
    if (window.ethereum?.request && !providers.some((entry) => entry.provider === window.ethereum)) {
      providers.push({ info: { uuid: "legacy-injected", name: "Injected wallet" }, provider: window.ethereum });
    }
    return providers;
  }
  async function beginSignIn(recovery = false, metamaskOnly = false) {
    const status = $("#signin-state");
    status.textContent = "Looking for an approved standard wallet\u2026";
    try {
      const providers = await walletProviders();
      const selected = (metamaskOnly ? providers.find((entry) => /metamask/i.test(entry.info?.name || "")) : providers.find((entry) => /ynx/i.test(entry.info?.name || ""))) || providers[0];
      if (!selected) {
        status.innerHTML = 'No compatible wallet was detected. <a href="https://ynxweb4.com/dapp/download" target="_blank" rel="noopener noreferrer">Download YNX Wallet</a> or <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">install MetaMask</a>.';
        return;
      }
      const connection = new StandardWalletConnection(selected.provider, { chain: YNX_TESTNET });
      const connected = await connection.connect();
      await connection.ensureYNXTestnet({ addChain: { chainId: "0x1917", chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: [YNX_MAIL_RUNTIME.evmRpc], blockExplorerUrls: [YNX_MAIL_RUNTIME.explorer] } });
      state.standardWallet = connection;
      $("#wallet-standard-state").textContent = `CONNECTED \xB7 ${connected.account.slice(0, 8)}\u2026${connected.account.slice(-6)} \xB7 0x1917`;
      status.textContent = `Standard Wallet Connection is active${recovery ? " for recovery review" : ""}. Private Mail account service remains degraded; no local or canned session was created.`;
    } catch (error) {
      status.textContent = `Wallet connection failed: ${error.code || "WALLET_CONNECTION_FAILED"}. Guest preview and local drafts remain available.`;
    }
  }
  async function restoreSession() {
    try {
      const result = await api("/v1/auth/session");
      state.token = "cookie";
      state.user = result.user;
    } catch {
      state.token = "";
      state.user = null;
    }
  }
  function signOut(notify = true) {
    state.token = "";
    state.user = null;
    $("#signin").hidden = false;
    if (notify) toast("Mail \u4F1A\u8BDD\u5DF2\u9000\u51FA");
  }
  async function loadMessages() {
    if (!state.token) return;
    $("#app").setAttribute("aria-busy", "true");
    try {
      const q = $("#search").value.trim();
      state.messages = await api(
        `/v1/messages?folder=${encodeURIComponent(state.folder)}&q=${encodeURIComponent(q)}`
      ) || [];
      renderMessages();
    } catch (error) {
      toast(error.message);
    } finally {
      $("#app").setAttribute("aria-busy", "false");
    }
  }
  function renderMessages() {
    const root = $("#messages");
    root.replaceChildren();
    $("#empty").hidden = state.messages.length > 0;
    $("#inbox-count").textContent = state.folder === "inbox" ? state.messages.length : $("#inbox-count").textContent;
    for (const m of state.messages) {
      const button = document.createElement("button");
      button.className = `message${state.selected?.id === m.id ? " selected" : ""}`;
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.innerHTML = `<span class="sender-dot" aria-hidden="true"></span><span><h3>${escapeHTML(m.sender_handle)}</h3><p><b>${escapeHTML(m.subject || "\uFF08\u65E0\u4E3B\u9898\uFF09")}</b> \xB7 ${escapeHTML(m.body)}</p></span><time datetime="${escapeHTML(m.created_at)}">${new Date(m.created_at).toLocaleDateString(void 0, { month: "short", day: "numeric" })}</time>`;
      button.addEventListener("click", () => openMessage(m));
      root.append(button);
    }
  }
  async function openMessage(message) {
    state.selected = message;
    renderMessages();
    $("#ai-begin").disabled = false;
    $("#ai-preview").textContent = `\u53EA\u4F1A\u9009\u62E9\uFF1A${message.subject || "\uFF08\u65E0\u4E3B\u9898\uFF09"}\u3002\u70B9\u51FB\u540E\u518D\u83B7\u53D6 provider\u3001\u6A21\u578B\u4E0E\u6210\u672C\uFF0C\u5C1A\u4E0D\u4F1A\u53D1\u9001\u5185\u5BB9\u3002`;
    try {
      const thread = await api(
        `/v1/threads/${encodeURIComponent(message.thread_id)}`
      );
      const pane = $("#reading-pane");
      pane.classList.add("open");
      pane.innerHTML = `<header class="reader-header"><span class="eyebrow">\u7EBF\u7A0B \xB7 ${thread.length} \u5C01</span><h1>${escapeHTML(message.subject || "\uFF08\u65E0\u4E3B\u9898\uFF09")}</h1><div class="identity"><span><b>${escapeHTML(message.sender_handle)}</b><br><small>\u53D1\u9001\u7ED9 ${message.to.map(escapeHTML).join("\u3001")}</small></span><span class="verified">\u2713 \u7B7E\u540D\u53D1\u4EF6\u4EBA\u8EAB\u4EFD</span></div></header><div class="thread">${thread.map((m) => `<section><div class="identity"><b>${escapeHTML(m.sender_handle)}</b><time>${new Date(m.created_at).toLocaleString()}</time></div><div class="reader-body">${escapeHTML(m.body)}</div>${renderAttachments(m.attachments)}<div class="delivery">${m.deliveries.map((d) => `<span class="pill ${d.state}">${escapeHTML(d.recipient)} \xB7 ${escapeHTML(d.state)}${d.reason ? " \xB7 " + escapeHTML(d.reason) : ""}</span>`).join("")}</div></section>`).join("")}</div><footer class="reader-actions"><button class="primary" id="reply">\u56DE\u590D</button><button class="quiet" data-move="archive">\u5F52\u6863</button><button class="quiet" data-move="spam">\u6807\u8BB0\u5783\u573E\u90AE\u4EF6</button><button class="quiet" id="report">Trust \u4E3E\u62A5</button><button class="quiet" id="close-reader">\u8FD4\u56DE</button></footer>`;
      $("#reply").onclick = () => openCompose(message);
      $("#close-reader").onclick = () => pane.classList.remove("open");
      $$("[data-move]").forEach(
        (b) => b.onclick = () => moveMessage(message.id, b.dataset.move)
      );
      $("#report").onclick = () => reportMessage(message.id);
    } catch (error) {
      toast(error.message);
    }
  }
  function renderAttachments(items = []) {
    if (!items.length) return "";
    return `<div class="attachment-list">${items.map((a) => `<div class="attachment"><span>${escapeHTML(a.name)} \xB7 ${Math.ceil(a.size / 1024)} KB</span><button class="quiet" type="button" data-attachment="${escapeHTML(a.id || a.sha256)}">\u4E0B\u8F7D \xB7 SHA-256 ${escapeHTML(a.sha256.slice(0, 10))}\u2026</button></div>`).join("")}</div>`;
  }
  async function moveMessage(id, folder) {
    try {
      await api(`/v1/messages/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ folder })
      });
      toast(folder === "archive" ? "\u5DF2\u5F52\u6863\uFF0C\u53EF\u4ECE\u5F52\u6863\u6062\u590D" : "\u5DF2\u79FB\u81F3\u5783\u573E\u90AE\u4EF6");
      state.selected = null;
      await loadMessages();
    } catch (error) {
      toast(error.message);
    }
  }
  async function reportMessage(id) {
    const reason = prompt(
      "\u8BF7\u8BF4\u660E Trust \u4E3E\u62A5\u539F\u56E0\uFF08\u81F3\u5C11 8 \u4E2A\u5B57\u7B26\uFF09\u3002\u4E0D\u4F1A\u81EA\u52A8\u5C4F\u853D\u6216\u5904\u7F5A\u5BF9\u65B9\u3002"
    );
    if (!reason) return;
    try {
      await api("/v1/reports", {
        method: "POST",
        body: JSON.stringify({ MessageID: id, Reason: reason })
      });
      toast("Trust \u4E3E\u62A5\u5DF2\u63D0\u4EA4\uFF0C\u53EF\u5728\u5BA1\u8BA1\u8BB0\u5F55\u4E2D\u8FFD\u8E2A\u5E76\u7533\u8BC9");
    } catch (error) {
      toast(error.message);
    }
  }
  function openCompose(reply = null) {
    state.attachments = [];
    state.draft = null;
    $("#attachment-list").replaceChildren();
    $("#to").value = reply ? reply.sender_handle : "";
    $("#subject").value = reply ? `Re: ${reply.subject.replace(/^Re:\s*/i, "")}` : "";
    $("#body").value = "";
    $("#compose-form").dataset.thread = reply?.thread_id || "";
    const local = JSON.parse(
      localStorage.getItem("ynx.mail.offlineDraft") || "null"
    );
    if (!reply && local) {
      $("#to").value = local.to || "";
      $("#subject").value = local.subject || "";
      $("#body").value = local.body || "";
      $("#draft-state").textContent = "\u5DF2\u6062\u590D\u8BBE\u5907\u8349\u7A3F";
    }
    $("#compose-dialog").showModal();
    $("#to").focus();
  }
  function saveLocalDraft() {
    const draft = {
      to: $("#to").value,
      subject: $("#subject").value,
      body: $("#body").value,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    localStorage.setItem("ynx.mail.offlineDraft", JSON.stringify(draft));
    $("#draft-state").textContent = `\u8BBE\u5907\u8349\u7A3F \xB7 ${(/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  async function prepareAttachments(files) {
    state.attachments = [];
    let total = 0;
    for (const file of files) {
      total += file.size;
      if (file.size > 10 * 1024 * 1024 || total > 10 * 1024 * 1024) {
        toast("\u5355\u4E2A\u6216\u5408\u8BA1\u9644\u4EF6\u4E0D\u80FD\u8D85\u8FC7 10 MB");
        state.attachments = [];
        break;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
      ].map((v) => v.toString(16).padStart(2, "0")).join("");
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      state.attachments.push({
        name: file.name,
        media_type: file.type || "application/octet-stream",
        size: file.size,
        sha256: hash,
        content_base64: btoa(binary)
      });
    }
    $("#attachment-list").innerHTML = renderAttachments(state.attachments);
  }
  async function reviewDraft(event) {
    event.preventDefault();
    saveLocalDraft();
    if (!navigator.onLine) {
      toast("\u79BB\u7EBF\u65F6\u53EA\u4FDD\u5B58\u8349\u7A3F\uFF0C\u4E0D\u4F1A\u53D1\u9001");
      return;
    }
    const recipients = $("#to").value.split(",").map((v) => v.trim()).filter(Boolean);
    const draft = {
      thread_id: $("#compose-form").dataset.thread || void 0,
      to: recipients,
      subject: $("#subject").value,
      body: $("#body").value,
      attachments: state.attachments
    };
    try {
      state.draft = await api("/v1/drafts", {
        method: "POST",
        body: JSON.stringify(draft)
      });
      $("#review-content").innerHTML = `<p><b>\u6536\u4EF6\u4EBA\uFF1A</b>${recipients.map(escapeHTML).join("\u3001")}</p><p><b>\u4E3B\u9898\uFF1A</b>${escapeHTML(draft.subject || "\uFF08\u65E0\u4E3B\u9898\uFF09")}</p><p><b>\u6B63\u6587\uFF1A</b>${escapeHTML(draft.body.slice(0, 220))}${draft.body.length > 220 ? "\u2026" : ""}</p><p><b>\u9644\u4EF6\uFF1A</b>${draft.attachments.length} \u4E2A\uFF0C\u5408\u8BA1 ${draft.attachments.reduce((n, a) => n + a.size, 0)} bytes</p>`;
      $("#compose-dialog").close();
      $("#send-review").showModal();
    } catch (error) {
      toast(error.message);
    }
  }
  async function confirmSend() {
    if (!state.draft) return;
    $("#confirm-send").disabled = true;
    try {
      const message = await api(`/v1/drafts/${state.draft.id}/send`, {
        method: "POST",
        body: "{}"
      });
      const failed = message.deliveries.filter((d) => d.state === "failed");
      localStorage.removeItem("ynx.mail.offlineDraft");
      $("#send-review").close();
      toast(
        failed.length ? `\u5DF2\u53D1\u9001\uFF0C${failed.length} \u4E2A\u6536\u4EF6\u4EBA\u6295\u9012\u5931\u8D25` : "\u5DF2\u6279\u51C6\u5E76\u5B8C\u6210 YNX \u5185\u90E8\u6295\u9012"
      );
      state.draft = null;
      await loadMessages();
    } catch (error) {
      toast(error.message);
    } finally {
      $("#confirm-send").disabled = !navigator.onLine;
    }
  }
  async function beginAI() {
    if (!state.selected) return;
    try {
      const kind = $("#ai-kind").value, contextIDs = kind === "organize" ? [...new Set(state.messages.map((message) => message.id))].slice(
        0,
        20
      ) : [state.selected.id];
      state.aiJob = await api("/v1/ai/jobs", {
        method: "POST",
        body: JSON.stringify({ kind, context_ids: contextIDs })
      });
      $("#ai-preview").innerHTML = `<b>\u6570\u636E\u8303\u56F4</b><br>${escapeHTML(state.aiJob.context_preview)}<br><br><b>Provider / \u6A21\u578B</b><br>${escapeHTML(state.aiJob.provider)} \xB7 ${escapeHTML(state.aiJob.model)}<br><br><b>\u6210\u672C\u4F30\u7B97</b><br>${escapeHTML(state.aiJob.cost_estimate || "\u7531 Gateway \u7ED3\u7B97")}<br><small>\u6279\u51C6\u540E\u624D\u4F1A\u53D1\u9001\u9009\u4E2D\u7684 ${contextIDs.length} \u5C01\u90AE\u4EF6\u5185\u5BB9\u3002</small>`;
      $("#ai-begin").textContent = "\u6279\u51C6\u5E76\u5F00\u59CB\uFF08\u53EF\u53D6\u6D88\uFF09";
      $("#ai-begin").onclick = approveAI;
    } catch (error) {
      toast(error.message);
    }
  }
  async function approveAI() {
    const jobID = state.aiJob.id;
    $("#ai-result").innerHTML = '<div class="permission-card">AI \u6B63\u5728\u8FD0\u884C\u5E76\u6D41\u5F0F\u8BB0\u5F55\u72B6\u6001\u3002<button class="quiet" id="ai-cancel">\u53D6\u6D88\u751F\u6210</button></div>';
    $("#ai-cancel").onclick = () => reviewAI("cancel");
    try {
      const job = await api(`/v1/ai/jobs/${jobID}/approve`, {
        method: "POST",
        body: "{}"
      });
      if (job.state === "cancelled") {
        toast("AI \u751F\u6210\u5DF2\u53D6\u6D88\uFF0C\u665A\u5230\u7ED3\u679C\u4E0D\u4F1A\u5E94\u7528");
        return;
      }
      state.aiJob = job;
      $("#ai-result").innerHTML = `<div class="ai-output">${escapeHTML(job.result)}</div><p>\u7ED3\u679C\u5C1A\u672A\u6539\u53D8\u90AE\u4EF6\u6216\u53D1\u9001\u4EFB\u4F55\u5185\u5BB9\u3002</p><div class="reader-actions"><button class="primary" id="ai-apply">\u5BA1\u9605\u5E76\u5E94\u7528</button><button class="quiet" id="ai-reject">\u62D2\u7EDD\u5E76\u4FDD\u7559\u5BA1\u8BA1</button></div>`;
      $("#ai-apply").onclick = () => reviewAI("apply");
      $("#ai-reject").onclick = () => reviewAI("reject");
    } catch (error) {
      if (!String(error.message).includes("canceled")) toast(error.message);
    }
  }
  async function reviewAI(decision) {
    try {
      const job = state.aiJob;
      await api(`/v1/ai/jobs/${job.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision })
      });
      if (decision === "apply" && (job.kind === "draft_reply" || job.kind === "translate")) {
        openCompose(state.selected);
        $("#body").value = job.result;
        saveLocalDraft();
        toast("AI \u7ED3\u679C\u4EC5\u5E94\u7528\u5230\u8349\u7A3F\uFF0C\u4ECD\u9700\u53D1\u9001\u5BA1\u6279");
      } else if (decision === "apply") {
        toast("AI \u5EFA\u8BAE\u5DF2\u4FDD\u7559\uFF1B\u672A\u53D1\u9001\u6216\u79FB\u52A8\u4EFB\u4F55\u90AE\u4EF6");
      } else if (decision === "cancel") {
        toast("AI \u751F\u6210\u5DF2\u53D6\u6D88");
      } else toast("AI \u7ED3\u679C\u5DF2\u62D2\u7EDD");
      state.aiJob = null;
      $("#ai-result").replaceChildren();
    } catch (error) {
      toast(error.message);
    }
  }
  function init() {
    restoreSession().then(async () => {
      if (state.token && state.user) {
        $("#signin").hidden = true;
        $("#account").textContent = state.user.handle.replace("@", "").slice(0, 2).toUpperCase();
        await loadMessages();
      } else $("#signin").hidden = false;
      $("#app").setAttribute("aria-busy", "false");
    });
    $("#wallet-signin").onclick = () => beginSignIn(false);
    $("#account").onclick = showAccount;
    $("#compose").onclick = () => openCompose();
    $("#compose-form").onsubmit = reviewDraft;
    $("#attachments").onchange = (e) => prepareAttachments(e.target.files);
    ["#to", "#subject", "#body"].forEach(
      (s) => $(s).addEventListener("input", () => {
        clearTimeout(window.saveDraftTimer);
        window.saveDraftTimer = setTimeout(saveLocalDraft, 500);
      })
    );
    $("#confirm-send").onclick = confirmSend;
    $("#back-edit").onclick = () => {
      $("#send-review").close();
      $("#compose-dialog").showModal();
    };
    $$(".folder").forEach(
      (b) => b.onclick = () => {
        $$(".folder").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.folder = b.dataset.folder;
        $("#folder-label").textContent = b.textContent.trim();
        loadMessages();
      }
    );
    $("#refresh").onclick = loadMessages;
    let searchTimer;
    $("#search").oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadMessages, 250);
    };
    $("#ai-open").onclick = () => {
      $("#ai-panel").hidden = false;
      $("#ai-open").setAttribute("aria-expanded", "true");
    };
    $("#ai-close").onclick = () => {
      $("#ai-panel").hidden = true;
      $("#ai-open").setAttribute("aria-expanded", "false");
    };
    $("#ai-begin").onclick = beginAI;
    addEventListener("online", () => {
      updateNetwork();
      toast("\u7F51\u7EDC\u5DF2\u6062\u590D\uFF0C\u53EF\u6279\u51C6\u53D1\u9001");
    });
    addEventListener("offline", updateNetwork);
    updateNetwork();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
    setupReaderControls();
  }
  function setupReaderControls() {
    const reader = $("#reading-pane");
    const observer = new MutationObserver(() => {
      const verified = reader.querySelector(".verified");
      if (verified && verified.textContent !== "\u2713 Mail \u670D\u52A1\u7B7E\u540D\u8EAB\u4EFD") verified.textContent = "\u2713 Mail \u670D\u52A1\u7B7E\u540D\u8EAB\u4EFD";
      for (const button of reader.querySelectorAll("[data-attachment]:not([data-ready])")) {
        button.dataset.ready = "1";
        button.onclick = () => {
          const attachment = state.selected?.attachments?.find((item) => (item.id || item.sha256) === button.dataset.attachment);
          if (!attachment) return;
          const bytes = Uint8Array.from(atob(attachment.content_base64), (char) => char.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: attachment.media_type || "application/octet-stream" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = attachment.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1e3);
        };
      }
      const actions = reader.querySelector(".reader-actions");
      if (!actions || !state.selected || reader.querySelector("#block-sender")) return;
      const block = document.createElement("button");
      block.id = "block-sender";
      block.className = "quiet";
      block.textContent = "\u5C4F\u853D\u53D1\u4EF6\u4EBA";
      block.onclick = async () => {
        if (!confirm(`\u5C4F\u853D ${state.selected.sender_handle}\uFF1F\u4E4B\u540E\u53EF\u4ECE\u5BA1\u8BA1\u8BB0\u5F55\u786E\u8BA4\uFF0C\u5E76\u901A\u8FC7\u89E3\u9664\u5C4F\u853D\u63A5\u53E3\u6062\u590D\u3002`)) return;
        try {
          await api("/v1/blocks", { method: "POST", body: JSON.stringify({ handle: state.selected.sender_handle }) });
          toast("\u53D1\u4EF6\u4EBA\u5DF2\u5C4F\u853D\uFF1B\u540E\u7EED\u6295\u9012\u5C06\u660E\u786E\u5931\u8D25");
        } catch (error) {
          toast(error.message);
        }
      };
      actions.insertBefore(block, actions.lastElementChild);
      for (const delivery of state.selected.deliveries.filter((item) => item.state === "failed")) {
        const retry = document.createElement("button");
        retry.className = "quiet";
        retry.textContent = `\u91CD\u8BD5 ${delivery.recipient}`;
        retry.onclick = async () => {
          try {
            await api(`/v1/messages/${state.selected.id}/retry`, { method: "POST", body: JSON.stringify({ recipient: delivery.recipient }) });
            toast("\u5DF2\u91CD\u8BD5\uFF1B\u6295\u9012\u72B6\u6001\u5DF2\u66F4\u65B0");
            await loadMessages();
          } catch (error) {
            toast(error.message);
          }
        };
        actions.insertBefore(retry, actions.lastElementChild);
      }
    });
    observer.observe(reader, { childList: true, subtree: true });
  }
  async function showAccount() {
    const dialog = document.createElement("dialog");
    dialog.className = "review-dialog";
    dialog.innerHTML = `<div class="review-card"><span class="eyebrow">\u6570\u636E\u4E0E\u4F1A\u8BDD</span><h2>Mail \u8D26\u6237</h2><p>${escapeHTML(state.user?.handle || "")}</p><p>\u5BFC\u51FA\u5305\u542B Mail \u6570\u636E\u4E0E\u5BA1\u8BA1\u8BB0\u5F55\uFF0C\u4E0D\u5305\u542B Wallet \u5BC6\u94A5\u6216\u8D26\u6237\u54C8\u5E0C\u3002</p><div class="detail-actions"><button class="quiet" data-action="export">\u5BFC\u51FA JSON</button><button class="quiet" data-action="logout">\u64A4\u9500\u6B64\u8BBE\u5907\u4F1A\u8BDD</button><button class="quiet danger-action" data-action="delete">\u5220\u9664 Mail \u8D26\u6237</button><button class="primary" data-action="close">\u5173\u95ED</button></div></div>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="export"]').onclick = async () => {
      try {
        const data = await api("/v1/account/export"), link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
        );
        link.download = "ynx-mail-export.json";
        link.click();
        URL.revokeObjectURL(link.href);
        toast("Mail \u6570\u636E\u5BFC\u51FA\u5DF2\u751F\u6210");
      } catch (e) {
        toast(e.message);
      }
    };
    dialog.querySelector('[data-action="logout"]').onclick = () => {
      if (confirm("\u64A4\u9500\u6B64 Mail \u8BBE\u5907\u4F1A\u8BDD\u5E76\u9000\u51FA\uFF1F"))
        api("/v1/auth/session", { method: "DELETE", body: "{}" }).finally(
          () => signOut()
        );
    };
    dialog.querySelector('[data-action="delete"]').onclick = async () => {
      const phrase = prompt("\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002\u8F93\u5165 DELETE MAIL ACCOUNT \u7EE7\u7EED\uFF1A");
      if (phrase !== "DELETE MAIL ACCOUNT")
        return toast("\u786E\u8BA4\u77ED\u8BED\u4E0D\u5339\u914D\uFF0C\u672A\u5220\u9664");
      try {
        await api("/v1/account", {
          method: "DELETE",
          body: JSON.stringify({ confirmation: phrase })
        });
        dialog.close();
        signOut(false);
        toast("Mail \u8D26\u6237\u5DF2\u5220\u9664\u5E76\u4FDD\u7559\u6700\u5C0F\u5BA1\u8BA1\u5893\u7891");
      } catch (e) {
        toast(e.message);
      }
    };
    dialog.showModal();
  }
  init();
  $("#wallet-signin").onclick = () => beginSignIn(false);
  $("#wallet-recover").onclick = () => beginSignIn(true);
  $("#wallet-metamask").onclick = () => beginSignIn(false, true);
  $("#guest-preview").onclick = () => {
    $("#signin").hidden = true;
    toast("Guest preview enabled. Sending and private inbox remain unavailable.");
  };
  var auditButton = document.createElement("button");
  auditButton.className = "avatar";
  auditButton.textContent = "\u5BA1";
  auditButton.setAttribute("aria-label", "\u6253\u5F00\u5BA1\u8BA1\u4E0E Trust \u6848\u4EF6");
  auditButton.onclick = showAudit;
  $("#ai-open").before(auditButton);
  async function showAudit() {
    try {
      const [audit, cases] = await Promise.all([
        api("/v1/audit"),
        api("/v1/reports")
      ]);
      const dialog = document.createElement("dialog");
      dialog.className = "review-dialog";
      const card = document.createElement("div");
      card.className = "review-card";
      card.innerHTML = '<span class="eyebrow">\u8D26\u6237\u8BC1\u636E</span><h2>\u5BA1\u8BA1\u4E0E Trust \u6848\u4EF6</h2><p>\u4EC5\u663E\u793A\u5F53\u524D Mail \u8D26\u6237\u53EF\u8BBF\u95EE\u7684\u64CD\u4F5C\u548C\u6848\u4EF6\u3002</p>';
      const list = document.createElement("div");
      for (const entry of audit.slice(-20).reverse()) {
        const row = document.createElement("p");
        row.textContent = `${new Date(entry.created_at).toLocaleString()} \xB7 ${entry.action}`;
        list.append(row);
      }
      for (const item of cases) {
        const row = document.createElement("div");
        row.className = "permission-card";
        row.textContent = `Trust ${item.id} \xB7 ${item.state} \xB7 ${item.reason}`;
        if (item.state !== "appealed") {
          const button = document.createElement("button");
          button.className = "quiet";
          button.textContent = "\u63D0\u4EA4\u7533\u8BC9";
          button.onclick = async () => {
            const text = prompt("\u7533\u8BC9\u8BF4\u660E\uFF08\u81F3\u5C11 8 \u4E2A\u5B57\u7B26\uFF09");
            if (!text) return;
            try {
              await api(`/v1/reports/${item.id}/appeal`, {
                method: "POST",
                body: JSON.stringify({ text })
              });
              dialog.close();
              toast("Trust \u7533\u8BC9\u5DF2\u63D0\u4EA4\u5E76\u5199\u5165\u5BA1\u8BA1");
            } catch (e) {
              toast(e.message);
            }
          };
          row.append(button);
        }
        list.append(row);
      }
      card.append(list);
      const close = document.createElement("button");
      close.className = "primary";
      close.textContent = "\u5173\u95ED";
      close.onclick = () => dialog.close();
      card.append(close);
      dialog.append(card);
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove());
      dialog.showModal();
    } catch (e) {
      toast(e.message);
    }
  }
})();
