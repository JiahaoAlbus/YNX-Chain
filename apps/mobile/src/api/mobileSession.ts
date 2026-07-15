import { accountIdentity, deviceIdentifier, deviceIdentity, signOwnershipChallenge, signSquareRequest, squareDeviceRegistration, zeroize } from "../crypto/ynxSigner";
import { authorizeLocalKeyUse, type LocalKeyAuthorizer } from "../security/localAuthorization";

const CLIENT = "ynx-mobile-v1";
const BINDING = "ynx-mobile://com.ynxweb4.mobile";

type Session = { token: string; expiresAt: string };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class YNXMobileAppClient {
  readonly account: string;
  readonly deviceId: string;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly authorize: LocalKeyAuthorizer;
  private accountSecret: Uint8Array;
  private deviceSecret: Uint8Array;
  private session: Session | null = null;

  constructor(input: { accountSecret: Uint8Array; deviceSecret: Uint8Array; baseURL?: string; fetchImpl?: FetchLike; now?: () => Date; timeoutMs?: number; authorize?: LocalKeyAuthorizer }) {
    if (input.accountSecret.length !== 32 || input.deviceSecret.length !== 32) throw new Error("YNX mobile client requires two 32-byte secrets");
    this.accountSecret = input.accountSecret.slice();
    this.deviceSecret = input.deviceSecret.slice();
    this.account = accountIdentity(this.accountSecret).account;
    this.deviceId = deviceIdentifier(this.deviceSecret);
    this.baseURL = validBaseURL(input.baseURL ?? "https://api.ynxweb4.com");
    this.fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = input.now ?? (() => new Date());
    this.timeoutMs = input.timeoutMs ?? 8000;
    this.authorize = input.authorize ?? authorizeLocalKeyUse;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 10 || this.timeoutMs > 30000) throw new Error("YNX mobile request timeout must be between 10 and 30000 milliseconds");
  }

  get connected(): boolean {
    if (this.session === null) return false;
    if (new Date(this.session.expiresAt).getTime() > this.now().getTime()) return true;
    this.session = null;
    return false;
  }

  async connect(): Promise<void> {
    await this.authorize("ownership-proof");
    const device = deviceIdentity(this.deviceSecret);
    const challenge = await this.request("/app/session/challenges", {
      account: this.account,
      deviceId: this.deviceId,
      deviceSigningPublicKey: device.deviceSigningPublicKey,
    });
    if (!isPlainObject(challenge) || challenge.account !== this.account || typeof challenge.challengeId !== "string" || typeof challenge.signBytes !== "string" || !isPlainObject(challenge.signDocument) || challenge.signDocument.account !== this.account || challenge.signDocument.deviceId !== this.deviceId || challenge.signDocument.deviceSigningPublicKey !== device.deviceSigningPublicKey || challenge.signDocument.origin !== BINDING || challenge.signDocument.chainId !== 6423) {
      throw new Error("Gateway native ownership challenge binding mismatch");
    }
    const proof = signOwnershipChallenge({ accountSecret: this.accountSecret, deviceSecret: this.deviceSecret, signBytes: challenge.signBytes });
    const session = await this.request(`/app/session/challenges/${encodeURIComponent(challenge.challengeId)}/verify`, proof);
    if (!isPlainObject(session) || session.account !== this.account || session.deviceId !== this.deviceId || typeof session.token !== "string" || session.token.length < 32 || typeof session.expiresAt !== "string" || new Date(session.expiresAt).getTime() <= this.now().getTime()) {
      throw new Error("Gateway native session binding mismatch");
    }
    this.session = { token: session.token, expiresAt: session.expiresAt };
    try {
      await this.request("/app/square/devices", squareDeviceRegistration({
        account: this.account,
        deviceId: this.deviceId,
        deviceSecret: this.deviceSecret,
        idempotencyKey: registrationKey(this.account, this.deviceId, device.deviceSigningPublicKey),
      }), this.sessionHeaders());
    } catch (error) {
      this.session = null;
      throw error;
    }
  }

  async createPost(content: string, idempotencyKey: string): Promise<unknown> {
    if (!this.connected) throw new Error("Native YNX session is disconnected or expired");
    if (content.trim().length === 0 || content.length > 2000) throw new Error("Post content must contain 1 to 2000 characters");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(idempotencyKey)) throw new Error("Post idempotency key is invalid");
    await this.authorize("signed-post");
    const body = JSON.stringify({ idempotencyKey, content });
    const timestamp = this.now().toISOString();
    return this.request("/app/square/posts", body, {
      ...this.sessionHeaders(),
      "X-YNX-Timestamp": timestamp,
      "X-YNX-Device-Signature": signSquareRequest({ method: "POST", requestUri: "/square/posts", timestamp, body, deviceSecret: this.deviceSecret }),
    }, true);
  }

  async disconnect(revokeDevice = false): Promise<void> {
    if (!this.session) return;
    try {
      if (revokeDevice && this.connected) {
        await this.authorize("device-revocation");
        const timestamp = this.now().toISOString();
        await this.request(`/app/square/devices/${encodeURIComponent(this.deviceId)}/revoke`, "", {
          ...this.sessionHeaders(),
          "X-YNX-Timestamp": timestamp,
          "X-YNX-Device-Signature": signSquareRequest({ method: "POST", requestUri: `/square/devices/${this.deviceId}/revoke`, timestamp, body: "", deviceSecret: this.deviceSecret }),
        }, true);
      }
    } finally {
      try {
        await this.request("/app/session/revoke", undefined, this.sessionHeaders());
      } finally {
        this.session = null;
      }
    }
  }

  async lockAndRevokeSession(): Promise<void> {
    const headers = this.session ? this.sessionHeaders() : null;
    this.session = null;
    zeroize(this.accountSecret, this.deviceSecret);
    if (headers) await this.request("/app/session/revoke", undefined, headers);
  }

  lock(): void {
    this.session = null;
    zeroize(this.accountSecret, this.deviceSecret);
  }

  private sessionHeaders(): Record<string, string> {
    if (!this.session) throw new Error("Native YNX session is unavailable");
    return { "X-YNX-App-Session": this.session.token, "X-YNX-Device-ID": this.deviceId };
  }

  private async request(path: string, value?: unknown, headers: Record<string, string> = {}, serialized = false): Promise<unknown> {
    const body = value === undefined ? undefined : serialized ? String(value) : JSON.stringify(value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}${path}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-YNX-Client": CLIENT, ...headers },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`YNX application endpoint returned invalid JSON (${response.status})`); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.session = null;
      throw new Error(isPlainObject(data) && typeof data.error === "string" ? data.error : `YNX application endpoint failed (${response.status})`);
    }
    return data;
  }
}

function registrationKey(account: string, deviceId: string, publicKey: string): string {
  let hash = 2166136261;
  for (const character of `${account}\n${deviceId}\n${publicKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `register-${hash.toString(16).padStart(8, "0")}-${deviceId.slice(-12)}`;
}

function validBaseURL(value: string): string {
  const normalized = value.replace(/\/$/, "");
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(normalized) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(normalized)) throw new Error("YNX application URL must be exact HTTPS or loopback HTTP");
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
