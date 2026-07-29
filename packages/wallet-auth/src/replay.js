import { WalletAuthError } from "./canonical.js";

export class OneTimeNonceStore {
  constructor(records = []) { this.records = new Map(records); }
  consume(request, at = new Date()) {
    this.prune(at);
    if (this.records.has(request.nonce)) throw new WalletAuthError("REPLAY", "Wallet authorization nonce was already used");
    this.records.set(request.nonce, request.expiresAt);
  }
  prune(at = new Date()) {
    for (const [nonce, expiresAt] of this.records) if (expiresAt <= at.toISOString()) this.records.delete(nonce);
  }
  snapshot() { return Object.freeze([...this.records.entries()].sort(([a], [b]) => a.localeCompare(b))); }
}
