export const YNX_CHAIN = Object.freeze({
  chainId: "0x1917",
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({name: "YNX Testnet", symbol: "YNXT", decimals: 18}),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

export const WALLET_DOWNLOAD_MATRIX = Object.freeze({
  // The previous Android URL resolves to the website SPA shell, not an APK. Keep
  // the platform present, but fail closed until a source-bound APK is publicly
  // verified rather than offering a false installation link or stale hashes.
  android: Object.freeze({label:"Android API 24+",url:null,hosted:false,bytes:null,sha256:null,contentType:null,signingClass:"unpublished",productionSigned:false,publicStatusUrl:"https://www.ynxweb4.com/dapp/download"}),
  windowsX64: Object.freeze({label:"Windows x64",url:null,hosted:false}),
  windowsArm64: Object.freeze({label:"Windows arm64",url:null,hosted:false}),
  macosX64: Object.freeze({label:"macOS x64",url:null,hosted:false}),
  macosArm64: Object.freeze({label:"macOS arm64",url:null,hosted:false}),
  linuxX64: Object.freeze({label:"Linux x64",url:null,hosted:false}),
  linuxArm64: Object.freeze({label:"Linux arm64",url:null,hosted:false}),
  chromeEdgeExtension: Object.freeze({label:"Chrome / Edge extension",url:null,hosted:false}),
  firefoxExtension: Object.freeze({label:"Firefox extension",url:null,hosted:false}),
  pwaPackage: Object.freeze({label:"PWA install package",url:null,hosted:false,publicStatusUrl:"https://www.ynxweb4.com/dapp/wallet"}),
});
export const YNX_DOWNLOAD_URL = WALLET_DOWNLOAD_MATRIX.android.url;
export const METAMASK_DOWNLOAD_URL = "https://metamask.io/download";
export const SESSION_KEY = "ynx.wallet.web.session.v1";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export class WalletWebError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? {cause} : undefined);
    this.name = "WalletWebError";
    this.code = code;
  }
}

function fail(code, message, cause) { throw new WalletWebError(code, message, cause); }
function validProvider(provider) { return provider && typeof provider.request === "function"; }
function providerList(ethereum) {
  if (!ethereum) return [];
  const candidates = Array.isArray(ethereum.providers) ? ethereum.providers : [ethereum];
  return candidates.filter(validProvider);
}

function ynxProvider(provider) {
  const rdns = String(provider.providerInfo?.rdns || provider.rdns || "").toLowerCase();
  const flagged=provider.isYNXWallet===true||provider.isYnxWallet===true;
  return flagged&&["com.ynx.wallet","com.ynx.wallet.companion"].includes(rdns);
}

export function discoverInjectedProviders(scope = globalThis) {
  const providers = providerList(scope.ethereum);
  const ynx = providers.find(ynxProvider);
  const metamask = providers.find((provider) => provider.isMetaMask === true && !ynxProvider(provider));
  return Object.freeze({ynx, metamask, any: ynx || metamask || providers[0]});
}

export async function discoverEip6963(scope = globalThis, waitMs = 160) {
  const found = new Map(),conflicted=new Set();
  if (typeof scope.addEventListener !== "function" || typeof scope.removeEventListener!=="function"||typeof scope.dispatchEvent !== "function") {
    return Object.freeze([...found.values()]);
  }
  const listener = (event) => {
    const detail = event?.detail;
    const uuid=String(detail?.info?.uuid||"").toLowerCase();
    if (!validProvider(detail?.provider) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)||conflicted.has(uuid)) return;
    const previous=found.get(uuid);if(previous&&previous.provider!==detail.provider){found.delete(uuid);conflicted.add(uuid);return}
    found.set(uuid, Object.freeze({info:Object.freeze({...detail.info,uuid}), provider: detail.provider}));
  };
  const request=()=>scope.dispatchEvent(new (scope.Event||Event)("eip6963:requestProvider"));
  const documentValue=scope.document;let domListener=false;
  const afterDom=()=>{try{request()}catch{}};
  scope.addEventListener("eip6963:announceProvider", listener);
  try {
    if(documentValue?.readyState==="loading"&&typeof documentValue.addEventListener==="function"){documentValue.addEventListener("DOMContentLoaded",afterDom,{once:true});domListener=true}
    request();
    if(waitMs>0){const midpoint=Math.min(80,Math.max(1,Math.floor(waitMs/2)));await new Promise((resolve)=>setTimeout(resolve,midpoint));request();await new Promise((resolve)=>setTimeout(resolve,waitMs-midpoint))}
    request();
  } finally {
    if(domListener&&typeof documentValue.removeEventListener==="function")documentValue.removeEventListener("DOMContentLoaded",afterDom);
    scope.removeEventListener("eip6963:announceProvider", listener);
  }
  return Object.freeze([...found.values()]);
}

