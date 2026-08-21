export const CONNECTED_DAPP_KEY = "ynx.wallet.web.connected-dapp.v1";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const WALLETS = new Set(["ynx", "metamask"]);

function exactOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === value ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * A Connected DApp entry is intentionally only a local, verified view of the
 * current Companion origin.  It is not a wallet-wide permission inventory and
 * never implies that a provider has revoked its own account permission.
 */
export function connectedDappRecord(input) {
  const origin = exactOrigin(input?.origin);
  const account = typeof input?.account === "string" ? input.account.toLowerCase() : "";
  if (!origin || !ADDRESS.test(account) || input?.chainId !== "0x1917" || !WALLETS.has(input?.wallet)) return null;
  return Object.freeze({origin, account, chainId: "0x1917", wallet: input.wallet});
}

export function rememberConnectedDapp(input, storage = globalThis.localStorage) {
  const record = connectedDappRecord(input);
  if (!record || !storage?.setItem) return null;
  storage.setItem(CONNECTED_DAPP_KEY, JSON.stringify(record));
  return record;
}

export function readConnectedDapp(origin, storage = globalThis.localStorage) {
  if (!storage?.getItem) return null;
  let value;
  try { value = JSON.parse(storage.getItem(CONNECTED_DAPP_KEY) || "null"); }
  catch { storage.removeItem?.(CONNECTED_DAPP_KEY); return null; }
  const record = connectedDappRecord(value);
  if (!record || record.origin !== exactOrigin(origin)) {
    if (value !== null) storage.removeItem?.(CONNECTED_DAPP_KEY);
    return null;
  }
  return record;
}

export function forgetConnectedDapp(storage = globalThis.localStorage) {
  storage?.removeItem?.(CONNECTED_DAPP_KEY);
  return Object.freeze({status: "disconnected", walletPermissionRevoked: false});
}

export function providerChooserState(availability = {}, selectedWallet = null, connectedWallet = null) {
  const choices = Object.freeze(["ynx", "metamask"].filter((wallet) => Boolean(availability[wallet])));
  const selected = choices.includes(selectedWallet) ? selectedWallet : null;
  const connected = choices.includes(connectedWallet) ? connectedWallet : null;
  return Object.freeze({
    choices,
    selected,
    connected,
    // A chooser is only open before a successful connection.  Restores and
    // explicit disconnects must not leave a stale overlay over the page.
    open: choices.length > 1 && connected === null,
  });
}
