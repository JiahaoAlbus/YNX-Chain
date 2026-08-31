const YNX_TESTNET = Object.freeze({
  cosmosChainId: "ynx_6423-1",
  evmChainId: 6423,
  evmChainIdHex: "0x1917",
  nativeAsset: "YNXT",
});
const STANDARD_WALLET_CHAIN_ID = YNX_TESTNET.evmChainIdHex;
const WALLET_PROVIDER_KIND = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });
const WALLET_PROVIDER_DISCOVERY_STATUS = Object.freeze({
  AVAILABLE: "available",
  NOT_INJECTED: "provider-not-injected",
  UNSUPPORTED: "unsupported-injected-provider",
  AMBIGUOUS: "ambiguous-provider",
  CONFLICTED: "conflicted-announcement",
});

const CHAIN_CONFIG = Object.freeze({
  chainId: STANDARD_WALLET_CHAIN_ID,
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: YNX_TESTNET.nativeAsset, decimals: 18 }),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

const DISCOVERY_WAIT_MS = 1500;
const DISCOVERY_PHASES_MS = Object.freeze([0, 250, 750, 1500]);
const CANDIDATE_SOURCE = {
  EIP6963: "eip6963",
  INJECTED: "legacy-injected",
};

const YNX_RDNS = new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
const METAMASK_RDNS = new Set(["io.metamask", "io.metamask.flask"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safe(read) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function validCode(value) {
  return typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value);
}

function normalizeChainId(value) {
  if (!validCode(value)) throw new Error("Wallet returned an invalid chain quantity.");
  return value.toLowerCase();
}

function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("Wallet returned an invalid EVM address.");
  }
  return value.toLowerCase();
}

function normalizeAccounts(value) {
  if (!Array.isArray(value) || value.length > 1024) {
    throw new Error("Wallet account response is invalid.");
  }
  const accounts = value.map(normalizeAddress);
  if (!accounts.length) throw new Error("Wallet returned no approved accounts.");
  return accounts;
}

function providerErrorCode(error) {
  const candidate = safe(() => error.code);
  if (candidate === 4001 || candidate === "4001") return "USER_REJECTED";
  if (candidate === 4100 || candidate === "4100") return "UNAUTHORIZED";
  if (candidate === 4200 || candidate === "4200") return "UNSUPPORTED_METHOD";
  if (candidate === 4900 || candidate === "4900") return "PROVIDER_DISCONNECTED";
  if (candidate === 4901 || candidate === "4901") return "CHAIN_DISCONNECTED";
  if (candidate === 4902 || candidate === "4902") return "CHAIN_NOT_ADDED";
  return "UNKNOWN";
}

function providerErrorMessage(code) {
  return {
    USER_REJECTED: "Wallet request was rejected. No wallet session is established.",
    UNAUTHORIZED: "Wallet request was not authorized.",
    UNSUPPORTED_METHOD: "Wallet rejected this method.",
    PROVIDER_DISCONNECTED: "Wallet provider is disconnected.",
    CHAIN_DISCONNECTED: "Wallet is disconnected from the requested chain.",
    CHAIN_NOT_ADDED: "YNX Testnet is missing in this Wallet.",
    UNKNOWN: "Wallet request failed.",
  }[code] || "Wallet request failed.";
}

async function request(provider, method, params = []) {
  if (!provider || typeof provider.request !== "function") {
    const error = new Error("Wallet provider is invalid.");
    error.code = "INVALID_PROVIDER";
    throw error;
  }
  try {
    return await provider.request({ method, params: params.length ? params : undefined });
  } catch (error) {
    const code = providerErrorCode(error);
    const enriched = new Error(providerErrorMessage(code));
    enriched.code = code;
    throw enriched;
  }
}

