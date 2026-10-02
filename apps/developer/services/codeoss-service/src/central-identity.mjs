import { createHash } from "node:crypto";

export const CENTRAL_IDENTITY = Object.freeze({
  endpoint: "https://wallet-auth.ynxweb4.com/v2/browser-sessions/introspect",
  clientId: "ynx-developer-v1-sso-v1", audience: "ynx:developer:identity",
  callback: "https://developer.ynxweb4.com/sso/callback",
});

// grantForRequest and workspaceBinding are backend-only adapters. The SSO callback
// stores an exchanged PKCE grant sealed on the backend; this consumer accepts no
// grant/subject/account from request bodies or caller-supplied identity headers.
export function createCentralIdentityVerifier({ grantForRequest, workspaceBinding,
  grantForReference, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  async function verifySealed(sealed) {
    if (typeof grantForRequest !== "function" || typeof workspaceBinding !== "function")
      throw fault("Wallet identity admission is not configured. Existing guest projects are preserved.", "core_identity_unavailable", 503);
    if (!sealed || typeof sealed.grantToken !== "string" || sealed.grantToken.length < 32 || sealed.grantToken.length > 8192)
      throw fault("Connect the current Wallet identity before launching this project.", "core_identity_required", 401);
    const sealedOwner = createHash("sha256").update(`YNX_DEVELOPER_IDENTITY_V1\n${CENTRAL_IDENTITY.audience}\n${sealed.subject}`).digest("hex");
    const revoked = (message, code) => Object.assign(fault(message, code, 401), { verifiedOwner: sealedOwner });
    const assertCurrent = () => { if (typeof sealed.isCurrent === "function" && !sealed.isCurrent()) throw revoked("Wallet identity changed or was signed out.", "core_identity_changed"); };
    assertCurrent();
    // Exact canonical sorted keys. No browser Origin, Sec-Fetch-Site or Cookie.
    const response = await fetchImpl(CENTRAL_IDENTITY.endpoint, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ clientId: CENTRAL_IDENTITY.clientId, grantToken: sealed.grantToken }),
      signal: AbortSignal.timeout(2500), redirect: "error",
    }).catch(() => { throw fault("Wallet identity verification is unavailable.", "core_identity_unavailable", 503); });
    if (!response.ok) {
      if (response.status >= 500) throw fault("Wallet identity verification is unavailable.", "core_identity_unavailable", 503);
      throw revoked("Wallet identity has expired or was revoked. Reconnect the Wallet.", "core_identity_invalid");
    }
    const value = await response.json().catch(() => null), id = value?.identity;
    const expiry = Math.min(timestamp(value?.expiresAt), timestamp(id?.expiresAt));
    if (value?.audience !== CENTRAL_IDENTITY.audience || !Array.isArray(value.scopes) ||
      value.scopes.length !== 1 || value.scopes[0] !== "identity:read" ||
      typeof id?.subject !== "string" || id.subject.length < 1 || id.subject.length > 256 ||
      typeof id.account !== "string" || id.account.length < 1 || id.account.length > 256 ||
      !Number.isSafeInteger(id.generation) || id.generation < 0 || !Number.isFinite(expiry) || expiry <= now())
      throw revoked("Wallet identity verification did not match the Developer audience.", "core_identity_invalid");
    if (sealed.subject !== id.subject || sealed.account !== id.account || sealed.generation !== id.generation)
      throw revoked("Wallet account changed. Reconnect before reopening this project.", "core_identity_changed");
    const owner = createHash("sha256").update(`YNX_DEVELOPER_IDENTITY_V1\n${CENTRAL_IDENTITY.audience}\n${id.subject}`).digest("hex");
    const binding = await workspaceBinding({ owner, subject: id.subject, account: id.account, generation: id.generation });
    assertCurrent();
    // An explicit backend-owned mapping is necessary; never adopt an arbitrary
    // guest cookie or move a guest project's files to whichever Wallet signs in.
    if (!binding || binding.owner !== owner || !/^[a-f0-9]{64}$/.test(binding.workspaceOwner || ""))
      throw fault("This Wallet has no approved workspace binding. Guest files remain available for recovery.", "core_workspace_binding_required", 403);
    return Object.freeze({ owner, workspaceOwner: binding.workspaceOwner, subject: id.subject,
      account: id.account, generation: id.generation, expiresAt: expiry, allowedCoreSession: sealed.allowedCoreSession || null,
      identityReference: sealed.identityReference || null, isCurrent: assertCurrent });
  }
  const verify = async request => verifySealed(await grantForRequest?.(request));
  // This identifier comes only from the protected backend record, never a
  // browser/body identity. Passive checks do not attest activity or reset idle.
  if (typeof grantForReference === "function") verify.resolveReference = async reference => verifySealed(await grantForReference(reference));
  return verify;
}

function timestamp(value) { return typeof value === "number" ? value * 1000 : typeof value === "string" ? Date.parse(value) : NaN; }
export function fault(message, code, status = 409) { return Object.assign(new Error(message), { code, status }); }