export async function discoverWallets(scope = globalThis, diagnostics = {}) {
  const announced = await discoverEip6963(scope);
  const injected = discoverInjectedProviders(scope);
  const announcedYNX = announced.find(({info, provider}) =>
    ynxProvider({...provider, providerInfo:info}) || ynxProvider(provider));
  const announcedMetaMask = announced.find(({info, provider}) =>
    ["io.metamask","io.metamask.flask"].includes(String(info.rdns || "").toLowerCase()) && provider.isMetaMask === true && !ynxProvider(provider));
  const ynx=announcedYNX?.provider||injected.ynx,metamask=announcedMetaMask?.provider||injected.metamask;
  diagnostics=diagnostics&&typeof diagnostics==="object"?diagnostics:{};
  const classification=ynx||metamask?"available":diagnostics.siteAccessDenied===true?"site-access-denied":diagnostics.extensionInstalled===true&&diagnostics.extensionLocked===true?"extension-locked":"no-provider";
  return Object.freeze({
    ynx,metamask,
    status:classification,
    classification,
    possibleCauses:classification==="available"?Object.freeze([]):classification==="extension-locked"?Object.freeze(["extension-locked"]):classification==="site-access-denied"?Object.freeze(["site-access-denied"]):Object.freeze(["extension-locked","site-access-denied","extension-disabled","extension-not-installed"]),
    exactExtensionStateObservable:classification!=="no-provider",
  });
}

export function walletDiscoveryPresentation(availability = {}) {
  const ynxPresent = Boolean(availability.ynx);
  const metamaskPresent = Boolean(availability.metamask);
  return Object.freeze({
    ynxPresent,
    metamaskPresent,
    showYNXConnect: ynxPresent,
    showYNXDownload: !ynxPresent,
    showMetaMaskChoice: !ynxPresent,
    metaMaskChoice: metamaskPresent ? "connect" : "official-download",
    status:availability.status||((ynxPresent||metamaskPresent)?"available":"no-provider"),
    errorKey:ynxPresent||metamaskPresent?null:availability.status==="extension-locked"?"walletLocked":availability.status==="site-access-denied"?"siteAccessDenied":"providerNotInjected",
    exactExtensionStateObservable:availability.exactExtensionStateObservable===true,
  });
}

export function createExtensionProvider(preference, runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime) {
  if (!runtime || typeof runtime.sendMessage !== "function") return undefined;
  return Object.freeze({
    preference,
    async request(input) {
      const response = await runtime.sendMessage({type: "YNX_WALLET_REQUEST", preference, input});
      if (!response?.ok) fail(response?.error?.code || "PROVIDER_REQUEST_FAILED", response?.error?.message || "The active-tab wallet request failed closed.");
      return response.result;
    },
  });
}

export async function extensionWalletAvailability(runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime) {
  if (!runtime || typeof runtime.sendMessage !== "function") return Object.freeze({ynx: false, metamask: false});
  const response = await runtime.sendMessage({type: "YNX_WALLET_DISCOVER"});
  if (response?.error) fail(response.error.code || "DISCOVERY_UNAVAILABLE", response.error.message || "Wallet discovery failed closed.");
  if (typeof response?.ynx !== "boolean" || typeof response?.metamask !== "boolean") fail("INVALID_DISCOVERY_RESPONSE", "Wallet discovery returned an invalid response.");
  return Object.freeze({ynx: response.ynx, metamask: response.metamask});
}

export async function verifyTestnetRpc(fetcher, url = YNX_CHAIN.rpcUrls[0], options = {}) {
  if(options.probeTransport!==STANDARD_WALLET_RPC_PROBE_TRANSPORT)fail("UNSAFE_BROWSER_RPC_PROBE","Direct browser RPC fetch is not a Standard Wallet connection authority.");
  if (typeof fetcher !== "function") fail("RPC_UNAVAILABLE", "YNX Testnet RPC verification is unavailable.");
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {"content-type": "application/json", accept: "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_chainId", params: []}),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
      credentials: "omit",
    });
  } catch (error) {
    fail("RPC_UNAVAILABLE", "YNX Testnet RPC did not answer. Chain-changing and transaction actions remain disabled.", error);
  }
  if (!response.ok) fail("RPC_UNAVAILABLE", `YNX Testnet RPC failed closed (${response.status}).`);
  const envelope = await response.json().catch(() => null);
  if (!envelope || envelope.jsonrpc !== "2.0" || envelope.id !== 1 || Object.hasOwn(envelope, "error") || typeof envelope.result !== "string") {
    fail("INVALID_RPC_RESPONSE", "YNX Testnet RPC returned an invalid JSON-RPC envelope.");
  }
  if (envelope.result !== YNX_CHAIN.chainId) fail("WRONG_NETWORK", "The configured RPC did not prove YNX Testnet chain 6423.");
  return Object.freeze({chainId: envelope.result, source: url, asOf: new Date().toISOString(), version: "json-rpc-2.0"});
}

