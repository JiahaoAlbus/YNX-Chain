export const WALLET_PROVIDER_DISCOVERY_AUTHORITY = "unverified-injected-candidate";
export const WALLET_PROVIDER_KIND = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });
export const WALLET_PROVIDER_DISCOVERY_STATUS = Object.freeze({
  AVAILABLE: "available",
  NOT_INJECTED: "provider-not-injected",
  UNSUPPORTED: "unsupported-injected-provider",
  AMBIGUOUS: "ambiguous-provider",
  CONFLICTED: "conflicted-announcement",
});
export const WALLET_PROVIDER_NOT_INJECTED_POSSIBLE_CAUSES = Object.freeze([
  "extension-locked",
  "site-access-denied",
  "extension-disabled",
  "extension-not-installed",
]);

const YNX_RDNS = new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
const METAMASK_RDNS = new Set(["io.metamask", "io.metamask.flask"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function discoverInjectedWalletProviders(scope = globalThis) {
  const ethereum = safely(() => scope?.ethereum);
  const declaredProviders = safely(() => ethereum?.providers);
  const declared = Array.isArray(declaredProviders)
    ? declaredProviders.map((provider) => candidate(provider, safely(() => provider?.providerInfo), "legacy-injected")).filter(Boolean)
    : [];
  const root = ethereum === undefined ? [] : [candidate(ethereum, safely(() => ethereum?.providerInfo), "legacy-injected")].filter(Boolean);
  const selected = declared.length ? declared : root;
  return selectWalletProviderCandidates(selected, 0, injectionDiagnostics(scope, {
    eip6963RequestDispatches: 0,
    domContentLoadedObserved: false,
  }));
}

export async function discoverEip6963WalletProviders(scope = globalThis, waitMs = 160) {
  validWait(waitMs);
  const add = safely(() => scope?.addEventListener), remove = safely(() => scope?.removeEventListener), dispatch = safely(() => scope?.dispatchEvent);
  if (typeof add !== "function" || typeof remove !== "function" || typeof dispatch !== "function") return selectWalletProviderCandidates([]);
  const byUuid = new Map(), conflicted = new Set();
  const listener = (event) => {
    const detail = safely(() => event?.detail), info = safely(() => detail?.info), provider = safely(() => detail?.provider);
    const item = candidate(provider, info, "eip6963");
    const uuid = canonicalUuid(safely(() => info?.uuid));
    if (!item || uuid === null || conflicted.has(uuid)) return;
    const previous = byUuid.get(uuid);
    if (previous && previous.provider !== provider) { byUuid.delete(uuid); conflicted.add(uuid); return; }
    byUuid.set(uuid, item);
  };
  const documentValue = safely(() => scope?.document);
  const documentAdd = safely(() => documentValue?.addEventListener), documentRemove = safely(() => documentValue?.removeEventListener);
  let registered = false, domRegistered = false, domContentLoadedObserved = false, requestDispatches = 0;
  const requestProviders = () => {
    const EventConstructor = safely(() => scope?.Event) ?? globalThis.Event;
    if (typeof EventConstructor !== "function") return;
    dispatch.call(scope, new EventConstructor("eip6963:requestProvider"));
    requestDispatches += 1;
  };
  const afterDomContentLoaded = () => {
    domContentLoadedObserved = true;
    try { requestProviders(); } catch {}
  };
  try {
    add.call(scope, "eip6963:announceProvider", listener);
    registered = true;
    if (safely(() => documentValue?.readyState) === "loading" && typeof documentAdd === "function" && typeof documentRemove === "function") {
      documentAdd.call(documentValue, "DOMContentLoaded", afterDomContentLoaded, { once: true });
      domRegistered = true;
    }
    requestProviders();
    if (waitMs > 0) {
      const midpoint = Math.min(80, Math.max(1, Math.floor(waitMs / 2)));
      await delay(midpoint);
      requestProviders();
      await delay(waitMs - midpoint);
    }
    requestProviders();
  } catch {
    return selectWalletProviderCandidates([], 0, injectionDiagnostics(scope, { eip6963RequestDispatches: requestDispatches, domContentLoadedObserved }));
  } finally {
    if (domRegistered) try { documentRemove.call(documentValue, "DOMContentLoaded", afterDomContentLoaded); } catch {}
    if (registered) try { remove.call(scope, "eip6963:announceProvider", listener); } catch {}
  }
  return selectWalletProviderCandidates([...byUuid.values()], conflicted.size, injectionDiagnostics(scope, {
    eip6963RequestDispatches: requestDispatches,
    domContentLoadedObserved,
  }));
}

export async function discoverWalletProviders(scope = globalThis, waitMs = 160) {
  const initial = injectionSnapshot(scope);
  const announced = await discoverEip6963WalletProviders(scope, waitMs);
  const injected = discoverInjectedWalletProviders(scope);
  return selectWalletProviderCandidates(uniqueProviders([
    announced.ynx, announced.metamask, ...announced.candidates,
    injected.ynx, injected.metamask, ...injected.candidates,
  ].filter(Boolean)), announced.conflictedAnnouncements + injected.conflictedAnnouncements, injectionDiagnostics(scope, {
    readyStateStart: initial.readyState,
    eip6963RequestDispatches: announced.diagnostics.eip6963RequestDispatches,
    domContentLoadedObserved: announced.diagnostics.domContentLoadedObserved,
  }));
}

export function selectWalletProviderCandidates(input, conflictedAnnouncements = 0, diagnostics = null) {
  if (!Array.isArray(input) || !Number.isSafeInteger(conflictedAnnouncements) || conflictedAnnouncements < 0) throw new TypeError("Wallet provider candidates are invalid");
  const candidates = uniqueProviders(input.filter(validCandidate));
  const ynxCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.YNX);
  const metaMaskCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.METAMASK);
  const ambiguities = [];
  if (ynxCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.YNX);
  if (metaMaskCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.METAMASK);
  const observed = diagnostics === null ? defaultDiagnostics(candidates.length > 0) : validDiagnostics(diagnostics);
  const status = conflictedAnnouncements > 0
    ? WALLET_PROVIDER_DISCOVERY_STATUS.CONFLICTED
    : ambiguities.length > 0
      ? WALLET_PROVIDER_DISCOVERY_STATUS.AMBIGUOUS
      : candidates.length > 0
        ? WALLET_PROVIDER_DISCOVERY_STATUS.AVAILABLE
        : observed.injectedRootObserved || observed.injectedProvidersArrayObserved
          ? WALLET_PROVIDER_DISCOVERY_STATUS.UNSUPPORTED
          : WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED;
  return Object.freeze({
    ynx: ynxCandidates.length === 1 ? ynxCandidates[0] : null,
    metamask: metaMaskCandidates.length === 1 ? metaMaskCandidates[0] : null,
    candidates: Object.freeze(candidates),
    ambiguities: Object.freeze(ambiguities),
    conflictedAnnouncements,
    status,
    possibleCauses: status === WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED ? WALLET_PROVIDER_NOT_INJECTED_POSSIBLE_CAUSES : Object.freeze([]),
    diagnostics: observed,
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY,
  });
}

