import { launchWebAuthorization, type AuthorizationLaunchResult } from "../../../vendor/wallet-auth/src/index.js";

export const DEVELOPER_SAFE_AUTHORIZE_LAUNCHER_V2 = Object.freeze({
  contract: "safeWalletAuthorizeLauncher@2.0.0-p0.0",
  sourceCommit: "f1ba5013a817d4c03157e1cf83d7685606951a12",
  evidenceCommit: "649107488520f0973805b32704cfe4a02e15aafa",
  contractSha256: "defd0db6281839ef5efdfdb6b7b4734369058306f0dd7a90a16fbb6e1f776f6c",
  platform: "web",
  webStrategy: "EIP-6963 then injected EIP-1193; no custom-scheme navigation, frame, popup or account request.",
});

/** The accepted Web launcher ignores the request value by contract: discovery
 * must happen without creating pending authorization state or a custom URI. */
export async function discoverDeveloperWebWallet(scope: unknown = window): Promise<AuthorizationLaunchResult> {
  return launchWebAuthorization(undefined as never, { scope, waitMs: 250 });
}
