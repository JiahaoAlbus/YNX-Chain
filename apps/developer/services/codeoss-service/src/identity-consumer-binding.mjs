import { createHash } from "node:crypto";

// This is a stale-view guard, not an authentication token. Admission still
// verifies the server-owned Wallet session on every request.
export function consumerIdentityBinding(identity) {
  if (!identity || !["owner", "workspaceOwner", "account", "identityReference"].every(key => typeof identity[key] === "string" && identity[key].length > 0) ||
      !Number.isSafeInteger(identity.generation) || identity.generation < 0 ||
      !Number.isFinite(identity.expiresAt) || identity.expiresAt <= Date.now() ||
      typeof identity.isCurrent !== "function" || identity.isCurrent() === false)
    throw changed();
  return createHash("sha256").update(JSON.stringify([
    identity.owner, identity.workspaceOwner, identity.account, identity.generation, identity.identityReference,
  ])).digest("hex");
}

export function assertExpectedIdentity(request, identity) {
  if (request.headers["x-ynx-agent-identity"] !== consumerIdentityBinding(identity)) throw changed();
}

function changed() {
  return Object.assign(new Error("Wallet identity changed. Refresh your Wallet projects before continuing."), {
    status: 401, code: "core_consumer_identity_changed",
  });
}
