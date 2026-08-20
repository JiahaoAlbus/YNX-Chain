import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Store } from 'express-rate-limit';

type Bucket = { totalHits: number; resetTime: Date; lastSeen: number };

/**
 * A process-local Store deliberately bounded by key count. It is appropriate for
 * a single Monitor process, but it does not claim distributed enforcement: a
 * multi-replica deployment must replace it with a shared, capacity-managed store.
 */
export class BoundedRateLimitStore implements Store {
  localKeys = true;
  #entries = new Map<string, Bucket>();
  #windowMs: number;
  #maxKeys: number;

  constructor({ windowMs, maxKeys = 2_048 }: { windowMs: number; maxKeys?: number }) {
    this.#windowMs = windowMs;
    this.#maxKeys = Math.min(16_384, Math.max(256, maxKeys));
  }

  get size() { return this.#entries.size; }

  increment(key: string) {
    const now = Date.now();
    this.#prune(now);
    let bucket = this.#entries.get(key);
    if (!bucket || bucket.resetTime.getTime() <= now) {
      this.#makeRoom();
      bucket = { totalHits: 0, resetTime: new Date(now + this.#windowMs), lastSeen: now };
      this.#entries.set(key, bucket);
    }
    bucket.totalHits += 1;
    bucket.lastSeen = now;
    // Refresh insertion order, making eviction LRU rather than arrival-order.
    this.#entries.delete(key);
    this.#entries.set(key, bucket);
    return { totalHits: bucket.totalHits, resetTime: bucket.resetTime };
  }

  decrement(key: string) {
    const bucket = this.#entries.get(key);
    if (bucket) bucket.totalHits = Math.max(0, bucket.totalHits - 1);
  }

  resetKey(key: string) { this.#entries.delete(key); }
  resetAll() { this.#entries.clear(); }

  #prune(now: number) {
    for (const [key, bucket] of this.#entries) {
      if (bucket.resetTime.getTime() <= now) this.#entries.delete(key);
    }
  }

  #makeRoom() {
    while (this.#entries.size >= this.#maxKeys) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) return;
      this.#entries.delete(oldest);
    }
  }
}

type AdmissionOptions = { trustedProxyAddresses?: readonly string[]; maxKeys?: number };

const normalizedAddress = (value: string | undefined) => {
  const address = value?.replace(/^::ffff:/i, '').trim();
  return address && isIP(address) ? address : undefined;
};

const tokenDigest = (value: string | undefined) => value
  ? createHash('sha256').update(value).digest('base64url')
  : 'no-session';

const forwardedClient = (request: Request, trustedProxyAddresses: ReadonlySet<string>) => {
  const remote = normalizedAddress(request.socket.remoteAddress);
  if (!remote || !trustedProxyAddresses.has(remote)) return remote ?? 'unknown-client';
  // Only an explicitly configured reverse proxy may supply the original client.
  const candidate = request.header('x-forwarded-for')?.split(',', 1)[0]?.trim();
  return normalizedAddress(candidate) ?? remote;
};

const safeIpKey = (request: Request, trustedProxyAddresses: ReadonlySet<string>) => {
  const address = forwardedClient(request, trustedProxyAddresses);
  return isIP(address) ? ipKeyGenerator(address, 56) : 'unknown-client';
};

const concurrencyGate = (limit: number): RequestHandler => {
  let inFlight = 0;
  return (_request, response, next) => {
    if (inFlight >= limit) {
      response.setHeader('Retry-After', '1');
      response.status(429).json({ error: 'concurrency_limited', retryAfterSeconds: 1 });
      return;
    }
    inFlight += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inFlight = Math.max(0, inFlight - 1);
      }
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  };
};

const limiter = ({
  identifier,
  limit,
  windowMs,
  keyGenerator,
  maxKeys,
}: {
  identifier: string;
  limit: number;
  windowMs: number;
  keyGenerator: (request: Request) => string;
  maxKeys?: number;
}): RequestHandler => rateLimit({
  identifier,
  limit,
  windowMs,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: false,
  store: new BoundedRateLimitStore({ windowMs, maxKeys }),
  keyGenerator: (request) => keyGenerator(request),
  handler: (_request, response, _next, options) => {
    const retryAfterSeconds = Math.max(1, Math.ceil(options.windowMs / 1_000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    response.status(options.statusCode).json({ error: 'rate_limited', retryAfterSeconds });
  },
});

export function createAdmissionLayer(options: AdmissionOptions = {}) {
  const trustedProxyAddresses = new Set((options.trustedProxyAddresses ?? [])
    .map(normalizedAddress)
    .filter((value): value is string => Boolean(value)));
  const maxKeys = options.maxKeys;
  const byIp = (request: Request) => `ip:${safeIpKey(request, trustedProxyAddresses)}`;
  const bySession = (request: Request) => `session:${tokenDigest(request.sessionToken)}`;
  const byPrincipal = (request: Request) => `principal:${request.principal?.username ?? 'unauthenticated'}`;

  return {
    public: [
      concurrencyGate(80),
      limiter({ identifier: 'monitor-public-ip', limit: 2_000, windowMs: 60_000, keyGenerator: byIp, maxKeys }),
    ],
    authentication: [
      concurrencyGate(20),
      limiter({ identifier: 'monitor-authentication-ip', limit: 20, windowMs: 60_000, keyGenerator: byIp, maxKeys }),
    ],
    operator: [
      concurrencyGate(40),
      limiter({ identifier: 'monitor-operator-ip', limit: 240, windowMs: 60_000, keyGenerator: byIp, maxKeys }),
      limiter({ identifier: 'monitor-operator-session', limit: 120, windowMs: 60_000, keyGenerator: bySession, maxKeys }),
      limiter({ identifier: 'monitor-operator-principal', limit: 120, windowMs: 60_000, keyGenerator: byPrincipal, maxKeys }),
    ],
    sensitive: [
      concurrencyGate(10),
      limiter({ identifier: 'monitor-sensitive-ip', limit: 30, windowMs: 60_000, keyGenerator: byIp, maxKeys }),
      limiter({ identifier: 'monitor-sensitive-session', limit: 20, windowMs: 60_000, keyGenerator: bySession, maxKeys }),
      limiter({ identifier: 'monitor-sensitive-principal', limit: 20, windowMs: 60_000, keyGenerator: byPrincipal, maxKeys }),
    ],
  };
}
