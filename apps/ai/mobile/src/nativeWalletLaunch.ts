import {
  createCanonicalAuthorizeLaunch,
  launchNativeAuthorization,
  type AuthorizationLaunchResult,
  type AuthorizationRequest,
} from "@ynx-chain/wallet-auth";

export type NativeWalletLinking={
  canOpenURL:(url:string)=>Promise<boolean>;
  openURL:(url:string)=>Promise<unknown>;
};

export async function launchAIWalletAuthorization(
  response:{request:unknown;walletUrl:string},
  platform:"android"|"ios",
  linking:NativeWalletLinking,
):Promise<AuthorizationLaunchResult>{
  const request=response.request as AuthorizationRequest;
  const expected=createCanonicalAuthorizeLaunch(request).uri;
  if(response.walletUrl!==expected)throw new Error("Wallet authorization URL does not match the exact server request");
  return launchNativeAuthorization(request,platform,async uri=>{
    if(uri!==expected)throw new Error("Wallet authorization launcher changed the exact request");
    if(!await linking.canOpenURL(uri))return false;
    await linking.openURL(uri);
    return true;
  });
}
