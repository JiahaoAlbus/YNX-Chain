import { developerWalletV2Bridge, developerWalletV2Device, type DeveloperWalletBridge, type NativeDeveloperWalletDevice } from "./transport";
// @ts-ignore The accepted ESM package is vendored byte-for-byte under Developer ownership.
import { createProductWalletConnection, PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN, walletConnectionChoices, PRODUCT_SESSION_CLIENT_STATE } from "../../../vendor/wallet-auth/src/index.js";
import registry from "../../../vendor/wallet-auth/product-session-registry.json";

const ACCEPTED_PUBLIC_GATEWAY_ORIGIN = "https://wallet-auth.ynxweb4.com";
if (PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN !== ACCEPTED_PUBLIC_GATEWAY_ORIGIN) throw new Error("The accepted Wallet Product Session v2 origin was not preserved.");

export const DEVELOPER_WALLET_V2_SOURCE = Object.freeze({
  sourceCommit: "203be5e108be468350591615a64d5d36ab87a8f1",
  sourceTree: "94e291a6757447f89c7cf6b8f01bbf811cb7d1f7",
  packageTree: "02eb7176e2de175a68cf5a5ef27e55968cc17fea",
  gatewayOrigin: ACCEPTED_PUBLIC_GATEWAY_ORIGIN,
  migrated: false,
});

export type DeveloperWalletV2Runtime = {
  connection: any;
  source: typeof DEVELOPER_WALLET_V2_SOURCE;
  endNativeOperation: () => Promise<void>;
};
let explicitNativeOwner: symbol | null = null;

/**
 * The only Developer-owned v2 construction point.  The accepted SDK fixes the
 * public origin and routes internally; this module intentionally exposes no
 * endpoint, callback, session, clock or transport injection surface.
 */
export async function createDeveloperWalletV2Runtime(): Promise<DeveloperWalletV2Runtime | null> {
  const bridge = developerWalletV2Bridge();
  if (!bridge) return null;
  return createNativeRuntime(bridge);
}

/** Explicit Connect factory. This asks for native consent and constructs the
 * canonical SDK consumer; the UI then chooses beginYNX or an explicit restore.
 * Inspection/Guest never call this function. No Wallet or HTTP request is sent
 * by construction, and cancellation does not erase protected pending/session.
 */
export async function beginDeveloperWalletV2Connection(): Promise<DeveloperWalletV2Runtime> {
  const bridge = developerWalletV2Bridge();
  if (!bridge) throw new Error("A native OS-protected Developer Wallet device and storage bridge is required.");
  if (explicitNativeOwner !== null) throw new Error("Finish the current native Developer Wallet operation before starting another.");
  const owner = Symbol("native-wallet-operation"); explicitNativeOwner = owner;
  try {
    const grantedDevice = await bridge.beginConnection!();
    const currentDevice = await developerWalletV2Device(bridge);
    if (currentDevice.key !== grantedDevice?.key) throw new Error("Native Developer Wallet device changed during connection approval.");
    return await createNativeRuntime(bridge, grantedDevice, owner);
  } catch (error) {
    try { await bridge.endConnection!(); } catch { /* Native navigation/expiry also revokes the short capability. Preserve protected state. */ }
    if (explicitNativeOwner === owner) explicitNativeOwner = null;
    throw error;
  }
}