async function exactChain(provider) {
  const chainId = await provider.request({method: "eth_chainId"});
  if (chainId !== YNX_CHAIN.chainId) fail("WRONG_NETWORK", "Wallet is not connected to YNX Testnet (chain 6423).");
  return chainId;
}

function isUnknownChainError(error) {
  const code=error?.code??error?.data?.originalError?.code??error?.data?.code;
  return code===4902||code==="4902"||code===-32603&&/unrecognized|unknown|not added|missing chain/iu.test(String(error?.message||""));
}

async function switchOrAddYNXChain(provider) {
  try {
    await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:YNX_CHAIN.chainId}]});
  } catch (error) {
    if(!isUnknownChainError(error))throw error;
    await provider.request({method:"wallet_addEthereumChain",params:[YNX_CHAIN]});
    await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:YNX_CHAIN.chainId}]});
  }
  return exactChain(provider);
}

async function exactAuthorizedAccount(provider, expectedAccount) {
  await exactChain(provider);
  const accounts = await provider.request({method: "eth_accounts"});
  if (!Array.isArray(accounts) || !accounts.some((account) => String(account).toLowerCase() === expectedAccount.toLowerCase())) {
    fail("ACCOUNT_CHANGED", "The connected account is no longer authorized. Connect again before signing or sending a transaction.");
  }
  return expectedAccount.toLowerCase();
}

export async function addYNXChain(provider, options = {}) {
  if (!validProvider(provider)) fail("WALLET_NOT_FOUND", "No compatible wallet provider was detected.");
  await provider.request({method: "wallet_addEthereumChain", params: [YNX_CHAIN]});
  return switchToYNXChain(provider, options);
}

export async function switchToYNXChain(provider, options = {}) {
  if (!validProvider(provider)) fail("WALLET_NOT_FOUND", "No compatible wallet provider was detected.");
  return switchOrAddYNXChain(provider);
}

export async function connectStandardWallet(provider,wallet,options={}){
  if (!validProvider(provider)) fail("WALLET_NOT_FOUND", "No compatible wallet provider was detected.");
  const kind=wallet==="ynx"?"ynx-wallet":wallet;
  let connectState=createStandardWalletConnectState();
  connectState=reduceStandardWalletConnectState(connectState,{type:"BEGIN",pendingIntent:options.pendingIntent||`connect_${cryptoToken()}`});
  connectState=reduceStandardWalletConnectState(connectState,{type:"PROVIDER_SELECTED",providerKind:kind});
  const accounts = await provider.request({method: "eth_requestAccounts"});
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof account !== "string" || !ADDRESS.test(account)) fail("INVALID_ACCOUNT", "Wallet did not return a valid EVM account.");
  connectState=reduceStandardWalletConnectState(connectState,{type:"ACCOUNT_APPROVED",account});
  let chainId=await provider.request({method:"eth_chainId"});
  if(chainId!==YNX_CHAIN.chainId)chainId=await switchOrAddYNXChain(provider);
  connectState=reduceStandardWalletConnectState(connectState,{type:"CHAIN_CONFIRMED",chainId});
  if(connectState.status!==STANDARD_WALLET_CONNECT_STATUS.CONNECTED)fail("WRONG_NETWORK","Wallet did not confirm YNX Testnet chain 6423.");
  return Object.freeze({session:Object.freeze({account:connectState.account,chainId:connectState.chainId}),connectState});
}

export async function connectWallet(provider, options = {}) {
  return (await connectStandardWallet(provider,options.wallet||"metamask",options)).session;
}

export async function restoreTestnetSession(provider, storage = globalThis.localStorage) {
  if (!validProvider(provider) || !storage) return null;
  const saved = readRememberedSession(storage);
  if (!saved) return null;
  const [chainId, accounts] = await Promise.all([
    provider.request({method: "eth_chainId"}),
    provider.request({method: "eth_accounts"}),
  ]).catch(() => [null, []]);
  if (chainId !== YNX_CHAIN.chainId || !Array.isArray(accounts) || !accounts.some((item) => String(item).toLowerCase() === saved.account.toLowerCase())) {
    storage.removeItem(SESSION_KEY);
    return null;
  }
  return Object.freeze({account: saved.account.toLowerCase(), chainId});
}

export function rememberSession(session, wallet, storage = globalThis.localStorage) {
  if (!storage || !ADDRESS.test(session?.account || "") || session.chainId !== YNX_CHAIN.chainId || !["ynx", "metamask"].includes(wallet)) return;
  storage.setItem(SESSION_KEY, JSON.stringify({account: session.account.toLowerCase(), chainId: session.chainId, wallet}));
}

