export class ApprovalReviewQueue {
  #items = [];
  #inFlight = null;
  constructor({ now = () => Date.now(), onChange = () => {} } = {}) {
    this.now = now;
    this.onChange = onChange;
  }
  clear() { this.#items = []; this.#inFlight = null; this.onChange(); }
  get current() { return this.#inFlight ?? this.#items[0] ?? null; }
  get busy() { return this.#inFlight !== null; }
  get count() { return this.#items.length; }
  enqueue(type, review) {
    if (!review || !["authorization", "proposal", "provider"].includes(type) || !["string", "number"].includes(typeof review.id)) return false;
    const key = `${type}:${review.id}`;
    if (this.#items.some(item => item.key === key) || this.#inFlight?.key === key) return true;
    const expiry = Date.parse(review.expiresAt ?? review.request?.expiresAt ?? "");
    const expiresAt = Number.isFinite(expiry) ? expiry : this.now() + 300_000;
    if (expiresAt <= this.now() || this.#items.length >= 64) return false;
    this.#items.push(Object.freeze({ key, type, review, expiresAt }));
    this.onChange();
    return true;
  }
  begin(key) {
    this.sweep();
    if (this.busy || !this.current || this.current.key !== key) return null;
    this.#inFlight = this.current;
    this.onChange();
    return this.#inFlight;
  }
  refreshAuthorization(review) {
    const key = `authorization:${review.id}`;
    const index = this.#items.findIndex(item => item.key === key);
    if (index < 0 || this.#inFlight?.key === key || JSON.stringify(this.#items[index].review.request) !== JSON.stringify(review.request)) return false;
    this.#items[index] = Object.freeze({ ...this.#items[index], review });
    this.onChange();
    return true;
  }
  finish(key, { remove = true } = {}) {
    if (this.#inFlight?.key !== key) return false;
    if (remove) this.#items = this.#items.filter(item => item.key !== key);
    this.#inFlight = null;
    this.sweep();
    this.onChange();
    return true;
  }
  remove(type, id) {
    const key = `${type}:${id}`;
    const before = this.#items.length;
    this.#items = this.#items.filter(item => item.key !== key);
    if (this.#items.length !== before) this.onChange();
  }
  sweep() {
    const before = this.#items.length;
    this.#items = this.#items.filter(item => item.expiresAt > this.now());
    if (this.#items.length !== before) this.onChange();
  }
}