export function walletAvailabilityFromDiscovery(discovery) {
  if (!validDiscovery(discovery)) throw new TypeError("Wallet provider discovery result is invalid");
  return Object.freeze({ ynxWalletInstalled: discovery.ynx !== null, metaMaskAvailable: discovery.metamask !== null });
}

function candidate(provider, info, source) {
  if (!validProvider(provider) || (source !== "eip6963" && source !== "legacy-injected")) return null;
  const providerInfo = object(info) ? info : null;
  const announcedRdns = canonicalRdns(safely(() => providerInfo?.rdns));
  const embeddedRdns = canonicalRdns(safely(() => provider?.providerInfo?.rdns) ?? safely(() => provider?.rdns));
  if (source === "eip6963" && announcedRdns !== null && embeddedRdns !== null && announcedRdns !== embeddedRdns) return null;
  const rdns = source === "eip6963" ? announcedRdns : embeddedRdns;
  const ynxFlag = safely(() => provider?.isYNXWallet) === true || safely(() => provider?.isYnxWallet) === true;
  const metaMaskFlag = safely(() => provider?.isMetaMask) === true;
  if ((rdns !== null && YNX_RDNS.has(rdns) && !ynxFlag) || (rdns !== null && METAMASK_RDNS.has(rdns) && ynxFlag)) return null;
  const ynx = rdns !== null && YNX_RDNS.has(rdns) && ynxFlag;
  const metamask = !ynx && !ynxFlag && ((rdns !== null && METAMASK_RDNS.has(rdns)) || metaMaskFlag);
  if (!ynx && !metamask) return null;
  if (ynxFlag && metaMaskFlag) return null;
  const uuid = source === "eip6963" ? canonicalUuid(safely(() => providerInfo?.uuid)) : null;
  if (source === "eip6963" && uuid === null) return null;
  return Object.freeze({
    kind: ynx ? WALLET_PROVIDER_KIND.YNX : WALLET_PROVIDER_KIND.METAMASK,
    provider,
    source,
    uuid,
    rdns,
    name: canonicalName(safely(() => providerInfo?.name)),
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY,
  });
}

