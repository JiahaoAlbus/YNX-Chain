import { encodeRequestDeepLink } from "@ynx-chain/wallet-auth";
import type { WalletAuthorizationRequest } from "./walletAuth";

export const YNX_WALLET_DOWNLOAD_URL =
  "https://www.ynxweb4.com/downloads/ynx-wallet-1.0.1-testnet-preview-dc31c9a8-test-signed.apk";
export const METAMASK_MOBILE_DAPP_URL =
  "https://metamask.app.link/dapp/www.ynxweb4.com/dapp/wallet";

export type WalletOpenFailure =
  | "WALLET_NOT_INSTALLED"
  | "SCHEME_NOT_REGISTERED"
  | "USER_REJECTED"
  | "NETWORK_UNAVAILABLE";
export type WalletOpenResult = Readonly<
  { opened: true } | { opened: false; code: WalletOpenFailure }
>;

type AndroidWalletLauncher = Readonly<{
  openCanonicalWallet(url: string): Promise<WalletOpenResult>;
}>;
export type WalletLauncherAdapter = Readonly<{
  platform: string;
  android?: AndroidWalletLauncher;
  canOpenURL(url: string): Promise<boolean>;
  openURL(url: string): Promise<unknown>;
}>;

export async function openWalletAuthorizationWithAdapter(
  request: WalletAuthorizationRequest,
  adapter: WalletLauncherAdapter,
): Promise<WalletOpenResult> {
  const url = encodeRequestDeepLink(request);
  if (adapter.platform === "android") {
    if (!adapter.android)
      return Object.freeze({ opened: false, code: "SCHEME_NOT_REGISTERED" });
    const result = await adapter.android.openCanonicalWallet(url);
    if (
      result?.opened === true ||
      (result?.opened === false &&
        [
          "WALLET_NOT_INSTALLED",
          "SCHEME_NOT_REGISTERED",
          "USER_REJECTED",
          "NETWORK_UNAVAILABLE",
        ].includes(result.code))
    )
      return Object.freeze(result);
    return Object.freeze({ opened: false, code: "SCHEME_NOT_REGISTERED" });
  }

  if (!(await adapter.canOpenURL(url)))
    return Object.freeze({ opened: false, code: "WALLET_NOT_INSTALLED" });

  try {
    await adapter.openURL(url);
    return Object.freeze({ opened: true });
  } catch {
    return Object.freeze({ opened: false, code: "SCHEME_NOT_REGISTERED" });
  }
}

