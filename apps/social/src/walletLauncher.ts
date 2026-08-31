import { Linking, NativeModules, Platform } from "react-native";
import type { WalletAuthorizationRequest } from "./walletAuth";
import {
  METAMASK_MOBILE_DAPP_URL,
  YNX_WALLET_DOWNLOAD_URL,
  openWalletAuthorizationWithAdapter,
  type WalletOpenResult,
} from "./walletLauncherCore";

type AndroidWalletLauncher = Readonly<{
  openCanonicalWallet(url: string): Promise<WalletOpenResult>;
}>;

export { METAMASK_MOBILE_DAPP_URL, YNX_WALLET_DOWNLOAD_URL };

const nativeLauncher = NativeModules.YNXWalletLauncher as
  | AndroidWalletLauncher
  | undefined;

export async function openWalletAuthorization(
  request: WalletAuthorizationRequest,
): Promise<WalletOpenResult> {
  return openWalletAuthorizationWithAdapter(request, {
    platform: Platform.OS,
    android: nativeLauncher,
    canOpenURL: Linking.canOpenURL,
    openURL: Linking.openURL,
  });
}

export async function openWalletAlternative(url: string): Promise<void> {
  if (url !== YNX_WALLET_DOWNLOAD_URL && url !== METAMASK_MOBILE_DAPP_URL)
    throw new Error("Wallet alternative URL is not approved");
  await Linking.openURL(url);
}
