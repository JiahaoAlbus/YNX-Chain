import {DAppConnectError, productSessionStateFromError} from "./errors.js";

function randomId() { return globalThis.crypto?.randomUUID?.() || `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function ensureRecord(record, now) {
  for (const key of ["pendingId", "requestDigest", "nonce", "productClientId", "bundleId", "callback", "deviceKeyReference", "createdAt", "expiresAt", "state"]) if (!record[key]) throw new DAppConnectError("CALLBACK_PENDING_MISSING", `Pending callback record lacks ${key}.`);
  if (Date.parse(record.expiresAt) <= now) throw new DAppConnectError("CALLBACK_EXPIRED", "Pending callback record expired.");
}

export class PendingCallbackStore {
  constructor(storage, {now = () => Date.now()} = {}) { if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) throw new DAppConnectError("PENDING_STORAGE_REQUIRED", "Durable pending callback storage is required."); this.storage = storage; this.now = now; }
  begin(input) { const record = {schemaVersion: 1, pendingId: randomId(), state: "PENDING", createdAt: new Date(this.now()).toISOString(), ...input}; ensureRecord(record, this.now()); this.storage.setItem(`ynx.pending.${record.pendingId}`, JSON.stringify(record)); return record; }
  consume({pendingId, response, requestDigest, nonce, productClientId, bundleId, callback, deviceKeyReference}) {
    const raw = this.storage.getItem(`ynx.pending.${pendingId}`); if (!raw) throw new DAppConnectError("CALLBACK_PENDING_MISSING", "No durable pending callback record exists.");
    const record = JSON.parse(raw); ensureRecord(record, this.now());
    if (record.state !== "PENDING") throw new DAppConnectError("CALLBACK_REPLAY", "Pending callback was already consumed.");
    const values = {requestDigest, nonce, productClientId, bundleId, callback, deviceKeyReference};
    if (Object.entries(values).some(([key, value]) => record[key] !== value)) throw new DAppConnectError("CALLBACK_MISMATCH", "Returned callback does not match the pending Wallet approval.");
    if (typeof response !== "string" || !response) throw new DAppConnectError("CALLBACK_MISMATCH", "Callback response is missing.");
    record.state = "CONSUMED"; this.storage.setItem(`ynx.pending.${pendingId}`, JSON.stringify(record)); return record;
  }
}

export async function enhanceWithProductSession({standardConnection, complete}) {
  if (!standardConnection?.account) throw new DAppConnectError("ACCOUNT_REQUIRED", "Product Session can only enhance an established standard Wallet connection.");
  if (typeof complete !== "function") throw new DAppConnectError("PRODUCT_SESSION_COMPLETION_REQUIRED", "A Product Session completion function is required.");
  try { const session = await complete(); if (!session?.sessionBinding) throw new DAppConnectError("PRODUCT_SESSION_INVALID", "Gateway did not return a canonical Product Session."); return {state: "PRODUCT_SESSION_READY", session}; }
  catch (error) { return productSessionStateFromError(error); }
}
