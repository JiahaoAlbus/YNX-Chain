/**
 * Consumer-facing profile definitions for the Developer compatibility lab.
 *
 * These profiles intentionally use a selected real EIP-1193 provider. They
 * are neither wallet fixtures nor a substitute WalletConnect client. The
 * shared Standard Wallet discovery/connect state stays in
 * safe-authorize-launcher.ts, which is the only place that selects a browser
 * provider and establishes the YNX Testnet connection.
 */
export const DAPP_COMPATIBILITY_PROFILES = Object.freeze([
  Object.freeze({
    id: "ynx-first-party",
    audience: "First-party",
    title: "YNX Developer workspace",
    description: "Connect a selected standard provider to YNX Testnet. No signature or transaction is requested by this profile.",
    operation: "connect",
  }),
  Object.freeze({
    id: "uniswap-interface-reference",
    audience: "External standard DApp",
    title: "Uniswap Interface reference profile",
    description: "Unaffiliated standard-EVM compatibility profile. Uses personal_sign on the selected real provider after the DApp explicitly requests a message signature.",
    operation: "personal_sign",
  }),
  Object.freeze({
    id: "opensea-reference",
    audience: "External standard DApp",
    title: "OpenSea reference profile",
    description: "Unaffiliated standard-EVM compatibility profile. Uses eth_signTypedData_v4 for a readable, YNX-Testnet-bound typed-data request.",
    operation: "eip712",
  }),
  Object.freeze({
    id: "safe-reference",
    audience: "External standard DApp",
    title: "Safe reference profile",
    description: "Unaffiliated standard-EVM compatibility profile. Sends a transaction only when the user has supplied every transaction field and confirms it in their Wallet.",
    operation: "send_transaction",
  }),
  Object.freeze({
    id: "walletconnect-v2-bridge",
    audience: "External standard DApp",
    title: "WalletConnect v2 bridge",
    description: "Requires a separately configured, real WalletConnect v2 EIP-1193 adapter. This lab never simulates a WalletConnect session.",
    operation: "walletconnect",
  }),
] as const);

export type DappCompatibilityProfile = (typeof DAPP_COMPATIBILITY_PROFILES)[number];
export type DappCompatibilityOperation = Exclude<DappCompatibilityProfile["operation"], "connect" | "walletconnect">;

export type Eip1193Provider = Readonly<{
  request(input: Readonly<{ method: string; params?: readonly unknown[] }>): Promise<unknown>;
}>;

export type TestnetTransactionRequest = Readonly<{
  to: string;
  value: string;
  data?: string;
}>;

const accountPattern = /^0x[0-9a-f]{40}$/i;
const hexPattern = /^0x(?:[0-9a-f]{2})*$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;

export function profileById(id: string): DappCompatibilityProfile {
  const profile = DAPP_COMPATIBILITY_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error("Unknown DApp compatibility profile.");
  return profile;
}

/** Executes only the exact standard request advertised by a profile. */
export async function executeDappCompatibilityOperation(
  provider: Eip1193Provider,
  profileId: string,
  account: string,
  transaction?: TestnetTransactionRequest,
): Promise<unknown> {
  if (!accountPattern.test(account)) throw new Error("A selected EIP-1193 provider must first return an approved account.");
  const profile = profileById(profileId);
  if (profile.operation === "connect") return Object.freeze({ status: "connected", account });
  if (profile.operation === "walletconnect") {
    throw new Error("WalletConnect v2 requires a separately configured, real EIP-1193 adapter. This compatibility lab does not simulate sessions.");
  }
  if (profile.operation === "personal_sign") {
    return provider.request({
      method: "personal_sign",
      params: [`YNX Developer compatibility check for ${profile.title}. Only sign this message if you intend to continue.`, account],
    });
  }
  if (profile.operation === "eip712") {
    const typedData = {
      domain: { name: "YNX Developer Compatibility Lab", version: "1", chainId: 6423 },
      primaryType: "CompatibilityApproval",
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
        ],
        CompatibilityApproval: [
          { name: "profile", type: "string" },
          { name: "account", type: "address" },
          { name: "purpose", type: "string" },
        ],
      },
      message: { profile: profile.id, account, purpose: "YNX Testnet DApp interoperability check" },
    };
    return provider.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] });
  }
  if (!transaction || !accountPattern.test(transaction.to) || !quantityPattern.test(transaction.value) || (transaction.data !== undefined && !hexPattern.test(transaction.data))) {
    throw new Error("Provide a 20-byte recipient, a 0x-prefixed testnet value, and optional even-length hex data before the Wallet is asked to send a transaction.");
  }
  return provider.request({
    method: "eth_sendTransaction",
    params: [Object.freeze({ from: account, to: transaction.to, value: transaction.value, ...(transaction.data ? { data: transaction.data } : {}) })],
  });
}

/**
 * A WalletConnect consumer must supply the actual adapter; no fixture is
 * accepted. This guard deliberately performs no QR/session creation.
 */
export function assertRealWalletConnectAdapter(adapter: unknown): asserts adapter is Readonly<{ connect(input: unknown): Promise<unknown> }> {
  if (!adapter || typeof adapter !== "object" || !("connect" in adapter) || typeof (adapter as { connect?: unknown }).connect !== "function") {
    throw new Error("A configured WalletConnect v2 adapter with connect() is required; a fixture cannot be used as runtime evidence.");
  }
}