function uniqueProviders(input) {
  const seen = new Set(), output = [];
  for (const item of input) if (validCandidate(item) && !seen.has(item.provider)) { seen.add(item.provider); output.push(item); }
  return output;
}
function validCandidate(value) { return object(value) && validProvider(safely(() => value.provider)) && Object.values(WALLET_PROVIDER_KIND).includes(safely(() => value.kind)) && safely(() => value.authority) === WALLET_PROVIDER_DISCOVERY_AUTHORITY; }
function validDiscovery(value) { const ynx = safely(() => value?.ynx), metamask = safely(() => value?.metamask), ambiguities = safely(() => value?.ambiguities), authority = safely(() => value?.authority), conflicts = safely(() => value?.conflictedAnnouncements), status = safely(() => value?.status), causes = safely(() => value?.possibleCauses), diagnostics = safely(() => value?.diagnostics); return object(value) && (ynx === null || (validCandidate(ynx) && ynx.kind === WALLET_PROVIDER_KIND.YNX)) && (metamask === null || (validCandidate(metamask) && metamask.kind === WALLET_PROVIDER_KIND.METAMASK)) && Array.isArray(ambiguities) && new Set(ambiguities).size === ambiguities.length && ambiguities.every((item) => Object.values(WALLET_PROVIDER_KIND).includes(item)) && Number.isSafeInteger(conflicts) && conflicts >= 0 && Object.values(WALLET_PROVIDER_DISCOVERY_STATUS).includes(status) && Array.isArray(causes) && validDiagnostics(diagnostics) === diagnostics && authority === WALLET_PROVIDER_DISCOVERY_AUTHORITY; }
function validProvider(value) { return object(value) && typeof safely(() => value.request) === "function"; }
function canonicalUuid(value) { return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null; }
function canonicalRdns(value) { return typeof value === "string" && value === value.toLowerCase() && /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/.test(value) && value.length <= 253 ? value : null; }
function canonicalName(value) { return typeof value === "string" && value.length >= 1 && value.length <= 64 && value.trim() === value ? value : null; }
function validWait(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 2000) throw new TypeError("Wallet provider discovery wait must be between 0 and 2000 milliseconds"); }
function delay(milliseconds) { return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve(); }
function injectionSnapshot(scope) {
  const ethereum = safely(() => scope?.ethereum), providers = safely(() => ethereum?.providers), readyState = safely(() => scope?.document?.readyState);
  return Object.freeze({
    readyState: ["loading", "interactive", "complete"].includes(readyState) ? readyState : "unavailable",
    injectedRootObserved: ethereum !== undefined,
    injectedProvidersArrayObserved: Array.isArray(providers),
    injectedProviderCount: Array.isArray(providers) ? providers.length : ethereum === undefined ? 0 : 1,
  });
}
function injectionDiagnostics(scope, input = {}) {
  const snapshot = injectionSnapshot(scope);
  return Object.freeze({
    readyStateStart: ["loading", "interactive", "complete", "unavailable"].includes(input.readyStateStart) ? input.readyStateStart : snapshot.readyState,
    readyStateEnd: snapshot.readyState,
    eip6963RequestDispatches: Number.isSafeInteger(input.eip6963RequestDispatches) && input.eip6963RequestDispatches >= 0 ? input.eip6963RequestDispatches : 0,
    domContentLoadedObserved: input.domContentLoadedObserved === true,
    injectedRootObserved: snapshot.injectedRootObserved,
    injectedProvidersArrayObserved: snapshot.injectedProvidersArrayObserved,
    injectedProviderCount: snapshot.injectedProviderCount,
    exactExtensionStateObservable: false,
  });
}
function defaultDiagnostics(providerObserved) { return Object.freeze({ readyStateStart: "unavailable", readyStateEnd: "unavailable", eip6963RequestDispatches: 0, domContentLoadedObserved: false, injectedRootObserved: providerObserved, injectedProvidersArrayObserved: false, injectedProviderCount: providerObserved ? 1 : 0, exactExtensionStateObservable: false }); }
function validDiagnostics(value) {
  if (!object(value) || !["loading", "interactive", "complete", "unavailable"].includes(value.readyStateStart) || !["loading", "interactive", "complete", "unavailable"].includes(value.readyStateEnd) || !Number.isSafeInteger(value.eip6963RequestDispatches) || value.eip6963RequestDispatches < 0 || typeof value.domContentLoadedObserved !== "boolean" || typeof value.injectedRootObserved !== "boolean" || typeof value.injectedProvidersArrayObserved !== "boolean" || !Number.isSafeInteger(value.injectedProviderCount) || value.injectedProviderCount < 0 || value.exactExtensionStateObservable !== false) throw new TypeError("Wallet provider discovery diagnostics are invalid");
  return value;
}
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safely(read) { try { return read(); } catch { return undefined; } }
