export const WALLET_PROVIDER_DISCOVERY_AUTHORITY = "unverified-injected-candidate";
export const WALLET_PROVIDER_KIND = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });

const YNX_RDNS = new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
const METAMASK_RDNS = new Set(["io.metamask", "io.metamask.flask"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function discoverInjectedWalletProviders(scope = globalThis) {
  const ethereum = safely(() => scope?.ethereum);
  const declaredProviders = safely(() => ethereum?.providers);
  const raw = Array.isArray(declaredProviders) ? declaredProviders : ethereum === undefined ? [] : [ethereum];
  return selectWalletProviderCandidates(raw.map((provider) => candidate(provider, safely(() => provider?.providerInfo), "legacy-injected")).filter(Boolean));
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
  let registered = false;
  try {
    add.call(scope, "eip6963:announceProvider", listener);
    registered = true;
    const EventConstructor = safely(() => scope?.Event) ?? globalThis.Event;
    if (typeof EventConstructor !== "function") return selectWalletProviderCandidates([]);
    dispatch.call(scope, new EventConstructor("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } catch {
    return selectWalletProviderCandidates([]);
  } finally {
    if (registered) try { remove.call(scope, "eip6963:announceProvider", listener); } catch {}
  }
  return selectWalletProviderCandidates([...byUuid.values()], conflicted.size);
}

export async function discoverWalletProviders(scope = globalThis, waitMs = 160) {
  const announced = await discoverEip6963WalletProviders(scope, waitMs);
  const injected = discoverInjectedWalletProviders(scope);
  return selectWalletProviderCandidates(uniqueProviders([
    announced.ynx, announced.metamask, ...announced.candidates,
    injected.ynx, injected.metamask, ...injected.candidates,
  ].filter(Boolean)), announced.conflictedAnnouncements + injected.conflictedAnnouncements);
}

export function selectWalletProviderCandidates(input, conflictedAnnouncements = 0) {
  if (!Array.isArray(input) || !Number.isSafeInteger(conflictedAnnouncements) || conflictedAnnouncements < 0) throw new TypeError("Wallet provider candidates are invalid");
  const candidates = uniqueProviders(input.filter(validCandidate));
  const ynxCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.YNX);
  const metaMaskCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.METAMASK);
  const ambiguities = [];
  if (ynxCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.YNX);
  if (metaMaskCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.METAMASK);
  return Object.freeze({
    ynx: ynxCandidates.length === 1 ? ynxCandidates[0] : null,
    metamask: metaMaskCandidates.length === 1 ? metaMaskCandidates[0] : null,
    candidates: Object.freeze(candidates),
    ambiguities: Object.freeze(ambiguities),
    conflictedAnnouncements,
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
function validDiscovery(value) { const ynx = safely(() => value?.ynx), metamask = safely(() => value?.metamask), ambiguities = safely(() => value?.ambiguities), authority = safely(() => value?.authority), conflicts = safely(() => value?.conflictedAnnouncements); return object(value) && (ynx === null || (validCandidate(ynx) && ynx.kind === WALLET_PROVIDER_KIND.YNX)) && (metamask === null || (validCandidate(metamask) && metamask.kind === WALLET_PROVIDER_KIND.METAMASK)) && Array.isArray(ambiguities) && new Set(ambiguities).size === ambiguities.length && ambiguities.every((item) => Object.values(WALLET_PROVIDER_KIND).includes(item)) && Number.isSafeInteger(conflicts) && conflicts >= 0 && authority === WALLET_PROVIDER_DISCOVERY_AUTHORITY; }
function validProvider(value) { return object(value) && typeof safely(() => value.request) === "function"; }
function canonicalUuid(value) { return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null; }
function canonicalRdns(value) { return typeof value === "string" && value === value.toLowerCase() && /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/.test(value) && value.length <= 253 ? value : null; }
function canonicalName(value) { return typeof value === "string" && value.length >= 1 && value.length <= 64 && value.trim() === value ? value : null; }
function validWait(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 2000) throw new TypeError("Wallet provider discovery wait must be between 0 and 2000 milliseconds"); }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safely(read) { try { return read(); } catch { return undefined; } }
