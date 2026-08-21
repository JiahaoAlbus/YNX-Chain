import { STANDARD_WALLET_CHAIN_ID, STANDARD_WALLET_CONNECT_STATUS, createStandardWalletConnectState, discoverWalletProviders, launchWebAuthorization, reduceStandardWalletConnectState, type AuthorizationLaunchResult, type StandardWalletConnectState, type WalletProviderCandidate } from "../../../vendor/wallet-auth/src/index.js";

export const DEVELOPER_SAFE_AUTHORIZE_LAUNCHER_V2 = Object.freeze({
  contract: "safeWalletAuthorizeLauncher@2.0.0-p0.0",
  sourceCommit: "f1ba5013a817d4c03157e1cf83d7685606951a12",
  evidenceCommit: "649107488520f0973805b32704cfe4a02e15aafa",
  contractSha256: "defd0db6281839ef5efdfdb6b7b4734369058306f0dd7a90a16fbb6e1f776f6c",
  standardWalletConnectStateSource: "98c6d5d784d212df8981a53b17118a511e246ad2",
  standardWalletConnectStateEvidence: "c3ab255c32bdeb9c8e056882c315f8ad43c29c7f",
  standardWalletConnectStateHandoffSha256: "2c3872882b2d88986cecafa6c08fc3a640d60039eb8dab29d3a088aaa6452f49",
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
  connection: StandardWalletConnectState;
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
    return unsupportedConnection(discovery.detail, discovery.launch);
  }
  const selected = providerKind
    ? discovery.choices.find((choice) => choice.kind === providerKind)
    : discovery.choices.length === 1 ? discovery.choices[0] : undefined;
  if (!selected) {
    return Object.freeze({ status: "selection-required", detail: "EXPLICIT_WALLET_SELECTION_REQUIRED", account: null, providerKind: null, connection: reduceStandardWalletConnectState(createStandardWalletConnectState(), { type: "BEGIN", pendingIntent: pendingIntent() }), launch: discovery.launch });
  }
  const candidate = selected.candidate;
  let connection = reduceStandardWalletConnectState(createStandardWalletConnectState(), { type: "BEGIN", pendingIntent: pendingIntent() });
  connection = reduceStandardWalletConnectState(connection, { type: "PROVIDER_SELECTED", providerKind: candidate.kind });
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
  connection = reduceStandardWalletConnectState(connection, { type: "ACCOUNT_APPROVED", account: accounts[0] });
  const chainId = await candidate.provider.request({ method: "eth_chainId" });
  connection = reduceStandardWalletConnectState(connection, { type: "CHAIN_CONFIRMED", chainId });
  if (connection.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED) {
    return Object.freeze({ status: "unsupported", detail: "EIP1193_WRONG_CHAIN", account: connection.account, providerKind: candidate.kind, connection, launch: discovery.launch });
  }
  return Object.freeze({ status: "connected", detail: "EIP1193_ACCOUNT_CONNECTED_ON_YNX_TESTNET", account: connection.account, providerKind: candidate.kind, connection, launch: discovery.launch });
}

/** Refresh restoration never opens the chooser or asks for accounts. */
export async function restoreDeveloperWebWallet(providerKind: WalletProviderCandidate["kind"], scope: unknown = window): Promise<DeveloperWebWalletConnection> {
  const discovery = await discoverDeveloperWebWalletChoices(scope);
  const selected = discovery.status === "ready" ? discovery.choices.find((choice) => choice.kind === providerKind) : undefined;
  if (!selected) return unsupportedConnection("EIP1193_PROVIDER_NOT_RESTORED", discovery.launch);
  try {
    const [accounts, chainId] = await Promise.all([
      selected.candidate.provider.request({ method: "eth_accounts" }),
      selected.candidate.provider.request({ method: "eth_chainId" }),
    ]);
    const connection = reduceStandardWalletConnectState(createStandardWalletConnectState(), { type: "RESTORE", providerKind, accounts, chainId });
    return Object.freeze({ status: connection.status === STANDARD_WALLET_CONNECT_STATUS.CONNECTED ? "connected" : "unsupported", detail: connection.status === STANDARD_WALLET_CONNECT_STATUS.CONNECTED ? "EIP1193_RESTORED_ON_YNX_TESTNET" : "EIP1193_RESTORE_NOT_CONNECTED", account: connection.account, providerKind, connection, launch: discovery.launch });
  } catch {
    return unsupportedConnection("EIP1193_RESTORE_FAILED", discovery.launch);
  }
}

