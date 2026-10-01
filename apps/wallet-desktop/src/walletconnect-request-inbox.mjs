import { createHash } from "node:crypto";

const failure = code => Object.assign(new Error("WalletConnect request cannot be queued for review."), { code: 4100, data: { code } });
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const STORE_KEY="ynx-wallet:walletconnect-review-inbox:v1";
const canonical=value=>JSON.stringify(value&&typeof value==="object"?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,JSON.parse(canonical(value[key]))])):value);
export class WalletConnectRequestInbox {
  constructor({ now = Date.now, schedule = setTimeout, unschedule = clearTimeout, onExpire = () => {}, limit = 64, perOrigin = 8, ttlMs = 120_000 } = {}) {
    this.now = now; this.schedule = schedule; this.unschedule = unschedule; this.onExpire = onExpire;
    this.limit = limit; this.perOrigin = perOrigin; this.ttlMs = ttlMs; this.items = new Map(); this.completed = new Map();this.records=new Map();this.storage=null;this.starting=null;this.writes=Promise.resolve();
  }
  start(storage,pendingKeys=[]){if(this.starting)return this.starting;this.starting=(async()=>{
    if(!storage?.getItem||!storage?.setItem)throw failure("WALLETCONNECT_REVIEW_STORAGE_UNAVAILABLE");
    this.sdkPending=new Set(pendingKeys);const state=await storage.getItem(STORE_KEY);
    if(state!=null){if(state.version!==1||!Array.isArray(state.records)||state.records.length>this.limit*4||JSON.stringify(state).length>262144||state.records.some(record=>!record||typeof record.key!=="string"||!/^[a-f0-9]{64}$/.test(record.fingerprint)||typeof record.account!=="string"||typeof record.origin!=="string"||typeof record.sessionBinding!=="string"||!Number.isSafeInteger(record.expiresAt)||!["undecided","decided"].includes(record.state))||new Set(state.records.map(record=>record.key)).size!==state.records.length)throw failure("WALLETCONNECT_REVIEW_STORAGE_INVALID");for(const stored of state.records){const record=JSON.parse(JSON.stringify(stored));if(record.expiresAt<=this.now()&&!this.sdkPending.has(record.key))continue;this.records.set(record.key,record);if(record.state==="decided")this.completed.set(record.key,record.expiresAt);}}
    this.storage=storage;
  })();this.starting.catch(()=>{this.starting=null;});return this.starting;}
  persist(){const work=this.writes.catch(()=>{}).then(async()=>{if(!this.storage)return;const state={version:1,records:[...this.records.values()]};if(state.records.length>this.limit*4)throw failure("WALLETCONNECT_REQUEST_LIMIT");await this.storage.setItem(STORE_KEY,state);if(JSON.stringify(await this.storage.getItem(STORE_KEY))!==JSON.stringify(state))throw failure("WALLETCONNECT_REVIEW_WRITE_UNCONFIRMED");});this.writes=work;return work;}
  async markDecided(entry,assertCurrent=()=>{}){this.assertLive(entry);assertCurrent();const record=this.records.get(entry.key);if(!record||record.state!=="undecided"||record.fingerprint!==entry.fingerprint)throw failure("WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE");if(this.storage){const saved=(await this.storage.getItem(STORE_KEY))?.records?.find(item=>item.key===entry.key);if(!saved||saved.state!=="undecided"||saved.fingerprint!==record.fingerprint||saved.expiresAt!==record.expiresAt||saved.account!==record.account||saved.sessionBinding!==record.sessionBinding)throw failure("WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE");}assertCurrent();record.state="decided";await this.persist();assertCurrent();this.assertLive(entry);}
  accept(event, authorized, account) {
    const now = this.now();
    for(const [key,record] of this.records)if(record.expiresAt<=now&&!this.sdkPending?.has(key))this.records.delete(key);
    for (const [key, expiry] of this.completed) if (expiry <= now) this.completed.delete(key);
    if (typeof event?.topic !== "string" || !/^[A-Za-z0-9_-]{3,256}$/u.test(event.topic) || !(Number.isSafeInteger(event.id) && event.id >= 0 || typeof event.id === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(event.id))) throw failure("INVALID_WALLETCONNECT_REQUEST");
    const key = JSON.stringify([event.topic, event.id]);
    const wire = canonical({ topic: event.topic, id: event.id, params: event.params,verifyContext:event.verifyContext });
    if (Buffer.byteLength(wire) > 65536) throw failure("WALLETCONNECT_REQUEST_TOO_LARGE");
    const fingerprint = createHash("sha256").update(wire).digest("hex"), existing = this.items.get(key);
    const original=this.records.get(key),sessionBinding=authorized.sessionBinding??"";
    if (this.completed.has(key)||original?.state==="decided") return { duplicate: true, entry: null };
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.account !== account || existing.origin !== authorized.origin) { this.finish(key); void this.onExpire(existing, "WALLETCONNECT_REQUEST_ID_CONFLICT"); return { duplicate: true, entry: null }; }
      return { duplicate: true, entry: existing };
    }
    const timestamp = event.params?.request?.expiryTimestamp;
    if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp * 1000 <= now)) throw failure("WALLETCONNECT_REQUEST_EXPIRED");
    if (event.restored === true&&(!original||original.fingerprint!==fingerprint||original.account!==account||original.origin!==authorized.origin||original.sessionBinding!==sessionBinding||original.expiresAt<=now))throw failure("WALLETCONNECT_RESTORED_DEADLINE_UNKNOWN");
    if(original&&(original.fingerprint!==fingerprint||original.account!==account||original.origin!==authorized.origin||original.sessionBinding!==sessionBinding||original.expiresAt<=now))throw failure("WALLETCONNECT_REQUEST_ID_CONFLICT");
    const expiresAt = original?.expiresAt??Math.min(now + this.ttlMs, timestamp === undefined ? Infinity : timestamp * 1000);
    // Completed IDs retain their original deadline to reject late duplicates.
    // Bound both sets; new traffic cannot evict a still-live replay tombstone.
    if (this.items.size >= this.limit || this.completed.size >= this.limit * 4 || [...this.items.values()].filter(item => item.origin === authorized.origin).length >= this.perOrigin) throw failure("WALLETCONNECT_REQUEST_LIMIT");
    const entry = { key, fingerprint, account, origin: authorized.origin,sessionBinding, expiresAt, event: freeze(JSON.parse(wire)), requestId: null, stage: "received", timer: null };
    if(!original){if(this.records.size>=this.limit*4)throw failure("WALLETCONNECT_REQUEST_LIMIT");this.records.set(key,{key,fingerprint,account,origin:authorized.origin,sessionBinding,expiresAt,state:"undecided"});}
    entry.timer = this.schedule(() => { if (this.items.get(key) !== entry) return; this.finish(key); void this.onExpire(entry, "WALLETCONNECT_REQUEST_EXPIRED"); }, Math.max(1, expiresAt - now)); entry.timer?.unref?.();
    this.items.set(key, entry); return { duplicate: false, entry };
  }
  pending() { return [...this.items.values()]; }
  get(key) { return this.items.get(key); }
  assertLive(entry) { if (!entry || this.items.get(entry.key) !== entry || this.now() >= entry.expiresAt) throw failure("WALLETCONNECT_REQUEST_EXPIRED"); }
  stage(entry, requestId) { this.assertLive(entry); entry.stage = "review"; entry.requestId = requestId; }
  finish(key) {
    const entry = this.items.get(key); if (!entry) return null;
    const record=this.records.get(key);if(record)record.state="decided";this.unschedule(entry.timer); this.items.delete(key); this.completed.set(key, entry.expiresAt); return entry;
  }
}