export function readRememberedSession(storage = globalThis.localStorage) {
  if (!storage) return null;
  let saved;
  try { saved = JSON.parse(storage.getItem(SESSION_KEY) || "null"); }
  catch { storage.removeItem(SESSION_KEY); return null; }
  const exactKeys = saved && typeof saved === "object" && !Array.isArray(saved) &&
    Object.keys(saved).length === 3 && ["account", "chainId", "wallet"].every((key) => Object.hasOwn(saved, key));
  if (!exactKeys || !ADDRESS.test(saved.account || "") || saved.chainId !== YNX_CHAIN.chainId || !["ynx", "metamask"].includes(saved.wallet)) {
    if (saved !== null) storage.removeItem(SESSION_KEY);
    return null;
  }
  return Object.freeze({account: saved.account.toLowerCase(), chainId: saved.chainId, wallet: saved.wallet});
}

export function resolveRememberedWallet(availability, storage = globalThis.localStorage) {
  const saved = readRememberedSession(storage);
  if (!saved) return null;
  if (!availability?.[saved.wallet]) {
    forgetSession(storage);
    return null;
  }
  return saved.wallet;
}

export function forgetSession(storage = globalThis.localStorage) {
  storage?.removeItem?.(SESSION_KEY);
}

export function walletActionGates(provider, account, chainId, rpcVerified = false) {
  const hasProvider = Boolean(validProvider(provider));
  const connected = hasProvider && ADDRESS.test(account || "") && chainId === YNX_CHAIN.chainId;
  return Object.freeze({
    canAddChain: hasProvider,
    canSwitchChain: hasProvider,
    canSign: connected,
    canSendTransaction: connected,
  });
}

export function invalidatesConnectedSession(error) {
  return ["ACCOUNT_CHANGED", "WRONG_NETWORK", "WALLET_NOT_FOUND", 4900, 4901].includes(error?.code);
}

export function subscribeProviderLifecycle(provider, handlers = {}) {
  if (!provider || typeof provider.on !== "function") return () => {};
  const listeners = {
    accountsChanged(accounts) {
      const normalized = Array.isArray(accounts) ? accounts.filter((account) => ADDRESS.test(account || "")).map((account) => account.toLowerCase()) : [];
      handlers.accountsChanged?.(Object.freeze(normalized));
    },
    chainChanged(chainId) { handlers.chainChanged?.(typeof chainId === "string" ? chainId : null); },
    disconnect(error) { handlers.disconnect?.(error); },
  };
  for (const [event, listener] of Object.entries(listeners)) provider.on(event, listener);
  return () => {
    if (typeof provider.removeListener !== "function") return;
    for (const [event, listener] of Object.entries(listeners)) provider.removeListener(event, listener);
  };
}

export async function signMessage(provider, account, message) {
  if (!validProvider(provider) || !ADDRESS.test(account || "")) fail("INVALID_ACCOUNT", "Connect a valid wallet account before signing.");
  if (typeof message !== "string" || message.length < 1 || message.length > 4096) fail("INVALID_MESSAGE", "Message must contain 1 to 4096 characters.");
  const authorizedAccount = await exactAuthorizedAccount(provider, account);
  const data = `0x${[...new TextEncoder().encode(message)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const signature = await provider.request({method: "personal_sign", params: [data, authorizedAccount]});
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) fail("INVALID_SIGNATURE", "Wallet returned an invalid signature.");
  return signature;
}

export async function sendTransaction(provider, transaction, options = {}) {
  if (!validProvider(provider)) fail("WALLET_NOT_FOUND", "No compatible wallet provider was detected.");
  const from = String(transaction?.from || "");
  const to = String(transaction?.to || "");
  const value = String(transaction?.value || "0x0");
  const data = String(transaction?.data || "0x");
  if (!ADDRESS.test(from) || !ADDRESS.test(to)) fail("INVALID_TRANSACTION", "Transaction requires valid from and to addresses.");
  if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value) || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) fail("INVALID_TRANSACTION", "Transaction value or data is not canonical hex.");
  const authorizedFrom = await exactAuthorizedAccount(provider, from);
  const hash = await provider.request({method: "eth_sendTransaction", params: [{from: authorizedFrom, to, value, data}]});
  if (typeof hash !== "string" || !HASH.test(hash)) fail("INVALID_TRANSACTION_HASH", "Wallet did not return a valid transaction hash.");
  return hash.toLowerCase();
}

function cryptoToken(){const bytes=new Uint8Array(16);globalThis.crypto?.getRandomValues?.(bytes);return [...bytes].map((value)=>value.toString(16).padStart(2,"0")).join("")}
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_CONNECT_STATUS,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from "./standard-wallet-connect-state.js";