function discoverInjected(scope = globalThis) {
  const providers = [];
  const candidates = [];
  const ethereum = safe(() => scope.ethereum);
  const declaredProviders = safe(() => ethereum && ethereum.providers);
  if (Array.isArray(declaredProviders)) {
    declaredProviders.forEach((provider) => {
      const candidate = asCandidate(provider, safe(() => provider?.providerInfo), CANDIDATE_SOURCE.INJECTED);
      if (candidate) candidates.push(candidate);
      providers.push(candidate);
    });
  }

  if (ethereum !== undefined) {
    const root = asCandidate(ethereum, safe(() => ethereum.providerInfo), CANDIDATE_SOURCE.INJECTED);
    if (root) providers.push(root);
  }

  const filtered = uniqueByProvider(candidates);
  return selectCandidates(filtered.length ? filtered : providers, 0, {
    requested: false,
    readyStateEnd: "loaded",
    eip6963RequestDispatches: 0,
    domContentLoadedObserved: false,
    injectedProvidersArrayObserved: Array.isArray(declaredProviders),
    injectedProviderCount: Array.isArray(declaredProviders) ? declaredProviders.length : ethereum === undefined ? 0 : 1,
    injectedRootObserved: ethereum !== undefined,
  }, scope);
}

async function discoverEip6963(scope = globalThis, waitMs = DISCOVERY_WAIT_MS) {
  const add = safe(() => scope?.addEventListener);
  const remove = safe(() => scope?.removeEventListener);
  const dispatch = safe(() => scope?.dispatchEvent);
  if (typeof add !== "function" || typeof remove !== "function" || typeof dispatch !== "function") {
    return { candidates: [], status: WALLET_PROVIDER_DISCOVERY_STATUS.UNSUPPORTED };
  }
  const doc = safe(() => scope.document);
  const onDocAdd = safe(() => doc?.addEventListener);
  const onDocRemove = safe(() => doc?.removeEventListener);
  const byUuid = new Map();
  const seen = new Set();
  let conflicted = 0;
  let requests = 0;
  let domObserved = false;

  function onAnnounce(event) {
    const detail = safe(() => event.detail);
    const info = safe(() => detail?.info);
    const provider = safe(() => detail?.provider);
    const candidate = asCandidate(provider, info, CANDIDATE_SOURCE.EIP6963);
    if (!candidate) return;
    const key = safe(() => info?.uuid);
    const uuid = typeof key === "string" ? key.toLowerCase() : null;
    if (uuid && byUuid.get(uuid)?.provider === provider) return;
    if (!uuid || seen.has(uuid)) {
      conflicted += 1;
      seen.add(uuid || provider);
      return;
    }
    byUuid.set(uuid, candidate);
    seen.add(uuid);
  }

  const listener = { handleEvent: onAnnounce };
  const eventType = "eip6963:announceProvider";
  const docReady = () => {
    requests += 1;
    dispatch.call(scope, new Event("eip6963:requestProvider"));
  };

  let docListener = null;
  let initializedListener = null;
  if (scope.document && typeof onDocAdd === "function" && typeof onDocRemove === "function") {
    docListener = () => {
      domObserved = true;
      docReady();
    };
    onDocAdd.call(scope.document, "DOMContentLoaded", docListener, { once: true });
    if (safe(() => scope.document.readyState) === "complete" || safe(() => scope.document.readyState) === "interactive") {
      domObserved = true;
      docReady();
    }
  }

  try {
    add.call(scope, eventType, listener);
    initializedListener = () => docReady();
    add.call(scope, "ethereum#initialized", initializedListener, { once: true });
    if (safe(() => scope.document?.readyState) === "loading" && docListener && typeof onDocAdd === "function") {
      onDocAdd.call(scope.document, "DOMContentLoaded", docListener, { once: true });
    }
    let elapsed = 0;
    for (const phase of DISCOVERY_PHASES_MS) {
      if (phase > waitMs) break;
      const delay = phase - elapsed;
      if (delay > 0 && typeof scope.setTimeout === "function") {
        await new Promise((resolve) => scope.setTimeout(resolve, delay));
      }
      elapsed = phase;
      docReady();
    }
  } finally {
    if (docListener && doc && onDocRemove) {
      onDocRemove.call(scope.document, "DOMContentLoaded", docListener);
    }
    if (initializedListener) remove.call(scope, "ethereum#initialized", initializedListener);
    if (remove) remove.call(scope, eventType, listener);
  }

  const candidates = [...byUuid.values()];
  return {
    candidates,
    discovered: candidates.length,
    status: conflictsOrAmbiguous(candidates).length
      ? WALLET_PROVIDER_DISCOVERY_STATUS.CONFLICTED
      : candidates.length > 0
        ? WALLET_PROVIDER_DISCOVERY_STATUS.AVAILABLE
        : WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED,
    requestDispatches: requests,
    domObserved,
  };
}

