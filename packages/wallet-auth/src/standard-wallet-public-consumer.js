import { WalletAuthError } from "./canonical.js";
import { STANDARD_WALLET_CHAIN_ID, STANDARD_WALLET_PRIVATE_SERVICE } from "./standard-wallet-connect-state.js";
import { discoverWalletProviders, WALLET_PROVIDER_DISCOVERY_STATUS } from "./wallet-provider-discovery.js";

export const STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS = Object.freeze({
  READY: "ready",
  PROVIDER_UNAVAILABLE: "provider-unavailable",
  PROVIDER_AMBIGUOUS: "provider-ambiguous",
  WRONG_NETWORK: "wrong-network",
});

export const STANDARD_WALLET_PUBLIC_HANDSHAKE_AUTHORITY = "discovery-and-chain-readback-only";

/**
 * Executes the non-privileged, source-bound public consumer handshake.
 * This never asks for accounts, signatures, transactions, Product Sessions,
 * or Gateway authority; it is intentionally not a connection success claim.
 */
export async function runStandardWalletPublicConsumerHandshake(config) {
  exactConfig(config);
  const source = sourceBinding(config.sourceBinding, config.scope);
  const privateService = privateServiceStatus(config.privateServiceStatus);
  const discovery = await discoverWalletProviders(config.scope, config.waitMs);
  let result;
  if ([WALLET_PROVIDER_DISCOVERY_STATUS.AMBIGUOUS, WALLET_PROVIDER_DISCOVERY_STATUS.CONFLICTED].includes(discovery.status)) {
    result = envelope(source, privateService, { status: STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS.PROVIDER_AMBIGUOUS, code: "AMBIGUOUS_PROVIDER" });
  } else if (discovery.ynx === null) {
    result = envelope(source, privateService, { status: STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS.PROVIDER_UNAVAILABLE, code: "YNX_PROVIDER_UNAVAILABLE" });
  } else {
    const provider = discovery.ynx.provider;
    if (!exactYnxIdentity(provider, discovery.ynx)) {
      result = envelope(source, privateService, { status: STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS.PROVIDER_UNAVAILABLE, code: "YNX_PROVIDER_IDENTITY_MISMATCH" });
    } else {
      let chainId;
      try { chainId = await provider.request(Object.freeze({ method: "eth_chainId" })); }
      catch { result = envelope(source, privateService, { status: STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS.PROVIDER_UNAVAILABLE, code: "YNX_PROVIDER_UNAVAILABLE", chainReadAttempted: true }); }
      if (result === undefined) result = chainId === STANDARD_WALLET_CHAIN_ID
        ? envelope(source, privateService, { status: STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS.READY, code: null, providerAvailable: true, chainReadAttempted: true })
        : envelope(source, privateService, { status: STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS.WRONG_NETWORK, code: "WRONG_NETWORK", chainReadAttempted: true });
    }
  }
  try { await config.onResult(result); }
  catch { throw new WalletAuthError("PUBLIC_CONSUMER_CALLBACK_FAILED", "Standard Wallet public-consumer result callback failed"); }
  return result;
}

function envelope(source, privateService, input) {
  return Object.freeze({
    schemaVersion: 1,
    status: input.status,
    code: input.code,
    consumerId: source.consumerId,
    consumerSourceCommit: source.sourceCommit,
    consumerUrl: source.publicUrl,
    wallet: "ynx-wallet",
    providerAvailable: input.providerAvailable === true,
    identity: Object.freeze({ name: "YNX Wallet", rdns: "com.ynx.wallet", isYNXWallet: true, isMetaMask: false }),
    nativeChainId: "ynx_6423-1",
    evmChainId: 6423,
    chainId: STANDARD_WALLET_CHAIN_ID,
    privateService,
    standardWalletPreserved: input.status === STANDARD_WALLET_PUBLIC_HANDSHAKE_STATUS.READY,
    productSession: false,
    account: null,
    authority: STANDARD_WALLET_PUBLIC_HANDSHAKE_AUTHORITY,
    invokedMethods: Object.freeze(input.chainReadAttempted === true ? ["eth_chainId"] : []),
  });
}

function exactConfig(value) {
  if (!object(value) || Object.keys(value).sort().join("\n") !== ["onResult", "privateServiceStatus", "scope", "sourceBinding", "waitMs"].sort().join("\n")) throw new TypeError("Standard Wallet public-consumer handshake configuration is invalid");
  if (!object(value.scope) || !Number.isSafeInteger(value.waitMs) || value.waitMs < 0 || value.waitMs > 2_000 || typeof value.onResult !== "function") throw new TypeError("Standard Wallet public-consumer handshake configuration is invalid");
}
function sourceBinding(value, scope) {
  if (!object(value) || Object.keys(value).sort().join("\n") !== ["consumerId", "publicUrl", "sourceCommit"].sort().join("\n")) throw new TypeError("Standard Wallet public-consumer source binding is invalid");
  if (typeof value.consumerId !== "string" || !/^[a-z][a-z0-9-]{1,47}$/.test(value.consumerId) || typeof value.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(value.sourceCommit)) throw new TypeError("Standard Wallet public-consumer source binding is invalid");
  let pageOrigin, parsed;
  try { pageOrigin = scope.location.origin; parsed = new URL(value.publicUrl); } catch { throw new TypeError("Standard Wallet public-consumer URL binding is invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.origin !== pageOrigin || parsed.toString() !== value.publicUrl) throw new TypeError("Standard Wallet public-consumer URL binding is invalid");
  return Object.freeze({ consumerId: value.consumerId, sourceCommit: value.sourceCommit, publicUrl: value.publicUrl });
}
function privateServiceStatus(value) {
  if (![STANDARD_WALLET_PRIVATE_SERVICE.NOT_REQUESTED, STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED].includes(value)) throw new TypeError("Standard Wallet public-consumer private-service status is invalid");
  return value;
}
function exactYnxIdentity(provider, candidate) {
  try { return provider.isYNXWallet === true && provider.isMetaMask === false && provider.providerInfo?.rdns === "com.ynx.wallet" && candidate.rdns === "com.ynx.wallet"; }
  catch { return false; }
}
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
