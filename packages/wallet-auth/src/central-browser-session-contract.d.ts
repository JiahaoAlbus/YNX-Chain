export const CENTRAL_BROWSER_ISSUER: "https://wallet-auth.ynxweb4.com";
export const CENTRAL_BROWSER_PURPOSE: string;
export const CENTRAL_BROWSER_RPC_METHOD: "ynx_requestCentralBrowserSignIn";
export interface CentralBrowserClient {
  readonly productId: string;
  readonly clientId: string;
  readonly origin: string;
  readonly redirectUri: string;
  readonly audience: string;
  readonly scopes: readonly ["identity:read"];
}
export interface CentralBrowserInitiator {
  readonly clientId: string;
  readonly origin: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
}
export interface CentralBrowserChallenge {
  readonly version: 1;
  readonly issuer: typeof CENTRAL_BROWSER_ISSUER;
  readonly purpose: string;
  readonly challengeId: string;
  readonly browserBinding: string;
  readonly nonce: string;
  readonly initiator: CentralBrowserInitiator;
  readonly clients: readonly Omit<CentralBrowserClient, "productId" | "redirectUri">[];
  readonly issuedAt: string;
  readonly expiresAt: string;
}
export interface CentralBrowserApproval {
  readonly challengeId: string;
  readonly account: string;
  readonly accountPublicKey: string;
  readonly walletSignature: string;
}
export function centralBrowserConsentSignBytes(challenge: CentralBrowserChallenge, account: string, accountPublicKey: string): string;
export function parseCentralBrowserSignInChallenge(challenge: unknown, registry: readonly CentralBrowserClient[], options: {peerOrigin: string; now?: number}): CentralBrowserChallenge;
export function parseCentralBrowserSignInApproval(approval: unknown): CentralBrowserApproval;
