const DEFAULT_WINDOW_MS = 60_000;

export class GatewayAdmissionController {
  #clients = new Map();
  #inFlight = 0;
  #maxConcurrent;
  #maxPerWindow;
  #now;
  #windowMs;

  constructor({ maxConcurrent = 64, maxPerWindow = 300, windowMs = DEFAULT_WINDOW_MS, now = Date.now } = {}) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 1024) throw new TypeError("maxConcurrent is outside policy");
    if (!Number.isInteger(maxPerWindow) || maxPerWindow < 1 || maxPerWindow > 100_000) throw new TypeError("maxPerWindow is outside policy");
    if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) throw new TypeError("windowMs is outside policy");
    this.#maxConcurrent = maxConcurrent;
    this.#maxPerWindow = maxPerWindow;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  enter(client) {
    const key = normalizedClient(client);
    const now = this.#now();
    this.#prune(now);
    if (this.#inFlight >= this.#maxConcurrent) return { ok: false, code: "CONCURRENCY_LIMIT", status: 503 };
    const previous = this.#clients.get(key);
    const entry = !previous || now - previous.windowStartedAt >= this.#windowMs
      ? { count: 0, windowStartedAt: now }
      : previous;
    if (entry.count >= this.#maxPerWindow) return { ok: false, code: "RATE_LIMIT", status: 429 };
    entry.count += 1;
    this.#clients.set(key, entry);
    this.#inFlight += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.#inFlight -= 1;
      },
    };
  }

  #prune(now) {
    if (this.#clients.size < 2_048) return;
    for (const [key, entry] of this.#clients) {
      if (now - entry.windowStartedAt >= this.#windowMs) this.#clients.delete(key);
    }
  }
}

export function forwardedClient(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return normalizedClient(forwarded.split(",", 1)[0]);
  return normalizedClient(request.socket?.remoteAddress);
}

function normalizedClient(value) {
  const text = String(value ?? "unknown").trim();
  if (text.length < 1 || text.length > 128 || /[\r\n\0]/.test(text)) return "unknown";
  return text;
}