async function discoverWalletProviders(scope = globalThis, waitMs = DISCOVERY_WAIT_MS) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 2000) {
    const error = new Error("Provider discovery wait window is out of range.");
    error.code = "INVALID_DISCOVERY_PARAMS";
    throw error;
  }
  const announced = await discoverEip6963(scope, waitMs);
  const discovered = discoverInjected(scope);

  const candidates = normalizeCandidatePool(
    [
      ...announced.candidates,
      ...discovered.candidates,
    ],
  );

  return selectCandidates(candidates, announced.conflicted || 0, {
    requested: false,
    readyStateEnd: safe(() => scope.document?.readyState) || "unknown",
    eip6963RequestDispatches: announced.requestDispatches,
    domContentLoadedObserved: announced.domObserved,
    injectedProvidersArrayObserved: Array.isArray(safe(() => scope?.ethereum?.providers)),
    injectedRootObserved: scope?.ethereum !== undefined,
  });
}

function selectCandidates(candidates, conflicted, diagnostics, scope = globalThis) {
  const ynx = candidates.filter((value) => value.kind === WALLET_PROVIDER_KIND.YNX);
  const metamask = candidates.filter((value) => value.kind === WALLET_PROVIDER_KIND.METAMASK);
  const ambiguities = [];
  if (ynx.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.YNX);
  if (metamask.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.METAMASK);
  const status = conflicted > 0
    ? WALLET_PROVIDER_DISCOVERY_STATUS.CONFLICTED
    : ambiguities.length
      ? WALLET_PROVIDER_DISCOVERY_STATUS.AMBIGUOUS
      : candidates.length
        ? WALLET_PROVIDER_DISCOVERY_STATUS.AVAILABLE
        : WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED;
  return Object.freeze({
    ynx: ynx.length === 1 ? ynx[0] : null,
    metamask: metamask.length === 1 ? metamask[0] : null,
    candidates: Object.freeze(candidates),
    ambiguities: Object.freeze(ambiguities),
    conflictedAnnouncements: conflicted,
    status,
    possibleCauses: status === WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED ? ["extension-locked", "site-access-denied", "extension-disabled", "extension-not-installed"] : Object.freeze([]),
    diagnostics: Object.freeze({
      readyStateEnd: diagnostics?.readyStateEnd ?? "unknown",
      eip6963RequestDispatches: Number.isSafeInteger(diagnostics?.eip6963RequestDispatches) ? diagnostics.eip6963RequestDispatches : 0,
      domContentLoadedObserved: diagnostics?.domContentLoadedObserved === true,
      injectedRootObserved: diagnostics?.injectedRootObserved === true,
      injectedProvidersArrayObserved: diagnostics?.injectedProvidersArrayObserved === true,
      injectedProviderCount: Array.isArray(safe(() => scope?.ethereum?.providers))
        ? safe(() => scope?.ethereum?.providers.length)
        : scope?.ethereum === undefined
          ? 0
          : 1,
      exactExtensionStateObservable: false,
    }),
  });
}

