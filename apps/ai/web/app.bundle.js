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
  var state = { token: "", deviceId: "", account: "", challengeId: "", conversationId: "", conversationArchived: false, conversations: [], generationId: "", abort: null, lastPrompt: "", archived: false, provider: null, standardWallet: null, guestPreview: false };
  async function api(path, options = {}) {
    const headers = { ...options.body ? { "Content-Type": "application/json" } : {}, ...state.token ? { Authorization: `Bearer ${state.token}`, "X-YNX-Device-ID": state.deviceId } : {} };
    const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  async function loadPublicStatus() {
    const badge = $("#public-status-badge");
    try {
      const response = await fetch("/api/public-status", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.gatewayReady) throw new Error(data.status || "Gateway unavailable");
      badge.textContent = "Gateway ready";
      badge.className = "runtime-badge available";
      $("#public-gateway").textContent = "Operational";
      $("#public-provider").textContent = `${data.provider} \xB7 ${data.model}`;
      $("#public-status-detail").textContent = `${data.status} ${data.providerGenerationEvidence}.`;
      badge.title = `Source: ${data.source} \xB7 ${data.asOf}`;
    } catch (error) {
      badge.textContent = "Unavailable";
      badge.className = "runtime-badge unavailable";
      $("#public-gateway").textContent = "Unavailable";
      $("#public-provider").textContent = "No substitute model";
      $("#public-status-detail").textContent = error.message;
    }
  }
  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 2200);
  }
  function escapeHTML(value = "") {
    return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  }
  async function walletProviders() {
    const providers = await discoverEIP6963(window, { timeoutMs: 220 });
    if (window.ethereum?.request && !providers.some((entry) => entry.provider === window.ethereum)) providers.push({ info: { uuid: "legacy-injected", name: "Injected wallet" }, provider: window.ethereum });
    return providers;
  }
  async function beginStandardWallet(metamaskOnly = false) {
    const status = $("#wallet-standard-state");
    status.textContent = "Looking for a standard EVM wallet\u2026";
    $("#auth-error").textContent = "";
    try {
      const providers = await walletProviders();
      const selected = (metamaskOnly ? providers.find((entry) => /metamask/i.test(entry.info?.name || "")) : providers.find((entry) => /ynx/i.test(entry.info?.name || ""))) || providers[0];
      if (!selected) {
        status.innerHTML = 'No compatible wallet was detected. <a href="https://ynxweb4.com/dapp/download" target="_blank" rel="noopener noreferrer">Download YNX Wallet</a> or <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">install MetaMask</a>.';
        return;
      }
      const connection = new StandardWalletConnection(selected.provider, { chain: YNX_TESTNET });
      const connected = await connection.connect();
      await connection.ensureYNXTestnet({ addChain: { chainId: "0x1917", chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: [YNX_AI_RUNTIME.evmRpc], blockExplorerUrls: [YNX_AI_RUNTIME.explorer] } });
      state.standardWallet = connection;
      state.account = connected.account;
      status.textContent = `CONNECTED \xB7 ${connected.account.slice(0, 8)}\u2026${connected.account.slice(-6)} \xB7 0x1917`;
      $("#private-service-state").textContent = "Standard Wallet is connected. Private YNX AI Product Session is degraded; no local or canned session was created.";
      enterGuest(true);
    } catch (error) {
      status.textContent = `Wallet connection failed: ${error.code || "WALLET_CONNECTION_FAILED"}. Public status and guest preview remain available.`;
    }
  }
  function enterGuest(fromWallet = false) {
    state.guestPreview = true;
    $("#signin").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#account-label").textContent = fromWallet && state.account ? `${state.account.slice(0, 8)}\u2026${state.account.slice(-6)}` : "Guest preview";
    $("#conversation-list").innerHTML = '<p class="cost-line">Private conversations require an available first-party Product Session. No substitute session was created.</p>';
    $("#conversation-title").textContent = "Explore YNX AI safely";
    $("#conversation-kicker").textContent = fromWallet ? "Standard Wallet connected \xB7 private service degraded" : "Guest preview \xB7 no account data loaded";
    $("#empty-state h2").innerHTML = "Inspect provider truth.<br>Keep private context closed.";
    $("#empty-state p:last-child").textContent = "You can inspect runtime availability, model status, safety boundaries and estimated-cost policy without signing in. Generation and private data remain unavailable.";
    $("#prompt").disabled = true;
    $("#prompt").placeholder = "Generation requires an available private Product Session";
    $$(".rail-button[data-panel],#new-conversation").forEach((button) => button.disabled = true);
    void loadPublicProvider();
  }
  async function loadPublicProvider() {
    try {
      const response = await fetch("/api/public-status", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.status || "Unavailable");
      state.provider = data;
      $("#provider-dot").classList.toggle("offline", !data.gatewayReady);
      $("#provider-label").textContent = data.gatewayReady ? "Gateway reachable" : "Gateway unavailable";
      $("#model-label").textContent = `${data.provider || "Provider unknown"} \xB7 ${data.model || "model unknown"} \xB7 generation ${data.generationLive ? "available" : "unproven"}`;
    } catch {
      $("#provider-dot").classList.add("offline");
      $("#provider-label").textContent = "Provider unavailable";
      $("#model-label").textContent = "No substitute answers";
    }
  }
  $("#connect-ynx-wallet").addEventListener("click", () => void beginStandardWallet(false));
  $("#connect-metamask").addEventListener("click", () => void beginStandardWallet(true));
  $("#guest-preview").addEventListener("click", () => enterGuest(false));
  $("#signout").addEventListener("click", async () => {
    if (state.token) {
      try {
        await api("/api/auth/revoke", { method: "POST" });
      } catch {
      }
    }
    sessionStorage.clear();
    location.reload();
  });
  async function loadConversations() {
    const query = $("#conversation-search")?.value?.trim() || "";
    const data = await api(`/api/conversations?archived=${state.archived}&q=${encodeURIComponent(query)}`);
    state.conversations = data.conversations;
    renderConversationList();
    if (!state.conversationId && state.conversations.length) await selectConversation(state.conversations[0].id);
  }
  $("#conversation-search").addEventListener("input", () => {
    void loadConversations().catch((error) => toast(error.message));
  });
  function renderConversationList() {
    const list = $("#conversation-list");
    if (!state.conversations.length) {
      list.innerHTML = `<p class="cost-line">${state.archived ? "No archived conversations." : "No conversations yet."}</p>`;
      return;
    }
    list.innerHTML = state.conversations.map((c) => `<button class="conversation-item ${c.id === state.conversationId ? "active" : ""}" data-id="${c.id}"><strong>${escapeHTML(c.title)}</strong><small>${escapeHTML(c.lastPreview || `${c.messageCount} messages`)}</small></button>`).join("");
    $$(".conversation-item").forEach((b) => b.onclick = () => selectConversation(b.dataset.id));
  }
  async function selectConversation(id) {
    const data = await api(`/api/conversations/${encodeURIComponent(id)}`);
    state.conversationId = id;
    state.conversationArchived = data.conversation.archived;
    $("#conversation-title").textContent = data.conversation.title;
    $("#conversation-kicker").textContent = `${data.conversation.messageCount} messages \xB7 ${data.conversation.retentionDays} day retention`;
    $("#conversation-actions").classList.remove("hidden");
    $("#archive-conversation").textContent = data.conversation.archived ? "Unarchive" : "Archive";
    renderMessages(data.messages);
    renderConversationList();
    if (matchMedia("(max-width: 900px)").matches) document.querySelector(".sessions").classList.remove("open");
  }
  function renderMessages(messages) {
    $("#empty-state").classList.toggle("hidden", messages.length > 0);
    const node = $("#messages");
    node.innerHTML = messages.map(messageHTML).join("");
    node.scrollTop = node.scrollHeight;
  }
  function messageHTML(m) {
    const label = m.role === "assistant" ? "YNX AI" : "You";
    const money = m.cost?.moneyKnown ? `$${m.cost.moneyUsdEstimate.toFixed(6)} est.` : "money unknown";
    const cost = m.role === "assistant" ? `<span class="cost-line">~${m.cost.inputTokensEstimate + m.cost.outputTokensEstimate} tokens \xB7 ${m.cost.resourceUnitsEstimate} resource \xB7 ${money} \xB7 actual usage not reported</span>` : "";
    return `<article class="message" data-message="${m.id}"><div class="message-head"><strong>${label}</strong>${cost}</div><div class="message-body">${escapeHTML(m.content)}</div><div class="message-actions"><button class="text-button copy" type="button">Copy</button>${m.role === "assistant" ? '<button class="text-button retry" type="button">Retry</button><button class="text-button continue" type="button">Continue</button>' : ""}</div></article>`;
  }
  $("#messages").addEventListener("click", (event) => {
    const article = event.target.closest(".message");
    if (!article) return;
    if (event.target.classList.contains("copy")) {
      navigator.clipboard.writeText(article.querySelector(".message-body").textContent);
      toast("Copied");
    }
    if (event.target.classList.contains("retry")) sendPrompt(state.lastPrompt || article.previousElementSibling?.querySelector(".message-body")?.textContent || "", article.dataset.message);
    if (event.target.classList.contains("continue")) sendPrompt("", "", article.dataset.message);
  });
  $("#new-conversation").onclick = async () => {
    const out = await api("/api/conversations", { method: "POST", body: JSON.stringify({ title: "New conversation" }) });
    state.conversationId = out.id;
    await loadConversations();
    await selectConversation(out.id);
    $("#prompt").focus();
  };
  $$(".session-tabs button").forEach((button) => button.onclick = async () => {
    $$(".session-tabs button").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    state.archived = button.dataset.archive === "true";
    state.conversationId = "";
    await loadConversations();
  });
  $("#rename-conversation").onclick = () => openModal("Rename conversation", '<label>Title<input name="title" required maxlength="120"></label>', async (data) => {
    await api(`/api/conversations/${encodeURIComponent(state.conversationId)}`, { method: "PATCH", body: JSON.stringify({ title: data.title }) });
    await selectConversation(state.conversationId);
    await loadConversations();
    toast("Conversation renamed");
  });
  $("#branch-conversation").onclick = async () => {
    const last = $$("#messages .message").at(-1)?.dataset.message || "";
    const branch = await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/branch`, { method: "POST", body: JSON.stringify({ throughMessageId: last, title: `${$("#conversation-title").textContent} \u2014 branch` }) });
    state.conversationId = branch.id;
    await loadConversations();
    await selectConversation(branch.id);
    toast("Independent encrypted branch created");
  };
  $("#archive-conversation").onclick = async () => {
    const wasArchived = state.conversationArchived;
    await api(`/api/conversations/${encodeURIComponent(state.conversationId)}`, { method: "PATCH", body: JSON.stringify({ archived: !wasArchived }) });
    state.conversationId = "";
    $("#conversation-actions").classList.add("hidden");
    await loadConversations();
    toast(wasArchived ? "Conversation unarchived" : "Conversation archived");
  };
  $("#delete-conversation").onclick = () => openModal("Delete conversation", '<p>This removes encrypted content and metadata. Type <strong>delete</strong> to confirm.</p><label>Confirmation<input name="confirmation" required></label>', async (data) => {
    if (data.confirmation !== "delete") throw new Error("Exact confirmation is required");
    await api(`/api/conversations/${encodeURIComponent(state.conversationId)}?confirm=delete`, { method: "DELETE" });
    state.conversationId = "";
    $("#conversation-actions").classList.add("hidden");
    await loadConversations();
    toast("Conversation deleted");
  });
  $("#export-conversation").onclick = async () => {
    const response = await fetch(`/api/conversations/${encodeURIComponent(state.conversationId)}/export`, { headers: { Authorization: `Bearer ${state.token}`, "X-YNX-Device-ID": state.deviceId } });
    if (!response.ok) {
      toast("Export failed");
      return;
    }
    const blob = await response.blob(), href = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = href;
    link.download = "ynx-ai-conversation.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1e3);
  };
  $("#prompt").addEventListener("input", (event) => {
    event.target.style.height = "auto";
    event.target.style.height = Math.min(event.target.scrollHeight, 180) + "px";
    const tokens = Math.ceil([...event.target.value].length / 4);
    $("#estimate").textContent = `~${tokens} input tokens \xB7 ~${Math.ceil(tokens / 1e3)} resource \xB7 money/quota unknown`;
  });
  $("#context-details").onclick = () => $("#exclusion-row").classList.toggle("hidden");
  $("#composer").addEventListener("submit", (event) => {
    event.preventDefault();
    sendPrompt($("#prompt").value);
  });
  async function sendPrompt(prompt, retryOf = "", continueFrom = "") {
    prompt = prompt.trim();
    if (!prompt && !continueFrom || state.generationId) return;
    if (!state.conversationId) {
      const c = await api("/api/conversations", { method: "POST", body: JSON.stringify({ title: prompt.slice(0, 64) }) });
      state.conversationId = c.id;
    }
    if (prompt) state.lastPrompt = prompt;
    state.generationId = crypto.randomUUID();
    state.abort = new AbortController();
    $("#cancel-generation").classList.remove("hidden");
    $("#prompt").value = "";
    $("#empty-state").classList.add("hidden");
    const messages = $("#messages");
    messages.insertAdjacentHTML("beforeend", (prompt ? messageHTML({ id: "local-user", role: "user", content: prompt, cost: {} }) : "") + `<article id="streaming-message" class="message streaming"><div class="message-head"><strong>YNX AI</strong><span class="cost-line">provider-backed stream pending</span></div><div class="message-body"></div></article>`);
    messages.scrollTop = messages.scrollHeight;
    const included = $$(".context-strip input:checked").map((n) => n.value);
    const excluded = $$(".exclusion-row input:checked").map((n) => n.value);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(state.conversationId)}/generate`, { method: "POST", signal: state.abort.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}`, "X-YNX-Device-ID": state.deviceId }, body: JSON.stringify({ generationId: state.generationId, prompt, continueFrom, provider: state.provider?.provider || "", model: state.provider?.model || "", includedContext: included, excludedContext: excluded, retryOf }) });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Generation failed");
      }
      ;
      await consumeSSE(response.body);
    } catch (error) {
      const body = $("#streaming-message .message-body");
      if (body) body.textContent = error.name === "AbortError" ? "Generation cancelled. You can retry safely." : error.message;
      toast("No provider answer was substituted");
    } finally {
      state.generationId = "";
      state.abort = null;
      $("#cancel-generation").classList.add("hidden");
      $("#streaming-message")?.classList.remove("streaming");
      await loadConversations();
      if (state.conversationId) await selectConversation(state.conversationId);
    }
  }
  async function consumeSSE(body) {
    const reader = body.getReader(), decoder = new TextDecoder();
    let buffer = "", terminal = false;
    const deliver = (block) => {
      let event = "", data = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trimStart();
      }
      if (!data || terminal) return;
      const payload = JSON.parse(data);
      if (event === "token") {
        const node = $("#streaming-message .message-body");
        if (node) node.textContent += payload.text;
        $("#messages").scrollTop = $("#messages").scrollHeight;
      }
      if (event === "error") {
        terminal = true;
        throw new Error(payload.error);
      }
      if (event === "done") {
        terminal = true;
        toast("Provider-backed response stored with encrypted policy");
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match = buffer.match(/\r?\n\r?\n/);
      while (match && match.index !== void 0) {
        deliver(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = buffer.match(/\r?\n\r?\n/);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) deliver(buffer);
    if (!terminal) throw new Error("Provider stream ended without a terminal event; no completion was claimed.");
  }
  $("#cancel-generation").onclick = async () => {
    if (!state.generationId) return;
    try {
      await api(`/api/generations/${encodeURIComponent(state.generationId)}/cancel`, { method: "POST" });
    } catch {
    }
    state.abort?.abort();
  };
  $$(".rail-button[data-panel]").forEach((button) => button.onclick = async () => {
    $$(".rail-button").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    $$(".panel").forEach((p) => p.classList.remove("active"));
    $(`#${button.dataset.panel}-panel`).classList.add("active");
    const sessions = document.querySelector(".sessions");
    if (button.dataset.panel === "chat" && matchMedia("(max-width: 900px)").matches) sessions.classList.toggle("open");
    else sessions.classList.remove("open");
    if (button.dataset.panel === "review") await loadReviews();
    if (button.dataset.panel === "control") await loadPrivacy();
    if (button.dataset.panel === "audit") await loadAudit();
  });
  async function loadReviews() {
    const [actions, permissions] = await Promise.all([api("/api/actions"), api("/api/permissions")]);
    $("#action-list").innerHTML = actions.actions.length ? actions.actions.map((a) => `<article class="review-card"><header><div><strong>${escapeHTML(a.kind.replace("_", " "))}</strong><p>${escapeHTML(a.description)}</p></div><span class="badge">${escapeHTML(a.status)}</span></header><p><strong>Target:</strong> ${escapeHTML(a.target)} \xB7 <strong>Risk:</strong> ${escapeHTML(a.risk)} \xB7 <strong>Provider:</strong> ${escapeHTML(a.provider || "not reported")}</p><p><strong>Scope:</strong> ${escapeHTML(a.scope)}${a.walletStillNeeded ? " \xB7 Wallet signature still required" : ""}</p><pre class="payload-preview">${escapeHTML(a.payloadPreview)}</pre><p><strong>Evidence:</strong> ${(a.evidence || []).map(escapeHTML).join(" \xB7 ") || "none supplied"}</p>${a.status === "pending_review" ? `<div class="review-actions"><button class="primary small review-approve" data-id="${a.id}">Approve review</button><button class="danger review-reject" data-id="${a.id}">Reject</button></div>` : ""}</article>`).join("") : '<p class="cost-line">No tool or action proposals.</p>';
    $("#permission-list").innerHTML = permissions.permissions.length ? permissions.permissions.map((p) => `<article class="review-card"><strong>${escapeHTML(p.scope)}</strong><p>${escapeHTML(p.purpose)} \xB7 ${escapeHTML(p.status)}</p><small>${new Date(p.expiresAt).toLocaleString()}</small></article>`).join("") : '<p class="cost-line">No permissions granted.</p>';
    $$(".review-approve").forEach((b) => b.onclick = () => reviewAction(b.dataset.id, "approve", permissions.permissions));
    $$(".review-reject").forEach((b) => b.onclick = () => reviewAction(b.dataset.id, "reject", permissions.permissions));
  }
  $("#new-action").onclick = () => openModal("Create explicit review", `<label>Kind<select name="kind"><option value="tool">Tool</option><option value="action">Product action</option><option value="chain_action">Chain action</option></select></label><label>Scope<input name="scope" required placeholder="read:selected_chain_record"></label><label>Target<input name="target" required placeholder="record:exact-id"></label><label>Risk<select name="risk"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Description<textarea name="description" required></textarea></label><label>Exact payload preview<textarea name="payloadPreview" required></textarea></label><label>Evidence references (one per line)<textarea name="evidence"></textarea></label><label>Provider<input name="provider" placeholder="YNX AI Gateway"></label>`, async (data) => {
    data.evidence = data.evidence.split("\n").map((v) => v.trim()).filter(Boolean);
    await api("/api/actions", { method: "POST", body: JSON.stringify({ ...data, conversationId: state.conversationId || "standalone-review" }) });
    await loadReviews();
    toast("Proposal created; nothing executed");
  });
  function reviewAction(id, decision, permissions) {
    const options = permissions.filter((p) => p.status === "active").map((p) => `<option value="${p.gatewayId}">${escapeHTML(p.scope)} \xB7 ${escapeHTML(p.purpose)}</option>`).join("");
    openModal(decision === "approve" ? "Approve review, not execution" : "Reject action", decision === "approve" ? `<div class="boundary-banner"><strong>This will not execute the action.</strong> Chain actions still stop at YNX Wallet.</div><label>Explicit permission<select name="permissionGatewayId" required>${options}</select></label>` : "<p>Reject this proposal and preserve the audit record?</p>", async (data) => {
      await api(`/api/actions/${id}/review`, { method: "POST", body: JSON.stringify({ decision, ...data }) });
      await loadReviews();
      toast(decision === "approve" ? "Approved, not executed" : "Rejected");
    });
  }
  async function loadPrivacy() {
    if (!state.token) return;
    try {
      const data = await api("/api/privacy");
      $("#retention").value = String(data.policy.retentionDays);
      $("#save-body").checked = data.policy.saveEncryptedBody;
      $$(".policy-context").forEach((n) => n.checked = data.policy.allowedContextTypes.includes(n.value));
    } catch {
    }
  }
  $("#privacy-form").onsubmit = async (event) => {
    event.preventDefault();
    await api("/api/privacy", { method: "PUT", body: JSON.stringify({ retentionDays: Number($("#retention").value), saveEncryptedBody: $("#save-body").checked, allowedContextTypes: $$(".policy-context:checked").map((n) => n.value) }) });
    toast("Data policy saved");
  };
  $("#delete-all").onclick = () => openModal("Delete all YNX AI data", '<p>This cannot be undone. Type <strong>delete-all</strong> to remove local product data.</p><label>Confirmation<input name="confirmation" required></label>', async (data) => {
    if (data.confirmation !== "delete-all") throw new Error("Exact confirmation is required");
    await api("/api/privacy/data?confirm=delete-all", { method: "DELETE" });
    state.conversationId = "";
    await loadConversations();
    toast("All local YNX AI data deleted");
  });
  async function loadAudit() {
    const [usage, audit, appeals] = await Promise.all([api("/api/usage"), api("/api/audit"), api("/api/appeals")]);
    const u = usage.usage;
    $("#usage-cards").innerHTML = [["Generations", u.generations], ["Tokens", `~${u.inputTokensEstimate + u.outputTokensEstimate}`], ["Resource", `~${u.resourceUnitsEstimate}`], ["Money", u.moneyKnown ? `$${u.moneyUsdEstimate.toFixed(6)}` : "Unknown"]].map(([label, value]) => `<div class="usage-card"><strong>${value}</strong><small>${label}${label === "Tokens" || label === "Resource" ? " estimate" : ""}</small></div>`).join("");
    $("#audit-list").innerHTML = audit.audit.slice().reverse().map((a) => `<div class="audit-row"><strong>${escapeHTML(a.type)}</strong><span>${escapeHTML(a.detail)}</span><small>#${a.sequence} \xB7 ${escapeHTML(a.hash.slice(0, 8))}</small></div>`).join("") || '<p class="cost-line">No audit events.</p>';
    $("#appeal-list").innerHTML = appeals.appeals.map((a) => `<article class="review-card"><strong>${escapeHTML(a.status)}</strong><p>${escapeHTML(a.reason)}</p><a href="${escapeHTML(a.trustUrl)}" target="_blank" rel="noreferrer">Open Trust Center</a></article>`).join("") || '<p class="cost-line">No appeals.</p>';
  }
  $("#new-appeal").onclick = () => openModal("Submit Trust appeal", '<label>Reason<textarea name="reason" required maxlength="1000" placeholder="Describe the disputed result or review outcome"></textarea></label>', async (data) => {
    await api("/api/appeals", { method: "POST", body: JSON.stringify({ ...data, conversationId: state.conversationId }) });
    await loadAudit();
    toast("Appeal recorded for Trust review");
  });
  function openModal(title, body, onSubmit) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = body;
    $("#modal-error").textContent = "";
    const modal = $("#modal");
    const form = $("#modal-form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") {
        modal.close();
        return;
      }
      const data = Object.fromEntries(new FormData(form));
      try {
        await onSubmit(data);
        modal.close();
      } catch (error) {
        $("#modal-error").textContent = error.message;
      }
    };
    modal.showModal();
  }
  loadPublicStatus();
})();
