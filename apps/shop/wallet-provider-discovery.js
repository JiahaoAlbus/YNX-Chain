// Source-compatible consumer of the accepted Wallet/Auth EIP-6963/EIP-1193
// discovery contract. Candidates are unverified until the user approves an
// account request; Web callers must never navigate through a native-only URI.
export const WALLET_PROVIDER_DISCOVERY_AUTHORITY = 'unverified-injected-candidate';
export const WALLET_PROVIDER_KIND = Object.freeze({ YNX: 'ynx-wallet', METAMASK: 'metamask' });

const YNX_RDNS = new Set(['com.ynx.wallet', 'com.ynx.wallet.companion']);
const METAMASK_RDNS = new Set(['io.metamask', 'io.metamask.flask']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function discoverWalletProviders(scope = globalThis, waitMs = 160) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 2_000) throw new TypeError('Wallet discovery timeout is invalid.');
  const announced = await discoverEip6963(scope, waitMs);
  const injected = discoverInjected(scope);
  return select(unique([
    announced.ynx, announced.metamask, ...announced.candidates,
    injected.ynx, injected.metamask, ...injected.candidates,
  ].filter(Boolean)), announced.conflictedAnnouncements + injected.conflictedAnnouncements);
}

function discoverInjected(scope) {
  const ethereum = safely(() => scope?.ethereum);
  const providers = safely(() => ethereum?.providers);
  const raw = Array.isArray(providers) ? providers : ethereum === undefined ? [] : [ethereum];
  return select(raw.map(provider => candidate(provider, safely(() => provider?.providerInfo), 'legacy-injected')).filter(Boolean));
}

async function discoverEip6963(scope, waitMs) {
  const add = safely(() => scope?.addEventListener);
  const remove = safely(() => scope?.removeEventListener);
  const dispatch = safely(() => scope?.dispatchEvent);
  if (typeof add !== 'function' || typeof remove !== 'function' || typeof dispatch !== 'function') return select([]);
  const byUuid = new Map();
  const conflicted = new Set();
  const listener = event => {
    const info = safely(() => event?.detail?.info);
    const provider = safely(() => event?.detail?.provider);
    const item = candidate(provider, info, 'eip6963');
    const uuid = canonicalUuid(safely(() => info?.uuid));
    if (!item || uuid === null || conflicted.has(uuid)) return;
    const previous = byUuid.get(uuid);
    if (previous && previous.provider !== provider) {
      byUuid.delete(uuid);
      conflicted.add(uuid);
      return;
    }
    byUuid.set(uuid, item);
  };
  let registered = false;
  try {
    add.call(scope, 'eip6963:announceProvider', listener);
    registered = true;
    const EventConstructor = safely(() => scope?.Event) ?? globalThis.Event;
    if (typeof EventConstructor !== 'function') return select([]);
    dispatch.call(scope, new EventConstructor('eip6963:requestProvider'));
    await new Promise(resolve => setTimeout(resolve, waitMs));
  } catch {
    return select([]);
  } finally {
    if (registered) try { remove.call(scope, 'eip6963:announceProvider', listener); } catch {}
  }
  return select([...byUuid.values()], conflicted.size);
}

function select(input, conflictedAnnouncements = 0) {
  const candidates = unique(input.filter(Boolean));
  const ynx = candidates.filter(item => item.kind === WALLET_PROVIDER_KIND.YNX);
  const metamask = candidates.filter(item => item.kind === WALLET_PROVIDER_KIND.METAMASK);
  const ambiguities = [];
  if (ynx.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.YNX);
  if (metamask.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.METAMASK);
  return Object.freeze({
    ynx: ynx.length === 1 ? ynx[0] : null,
    metamask: metamask.length === 1 ? metamask[0] : null,
    candidates: Object.freeze(candidates),
    ambiguities: Object.freeze(ambiguities),
    conflictedAnnouncements,
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY,
  });
}

function candidate(provider, info, source) {
  if (!provider || typeof safely(() => provider.request) !== 'function') return null;
  const rdns = canonicalRdns(source === 'eip6963' ? safely(() => info?.rdns) : safely(() => provider?.providerInfo?.rdns) ?? safely(() => provider?.rdns));
  const isYNX = safely(() => provider.isYNXWallet) === true || safely(() => provider.isYnxWallet) === true;
  const isMetaMask = safely(() => provider.isMetaMask) === true;
  const ynx = isYNX && (rdns === null || YNX_RDNS.has(rdns));
  const metamask = !isYNX && ((rdns !== null && METAMASK_RDNS.has(rdns)) || isMetaMask);
  if (ynx === metamask) return null;
  const uuid = source === 'eip6963' ? canonicalUuid(safely(() => info?.uuid)) : null;
  if (source === 'eip6963' && uuid === null) return null;
  return Object.freeze({ kind: ynx ? WALLET_PROVIDER_KIND.YNX : WALLET_PROVIDER_KIND.METAMASK, provider, source, uuid, rdns, authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY });
}

function unique(items) {
  const providers = new Set();
  return items.filter(item => item?.provider && !providers.has(item.provider) && providers.add(item.provider));
}
function canonicalUuid(value) { return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null; }
function canonicalRdns(value) { return typeof value === 'string' && value === value.toLowerCase() && /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/.test(value) ? value : null; }
function safely(read) { try { return read(); } catch { return undefined; } }