function asCandidate(provider, info, source) {
  if (!isObject(provider)) return null;
  if (source === CANDIDATE_SOURCE.EIP6963 && !isObject(info)) return null;
  const providerInfo = source === CANDIDATE_SOURCE.EIP6963 ? info : safe(() => provider.providerInfo) || info || {};
  const rdns = normalizeRdns(providerInfo.rdns || safe(() => providerInfo?.rdns));
  const isYNX = safe(() => provider.isYNXWallet) === true || safe(() => provider.isYnxWallet) === true;
  const isMetaMask = safe(() => provider.isMetaMask) === true;

  const normalizedRdns = rdns;
  if (source === CANDIDATE_SOURCE.EIP6963 && normalizedRdns && rdns && !isValidRdnsPair(normalizedRdns, rdns)) return null;

  const ynx = isYNX || (!!normalizedRdns && YNX_RDNS.has(normalizedRdns));
  const metamask = !ynx && (isMetaMask || (!!normalizedRdns && METAMASK_RDNS.has(normalizedRdns)));
  if (!ynx && !metamask) return null;

  const sourceRdns = normalizedRdns || provider.rdns || "";
  return Object.freeze({
    kind: ynx ? WALLET_PROVIDER_KIND.YNX : WALLET_PROVIDER_KIND.METAMASK,
    provider,
    source,
    name: safe(() => providerInfo.name) || sourceRdns || (ynx ? "YNX Wallet" : "MetaMask"),
    uuid: safe(() => providerInfo.uuid) ? `${providerInfo.uuid}` : null,
    rdns: sourceRdns,
    authority: "standard-wallet-provider-discovery",
  });
}

function isValidRdnsPair(injected, announced) {
  return injected === announced;
}

function normalizeRdns(value) {
  return typeof value === "string" && value === value.toLowerCase() && /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/.test(value) ? value : null;
}

function uniqueByProvider(input) {
  const providers = new Set();
  const output = [];
  for (const item of input) {
    if (!item || providers.has(item.provider)) continue;
    providers.add(item.provider);
    output.push(item);
  }
  return output;
}

function normalizeCandidatePool(candidates) {
  if (!Array.isArray(candidates)) return [];
  const filtered = candidates.filter((candidate) => candidate && candidate.provider && typeof candidate.provider.request === "function");
  return uniqueByProvider(filtered);
}

function conflictsOrAmbiguous(values) {
  return [];
}

export const STANDARD_WALLET_TARGET_CHAIN = STANDARD_WALLET_CHAIN_ID;
export const WALLET_PROVIDER_KIND_ENUM = WALLET_PROVIDER_KIND;

export async function connectStandardWallet(candidate, options = {}) {
  if (!candidate || !candidate.provider) {
    const error = new Error("Wallet provider is unavailable.");
    error.code = "PROVIDER_UNAVAILABLE";
    throw error;
  }
  const provider = candidate.provider;
  const accounts = await request(provider, "eth_requestAccounts");
  const approvedAccounts = normalizeAccounts(accounts);
  let chainId = normalizeChainId(await request(provider, "eth_chainId"));
  if (chainId !== STANDARD_WALLET_CHAIN_ID) {
    chainId = await switchProviderToYnxTestnet(provider);
  }
  if (chainId !== STANDARD_WALLET_CHAIN_ID) {
    const error = new Error(`Wallet is on ${chainId}; required chain is ${STANDARD_WALLET_CHAIN_ID}.`);
    error.code = "WRONG_CHAIN";
    throw error;
  }
  return Object.freeze({
    kind: candidate.kind,
    provider,
    chainId,
    account: approvedAccounts[0],
    chainName: CHAIN_CONFIG.chainName,
    authority: "standard-wallet-connection",
    connectedAt: Date.now(),
    request: Object.freeze({
      product: options.product || "ynx-creator-studio",
      scopes: Object.freeze([...(options.scopes || [])]),
    }),
  });
}

export async function restoreStandardWallet(candidate) {
  if (!candidate?.provider) return null;
  const accounts = await request(candidate.provider, "eth_accounts");
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const account = normalizeAccounts(accounts)[0];
  const chainId = normalizeChainId(await request(candidate.provider, "eth_chainId"));
  if (chainId !== STANDARD_WALLET_CHAIN_ID) return null;
  return Object.freeze({
    kind: candidate.kind,
    provider: candidate.provider,
    account,
    chainId,
    authority: "standard-wallet-connection-restore",
  });
}

export async function requestAccountSwitch(provider) {
  try {
    await request(provider, "wallet_requestPermissions", [{ eth_accounts: {} }]);
  } catch (error) {
    if (error.code !== "UNSUPPORTED_METHOD") throw error;
  }
  const accounts = normalizeAccounts(await request(provider, "eth_requestAccounts"));
  const chainId = normalizeChainId(await request(provider, "eth_chainId"));
  return Object.freeze({ account: accounts[0], chainId });
}

