import { discoverWalletProviders, launchWebAuthorization, type AuthorizationLaunchResult, type WalletProviderCandidate } from "../../../vendor/wallet-auth/src/index.js";

export const DEVELOPER_SAFE_AUTHORIZE_LAUNCHER_V2 = Object.freeze({
  contract: "safeWalletAuthorizeLauncher@2.0.0-p0.0",
  sourceCommit: "f1ba5013a817d4c03157e1cf83d7685606951a12",
  evidenceCommit: "649107488520f0973805b32704cfe4a02e15aafa",
  contractSha256: "defd0db6281839ef5efdfdb6b7b4734369058306f0dd7a90a16fbb6e1f776f6c",
  platform: "web",
  webStrategy: "EIP-6963 then injected EIP-1193; an explicit user click may request accounts and add/switch only the fixed YNX Testnet chain. No custom-scheme navigation, frame or popup.",
});

export const YNX_TESTNET_EIP1193_CHAIN = Object.freeze({
  chainId: "0x1917",
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Test Token", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc.ynxweb4.com/evm"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

export type DeveloperWebWalletConnection = Readonly<{
  status: "connected" | "selection-required" | "unsupported";
  detail: string;
  account: string | null;
  providerKind: WalletProviderCandidate["kind"] | null;
  launch: AuthorizationLaunchResult;
}>;

export type DeveloperWebWalletChoice = Readonly<{
  kind: WalletProviderCandidate["kind"];
  label: "YNX Wallet" | "MetaMask";
  candidate: WalletProviderCandidate;
}>;

export type DeveloperWebWalletDiscovery = Readonly<{
  status: "ready" | "unsupported";
  detail: string;
  choices: readonly DeveloperWebWalletChoice[];
  launch: AuthorizationLaunchResult;
}>;

/** The accepted Web launcher ignores the request value by contract: discovery
 * must happen without creating pending authorization state or a custom URI. */
export async function discoverDeveloperWebWallet(scope: unknown = window): Promise<AuthorizationLaunchResult> {
  return launchWebAuthorization(undefined as never, { scope, waitMs: 250 });
}

/**
 * Browser extensions are injected by the user, so an app must never silently
 * prefer one recognised Wallet over another. The canonical launcher supplies
 * the safe no-navigation baseline; this UI-facing adapter exposes each
 * unambiguous candidate for an explicit product click.
 */
export async function discoverDeveloperWebWalletChoices(scope: unknown = window): Promise<DeveloperWebWalletDiscovery> {
  const launch = await discoverDeveloperWebWallet(scope);
  if (launch.status !== "provider-ready" || !launch.providerCandidate) {
    return Object.freeze({ status: "unsupported", detail: launch.detail, choices: Object.freeze([]), launch });
  }
  const discovery = await discoverWalletProviders(scope, 250);
  if (discovery.ambiguities.length || discovery.conflictedAnnouncements) {
    return Object.freeze({ status: "unsupported", detail: "AMBIGUOUS_EIP1193_PROVIDER", choices: Object.freeze([]), launch });
  }
  const candidates = [discovery.ynx, discovery.metamask].filter((candidate): candidate is WalletProviderCandidate => candidate !== null);
  if (!candidates.some((candidate) => candidate.provider === launch.providerCandidate?.provider)) candidates.push(launch.providerCandidate);
  const choices = Object.freeze(candidates.map((candidate) => Object.freeze({
    kind: candidate.kind,
    label: candidate.kind === "ynx-wallet" ? "YNX Wallet" : "MetaMask",
    candidate,
  })));
  return Object.freeze({ status: "ready", detail: launch.detail, choices, launch });
}

/**
 * The click handler for the public Web product. Discovery remains canonical
 * Wallet/Auth source; this Developer-owned adapter performs only standard
 * EIP-1193 methods on its selected candidate. It never opens a custom URI or
 * creates a callback/Product Session.
 */
export async function connectDeveloperWebWallet(providerKind?: WalletProviderCandidate["kind"], scope: unknown = window): Promise<DeveloperWebWalletConnection> {
  const discovery = await discoverDeveloperWebWalletChoices(scope);
  if (discovery.status !== "ready") {
    return Object.freeze({ status: "unsupported", detail: discovery.detail, account: null, providerKind: null, launch: discovery.launch });
  }
  const selected = providerKind
    ? discovery.choices.find((choice) => choice.kind === providerKind)
    : discovery.choices.length === 1 ? discovery.choices[0] : undefined;
  if (!selected) {
    return Object.freeze({ status: "selection-required", detail: "EXPLICIT_WALLET_SELECTION_REQUIRED", account: null, providerKind: null, launch: discovery.launch });
  }
  const candidate = selected.candidate;
  try {
    await candidate.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: YNX_TESTNET_EIP1193_CHAIN.chainId }] });
  } catch (value) {
    if (providerErrorCode(value) !== 4902) throw value;
    await candidate.provider.request({ method: "wallet_addEthereumChain", params: [YNX_TESTNET_EIP1193_CHAIN] });
    await candidate.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: YNX_TESTNET_EIP1193_CHAIN.chainId }] });
  }
  const accounts = await candidate.provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-f]{40}$/i.test(accounts[0])) {
    throw new Error("The Wallet did not return a valid EIP-1193 account.");
  }
  return Object.freeze({ status: "connected", detail: "EIP1193_ACCOUNT_CONNECTED_ON_YNX_TESTNET", account: accounts[0], providerKind: candidate.kind, launch: discovery.launch });
}

function providerErrorCode(value: unknown): number | null {
  return typeof value === "object" && value !== null && "code" in value && typeof (value as { code?: unknown }).code === "number"
    ? (value as { code: number }).code
    : null;
}
