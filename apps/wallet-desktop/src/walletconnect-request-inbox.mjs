import { createHash } from "node:crypto";

const failure = code => Object.assign(new Error("WalletConnect request cannot be queued for review."), { code: 4100, data: { code } });
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
export class WalletConnectRequestInbox {
  constructor({ now = Date.now, schedule = setTimeout, unschedule = clearTimeout, onExpire = () => {}, limit = 64, perOrigin = 8, ttlMs = 120_000 } = {}) {
    this.now = now; this.schedule = schedule; this.unschedule = unschedule; this.onExpire = onExpire;
    this.limit = limit; this.perOrigin = perOrigin; this.ttlMs = ttlMs; this.items = new Map(); this.completed = new Map();
  }
  accept(event, authorized, account) {
    const now = this.now();
    for (const [key, expiry] of this.completed) if (expiry <= now) this.completed.delete(key);
    if (typeof event?.topic !== "string" || !/^[A-Za-z0-9_-]{3,256}$/u.test(event.topic) || !(Number.isSafeInteger(event.id) && event.id >= 0 || typeof event.id === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(event.id))) throw failure("INVALID_WALLETCONNECT_REQUEST");
    const key = JSON.stringify([event.topic, event.id]);
    const wire = JSON.stringify({ topic: event.topic, id: event.id, params: event.params });
    if (Buffer.byteLength(wire) > 65536) throw failure("WALLETCONNECT_REQUEST_TOO_LARGE");
    const fingerprint = createHash("sha256").update(wire).digest("hex"), existing = this.items.get(key);
    if (this.completed.has(key)) return { duplicate: true, entry: null };
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.account !== account || existing.origin !== authorized.origin) { this.finish(key); void this.onExpire(existing, "WALLETCONNECT_REQUEST_ID_CONFLICT"); return { duplicate: true, entry: null }; }
      return { duplicate: true, entry: existing };
    }
    const timestamp = event.params?.request?.expiryTimestamp;
    if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp * 1000 <= now)) throw failure("WALLETCONNECT_REQUEST_EXPIRED");
    if (event.restored === true && timestamp === undefined) throw failure("WALLETCONNECT_RESTORED_DEADLINE_UNKNOWN");
    const expiresAt = Math.min(now + this.ttlMs, timestamp === undefined ? Infinity : timestamp * 1000);
    // Completed IDs retain their original deadline to reject late duplicates.
    // Bound both sets; new traffic cannot evict a still-live replay tombstone.
    if (this.items.size >= this.limit || this.completed.size >= this.limit * 4 || [...this.items.values()].filter(item => item.origin === authorized.origin).length >= this.perOrigin) throw failure("WALLETCONNECT_REQUEST_LIMIT");
    const entry = { key, fingerprint, account, origin: authorized.origin, expiresAt, event: freeze(JSON.parse(wire)), requestId: null, stage: "received", timer: null };
    entry.timer = this.schedule(() => { if (this.items.get(key) !== entry) return; this.finish(key); void this.onExpire(entry, "WALLETCONNECT_REQUEST_EXPIRED"); }, Math.max(1, expiresAt - now)); entry.timer?.unref?.();
    this.items.set(key, entry); return { duplicate: false, entry };
  }
  pending() { return [...this.items.values()]; }
  get(key) { return this.items.get(key); }
  assertLive(entry) { if (!entry || this.items.get(entry.key) !== entry || this.now() >= entry.expiresAt) throw failure("WALLETCONNECT_REQUEST_EXPIRED"); }
  stage(entry, requestId) { this.assertLive(entry); entry.stage = "review"; entry.requestId = requestId; }
  finish(key) {
    const entry = this.items.get(key); if (!entry) return null;
    this.unschedule(entry.timer); this.items.delete(key); this.completed.set(key, entry.expiresAt); return entry;
  }
}