/** Trusted callers may record degradation, but it never invalidates a completed Standard Wallet connection. */
export function reduceDeveloperWalletPrivateServiceDegraded(connection: StandardWalletConnectState, code = "PRIVATE_SESSION_DEGRADED"): StandardWalletConnectState {
  return reduceStandardWalletConnectState(connection, { type: "PRIVATE_SESSION_DEGRADED", code });
}

/** A connected Wallet may expose its local details without creating another request. */
export function openDeveloperWebWalletConnectionDetails(connection: StandardWalletConnectState): StandardWalletConnectState {
  return reduceStandardWalletConnectState(connection, { type: "OPEN_CHOOSER" });
}

/**
 * Forget this product's local Standard Wallet state without asking an
 * extension to revoke global permissions. EIP-1193 has no portable revoke
 * method, so the next connection still requires an explicit product click.
 */
export function disconnectDeveloperWebWallet(connection: StandardWalletConnectState): StandardWalletConnectState {
  return reduceStandardWalletConnectState(connection, { type: "PROVIDER_DISCONNECT" });
}

/** No browser RPC fetch is permitted: this accepts only a reviewed, CORS-safe probe result. */
export function reduceDeveloperWalletRpcProbeDegraded(connection: StandardWalletConnectState, code = "RPC_PROBE_DEGRADED"): StandardWalletConnectState {
  return reduceStandardWalletConnectState(connection, { type: "RPC_PROBE_DEGRADED", code, probeTransport: "accepted-cors-safe" });
}

/**
 * The selected EIP-1193 provider remains authoritative after connection. These
 * listeners never re-open the chooser: only empty accounts, a wrong chain, or
 * a provider disconnect can invalidate the restored Standard Wallet state.
 */
export async function subscribeDeveloperWebWalletEvents(
  providerKind: WalletProviderCandidate["kind"],
  initial: StandardWalletConnectState,
  onChange: (connection: StandardWalletConnectState) => void,
  scope: unknown = window,
): Promise<() => void> {
  const discovery = await discoverDeveloperWebWalletChoices(scope);
  const selected = discovery.status === "ready" ? discovery.choices.find((choice) => choice.kind === providerKind) : undefined;
  const provider = selected?.candidate.provider as { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void } | undefined;
  if (!provider?.on) return () => undefined;
  let connection = initial;
  const transition = (event: { type: "ACCOUNTS_CHANGED"; accounts: unknown } | { type: "CHAIN_CHANGED"; chainId: unknown } | { type: "PROVIDER_DISCONNECT" }) => {
    try {
      connection = reduceStandardWalletConnectState(connection, event);
    } catch {
      connection = reduceStandardWalletConnectState(connection, { type: "PROVIDER_DISCONNECT" });
    }
    onChange(connection);
  };
  const accountsChanged = (accounts: unknown) => transition({ type: "ACCOUNTS_CHANGED", accounts });
  const chainChanged = (chainId: unknown) => transition({ type: "CHAIN_CHANGED", chainId });
  const disconnected = () => transition({ type: "PROVIDER_DISCONNECT" });
  provider.on("accountsChanged", accountsChanged);
  provider.on("chainChanged", chainChanged);
  provider.on("disconnect", disconnected);
  return () => {
    provider.removeListener?.("accountsChanged", accountsChanged);
    provider.removeListener?.("chainChanged", chainChanged);
    provider.removeListener?.("disconnect", disconnected);
  };
}

function pendingIntent(): string {
  return `developer_web_${Date.now().toString(36)}_connect`;
}

function unsupportedConnection(detail: string, launch: AuthorizationLaunchResult): DeveloperWebWalletConnection {
  return Object.freeze({ status: "unsupported", detail, account: null, providerKind: null, connection: createStandardWalletConnectState(), launch });
}

function providerErrorCode(value: unknown): number | null {
  return typeof value === "object" && value !== null && "code" in value && typeof (value as { code?: unknown }).code === "number"
    ? (value as { code: number }).code
    : null;
}
