import {
  canonicalJSON,
  createGatewayChallenge,
  parseCentralWalletSession,
  signGatewayChallenge,
  type AuthorizationRequest,
  type AuthorizationResponse,
  type CentralWalletSession,
  type GatewayCompletion,
} from "@ynx-chain/wallet-auth";
import { encodeBase64URL } from "./walletAuth";

export const CANONICAL_WALLET_GATEWAY_URL = "https://wallet-auth.ynxweb4.com";
export const SOCIAL_ORIGIN = "https://social.ynxweb4.com";
export const CANONICAL_SESSION_COMPLETE_PATH = "/v1/wallet/sessions/complete";

type GatewayFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "text">>;

export type CanonicalWalletGatewayInput = Readonly<{
  authorizationRequest: AuthorizationRequest;
  walletApproval: AuthorizationResponse;
  productDeviceSecret: string;
  randomChallenge: Uint8Array;
  now?: Date;
  fetcher?: GatewayFetch;
}>;

type CompletionPayload = Readonly<{
  authorizationRequest: AuthorizationRequest;
  walletApproval: AuthorizationResponse;
  gatewayCompletion: GatewayCompletion;
}>;

/**
 * A Social login is permitted only after the canonical Wallet Gateway creates
 * a session bound to the exact approved request and Social device key.
 */
export async function completeCanonicalWalletSession(input: CanonicalWalletGatewayInput): Promise<CentralWalletSession> {
  const now = checkedNow(input.now ?? new Date());
  const payload = createCanonicalWalletCompletion(input, now);
  const body = canonicalJSON(payload);
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`${CANONICAL_WALLET_GATEWAY_URL}${CANONICAL_SESSION_COMPLETE_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: SOCIAL_ORIGIN,
    },
    body,
  });
  const text = await response.text();
  const envelope = parseEnvelope(text, response.status);
  if (!response.ok || envelope.ok !== true) throw new Error(`Canonical Wallet Gateway session completion failed: ${gatewayCode(envelope)}`);
  if (envelope.schemaVersion !== 1 || !digest(envelope.stateDigest)) throw new Error("Canonical Wallet Gateway completion envelope is invalid");
  const session = parseCentralWalletSession(envelope.result);
  assertSessionBinding(session, payload);
  return session;
}

export function createCanonicalWalletCompletion(input: Omit<CanonicalWalletGatewayInput, "fetcher">, now = checkedNow(input.now ?? new Date())): CompletionPayload {
  if (!(input.randomChallenge instanceof Uint8Array) || input.randomChallenge.length !== 24) throw new Error("Canonical Wallet Gateway challenge entropy is invalid");
  if (typeof input.productDeviceSecret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.productDeviceSecret)) throw new Error("Canonical Wallet Gateway device secret is invalid");
  const approvalExpiresAt = Date.parse(input.walletApproval.expiresAt);
  const expiresAt = new Date(Math.min(approvalExpiresAt, now.getTime() + 60_000));
  if (!Number.isFinite(approvalExpiresAt) || expiresAt.getTime() <= now.getTime()) throw new Error("Canonical Wallet approval has expired");
  const challenge = createGatewayChallenge(input.walletApproval, {
    challenge: encodeBase64URL(input.randomChallenge),
    expiresAt: expiresAt.toISOString(),
  }, now);
  return Object.freeze({
    authorizationRequest: input.authorizationRequest,
    walletApproval: input.walletApproval,
    gatewayCompletion: signGatewayChallenge(challenge, input.productDeviceSecret),
  });
}

function parseEnvelope(text: string, status: number): Record<string, unknown> {
  if (typeof text !== "string" || text.length < 2 || text.length > 1_048_576) throw new Error(`Canonical Wallet Gateway returned an invalid response (${status})`);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`Canonical Wallet Gateway returned non-JSON (${status})`); }
  if (!plain(value)) throw new Error(`Canonical Wallet Gateway returned an invalid response (${status})`);
  return value;
}

function assertSessionBinding(session: CentralWalletSession, payload: CompletionPayload): void {
  const approval = payload.walletApproval;
  const request = payload.authorizationRequest;
  if (
    session.chainId !== request.chainId ||
    session.requestingProduct !== request.requestingProduct ||
    session.productClientId !== request.productClientId ||
    session.bundleId !== request.bundleId ||
    session.callback !== request.callback ||
    session.productDeviceAlgorithm !== request.productDeviceAlgorithm ||
    session.productDeviceKey !== request.productDeviceKey ||
    session.account !== approval.account ||
    session.requestDigest !== approval.requestDigest ||
    session.scopes.join("\n") !== approval.grantedScopes.join("\n")
  ) throw new Error("Canonical Wallet Gateway session does not match the approved Social request");
}

function gatewayCode(value: Record<string, unknown>): string {
  const error = value.error;
  return plain(error) && typeof error.code === "string" && /^[A-Z0-9_]{2,80}$/.test(error.code) ? error.code : "UNAVAILABLE";
}
function checkedNow(value: Date): Date { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Canonical Wallet Gateway clock is invalid"); return value; }
function digest(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