async function createNativeRuntime(bridge: DeveloperWalletBridge, grantedDevice?: NativeDeveloperWalletDevice, owner?: symbol): Promise<DeveloperWalletV2Runtime> {
  const nativeDevice = await developerWalletV2Device(bridge, grantedDevice);
  const availability = await bridge.walletAvailability!();
  if (!availability || typeof availability.walletInstalled !== "boolean" || typeof availability.schemeRegistered !== "boolean" || bridge !== developerWalletV2Bridge()) throw new Error("Native Developer Wallet availability or document binding is invalid.");
  let active = grantedDevice !== undefined;
  const assertActive = () => { if (!active || bridge !== developerWalletV2Bridge()) throw new Error("Explicit native Developer Wallet connection approval is required."); };
  let pendingOperation = false;
  let expirationTimer: ReturnType<typeof setTimeout> | undefined;
  const releaseNativeOperation = async () => { if (!active) return; active = false; clearTimeout(expirationTimer); try { await bridge.endConnection!(); } finally { if (explicitNativeOwner === owner) explicitNativeOwner = null; } };
  const endNativeOperation = async () => { if (active && pendingOperation) sdk.setNetworkAvailable(false); await releaseNativeOperation(); };
  const sdk = createProductWalletConnection({
    registry,
    productId: "developer",
    platform: "macos",
    walletInstalled: async () => availability.walletInstalled,
    schemeRegistered: async () => availability.schemeRegistered,
    gatewayTimeoutMs: 10_000,
    storage: {
      securityLevel: "os-protected",
      get: (key: string) => bridge.protectedStorage!.get(key),
      set: async (key: string, value: string) => { assertActive(); await bridge.protectedStorage!.set(key, value); },
      remove: async (key: string) => { assertActive(); await bridge.protectedStorage!.remove(key); },
    },
    device: Object.freeze({ ...nativeDevice, sign: async (input: Parameters<typeof nativeDevice.sign>[0]) => { assertActive(); return nativeDevice.sign(input); } }),
    scope: window,
    discoveryWaitMs: 250,
    openWallet: async ({ url }: { url: string }) => {
      try { assertActive(); await bridge.openAuthorization(url); return { opened: true }; }
      catch { return { opened: false, code: "WALLET_OPEN_FAILED" }; }
    },
    openTimeoutMs: 10_000,
  });
  const operate = async (method: "beginYNX" | "retryYNX" | "restore" | "handleReturn" | "disconnect", args: unknown[], alwaysEnd = false) => {
    assertActive();
    if (pendingOperation) throw new Error("Finish the pending Developer Wallet operation before starting another.");
    pendingOperation = true;
    try {
      const execute = sdk[method] as (...parameters: unknown[]) => Promise<any>;
      const result = await execute.apply(sdk, args);
      if (alwaysEnd || result?.status !== "wallet-opened") await releaseNativeOperation();
      return result;
    } catch (error) {
      try { await releaseNativeOperation(); } catch { /* Keep the original SDK failure and protected recovery evidence. */ }
      throw error;
    } finally { pendingOperation = false; }
  };
  // A thin lifecycle fence around the real SDK, not another Auth state machine.
  // In particular, readonly inspection cannot accidentally invoke SDK restore's
  // automatic reconnect or its protected-state cleanup without native consent.
  const connection = Object.freeze({
    get current() { return sdk.current; },
    get storageKey() { return sdk.storageKey; },
    get connectionBinding() { return sdk.connectionBinding; },
    options: () => sdk.options(),
    enterGuest: async () => { if (pendingOperation) throw new Error("Finish the pending Developer Wallet operation before entering Guest."); const result = sdk.enterGuest(); await releaseNativeOperation(); return result; },
    setNetworkAvailable: (available: boolean) => sdk.setNetworkAvailable(available),
    beginYNX: () => operate("beginYNX", []),
    retryYNX: () => operate("retryYNX", []),
    restore: (networkAvailable = true) => operate("restore", [networkAvailable]),
    handleReturn: (url: string) => operate("handleReturn", [url], true),
    disconnect: () => operate("disconnect", [], true),
  });
  // Match the native five-minute upper bound and release the frontend owner
  // too, so an abandoned review cannot permanently block explicit reconnect.
  if (active) expirationTimer = setTimeout(() => { void endNativeOperation().catch(() => {}); }, 300_000);
  return Object.freeze({ connection, source: DEVELOPER_WALLET_V2_SOURCE, endNativeOperation });
}

export async function inspectDeveloperWalletV2Runtime() {
  // Passive inspection observes only the current document's native interface.
  // Reading device() can touch an unprovisioned Keychain identity; constructing
  // the SDK also probes installation. Neither belongs in a view's initial render.
  try {
    const bridge = developerWalletV2Bridge();
    return Object.freeze({ available: Boolean(bridge), bridgeContract: bridge ? "present" : "missing", deviceStatus: "not-observed", authoritative: false,
      requiresExplicitConnection: true, options: undefined as { availability?: { ynxWalletInstalled?: boolean } } | undefined,
      source: DEVELOPER_WALLET_V2_SOURCE, reason: bridge ? undefined : "The native Wallet interface is unavailable in this document." });
  } catch {
    return Object.freeze({ available: false, bridgeContract: "check-failed", deviceStatus: "not-observed", authoritative: false,
      requiresExplicitConnection: true, options: undefined as { availability?: { ynxWalletInstalled?: boolean } } | undefined,
      source: DEVELOPER_WALLET_V2_SOURCE, reason: "The native Wallet interface could not be inspected." });
  }
}

export async function enterDeveloperWalletV2Guest() {
  // Guest is a local development choice, independent of device provisioning.
  // Consume the SDK's pure guest choice and limits without constructing a
  // fictitious device/session or changing any existing Wallet connection.
  const guest = walletConnectionChoices(registry, "developer", { ynxWalletInstalled: false, metaMaskAvailable: false }).find((choice: any) => choice.id === "guest");
  if (!guest || guest.authoritative !== false || !Array.isArray(guest.limitations)) return unavailable(new Error("The accepted SDK did not provide a non-authoritative Guest choice."));
  const sessionState = Object.freeze({ status: PRODUCT_SESSION_CLIENT_STATE.GUEST, message: guest.label, limitations: Object.freeze([...guest.limitations]) });
  return Object.freeze({ available: true, connectionMode: "local-guest", authoritative: false, sessionState, source: DEVELOPER_WALLET_V2_SOURCE });
}

function unavailable(error: unknown) { return Object.freeze({ available: false, reason: error instanceof Error ? error.message : "Native Developer Wallet is unavailable.", requiresExplicitConnection: true, source: DEVELOPER_WALLET_V2_SOURCE }); }
