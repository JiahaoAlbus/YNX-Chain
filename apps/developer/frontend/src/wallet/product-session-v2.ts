import { desktopWalletBridge, developerWalletV2Device } from "./transport";
// @ts-ignore The accepted ESM package is vendored byte-for-byte under Developer ownership.
import { createProductWalletConnection, PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN } from "../../../vendor/wallet-auth/src/index.js";
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
};

/**
 * The only Developer-owned v2 construction point.  The accepted SDK fixes the
 * public origin and routes internally; this module intentionally exposes no
 * endpoint, callback, session, clock or transport injection surface.
 */
export async function createDeveloperWalletV2Runtime(): Promise<DeveloperWalletV2Runtime | null> {
  const bridge = desktopWalletBridge();
  if (!bridge?.protectedStorage) return null;
  const availability = bridge.walletAvailability ? await bridge.walletAvailability() : { walletInstalled: false, schemeRegistered: false };
  const device = await developerWalletV2Device();
  const connection = createProductWalletConnection({
    registry,
    productId: "developer",
    platform: "macos",
    walletInstalled: async () => availability.walletInstalled,
    schemeRegistered: async () => availability.schemeRegistered,
    gatewayTimeoutMs: 10_000,
    storage: bridge.protectedStorage,
    device,
    scope: window,
    discoveryWaitMs: 250,
    openWallet: async ({ url }: { url: string }) => {
      try { await bridge.openAuthorization(url); return { opened: true }; }
      catch { return { opened: false, code: "WALLET_NOT_INSTALLED" }; }
    },
    openTimeoutMs: 10_000,
  });
  return Object.freeze({ connection, source: DEVELOPER_WALLET_V2_SOURCE });
}

export async function inspectDeveloperWalletV2Runtime() {
  const runtime = await createDeveloperWalletV2Runtime();
  if (!runtime) return Object.freeze({ available: false, reason: "A native OS-protected Developer Wallet storage bridge is required.", source: DEVELOPER_WALLET_V2_SOURCE });
  const options = await runtime.connection.options();
  return Object.freeze({ available: true, options, source: runtime.source });
}

export async function enterDeveloperWalletV2Guest() {
  const runtime = await createDeveloperWalletV2Runtime();
  if (!runtime) return Object.freeze({ available: false, reason: "A native OS-protected Developer Wallet storage bridge is required.", source: DEVELOPER_WALLET_V2_SOURCE });
  return Object.freeze({ available: true, sessionState: runtime.connection.enterGuest(), source: runtime.source });
}