async function switchProviderToYnxTestnet(provider) {
  try {
    await request(provider, "wallet_switchEthereumChain", [{ chainId: STANDARD_WALLET_CHAIN_ID }]);
  } catch (error) {
    if (error.code === "CHAIN_NOT_ADDED") {
      await request(provider, "wallet_addEthereumChain", [CHAIN_CONFIG]);
      await request(provider, "wallet_switchEthereumChain", [{ chainId: STANDARD_WALLET_CHAIN_ID }]);
    } else {
      throw error;
    }
  }
  return normalizeChainId(await request(provider, "eth_chainId"));
}

export async function ensureYnxTestnet(provider) {
  return switchProviderToYnxTestnet(provider);
}

export function attachWalletLifecycle(provider, handlers = {}) {
  const on = typeof provider?.on === "function" ? provider.on.bind(provider) : null;
  const remove = typeof provider?.removeListener === "function" ? provider.removeListener.bind(provider) : null;
  if (!on || !remove) return { detach: () => {} };
  const accountHandler = async (accounts) => {
    if (!handlers.onAccountsChanged) return;
    try {
      if (Array.isArray(accounts) && accounts.length === 0) {
        handlers.onAccountsChanged([]);
        return;
      }
      handlers.onAccountsChanged(normalizeAccounts(accounts || []));
    } catch (error) {
      if (handlers.onError) handlers.onError(error);
    }
  };
  const chainHandler = (chainId) => {
    if (!handlers.onChainChanged) return;
    try {
      handlers.onChainChanged(normalizeChainId(chainId));
    } catch (error) {
      if (handlers.onError) handlers.onError(error);
    }
  };
  const disconnectHandler = () => {
    if (handlers.onDisconnect) handlers.onDisconnect();
  };

  on("accountsChanged", accountHandler);
  on("chainChanged", chainHandler);
  on("disconnect", disconnectHandler);
  on("close", disconnectHandler);

  return {
    detach() {
      remove("accountsChanged", accountHandler);
      remove("chainChanged", chainHandler);
      remove("disconnect", disconnectHandler);
      remove("close", disconnectHandler);
    },
  };
}

export async function requestPersonalSign(provider, account, purpose = "Creator Studio") {
  const message = new TextEncoder().encode(`YNX Creator Studio requests account confirmation: ${purpose}`);
  const payload = Array.from(new Uint8Array(message)).map((byte) => String.fromCharCode(byte)).join("");
  return request(provider, "personal_sign", [`0x${[...new TextEncoder().encode(payload)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`, account]);
}

export async function requestTypedDataSign(provider, account, purpose = "Creator Studio", nonce = crypto?.randomUUID?.() || `${Date.now()}`) {
  const request = {
    domain: { name: "YNX Creator Studio", version: "1", chainId: parseInt(STANDARD_WALLET_CHAIN_ID, 16) },
    primaryType: "Consent",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      Consent: [
        { name: "account", type: "address" },
        { name: "purpose", type: "string" },
        { name: "nonce", type: "string" },
      ],
    },
    message: {
      account,
      purpose,
      nonce,
    },
  };
  return request(provider, "eth_signTypedData_v4", [account, JSON.stringify(request)]);
}

export async function sendRuntimeProofTransaction(provider, account, to, data = "0x") {
  return request(provider, "eth_sendTransaction", [{ from: account, to, value: "0x0", data }]);
}

export function describeDiscovery(value) {
  return {
    chainId: STANDARD_WALLET_CHAIN_ID,
    ynx: Boolean(value?.ynx),
    metamask: Boolean(value?.metamask),
    status: value?.status || "unknown",
    providerKind: value?.ynx ? WALLET_PROVIDER_KIND.YNX : value?.metamask ? WALLET_PROVIDER_KIND.METAMASK : null,
  };
}

export { discoverWalletProviders, normalizeAccounts, normalizeAddress, normalizeChainId, request, providerErrorCode, STANDARD_WALLET_CHAIN_ID as CHAIN_ID };
