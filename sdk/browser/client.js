import {
  accountIdentity,
  deviceIdentifier,
  deviceIdentity,
  randomIdentifier,
  signOwnershipChallenge,
  signSquareRequest,
  squareDeviceRegistration,
  zeroize,
} from "./index.js";

export class YNXSquareAppClient {
  #accountSecret;
  #deviceSecret;
  #fetch;
  #now;
  #session;

  constructor({baseURL = "https://api.ynxweb4.com", accountSecret, deviceSecret, deviceId, fetchImpl = globalThis.fetch, now = () => new Date()}) {
    this.baseURL = validBaseURL(baseURL);
    this.#accountSecret = copySecret(accountSecret, "account secret");
    this.#deviceSecret = copySecret(deviceSecret, "device secret");
    this.deviceId = validIdentifier(deviceId || deviceIdentifier(this.#deviceSecret), "device id");
    this.identity = accountIdentity(this.#accountSecret);
    this.device = deviceIdentity(this.#deviceSecret);
    if (typeof fetchImpl !== "function") throw new Error("fetch is required");
    if (typeof now !== "function") throw new Error("clock is required");
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  get connected() {
    return Boolean(this.#session && new Date(this.#session.expiresAt).getTime() > this.#now().getTime());
  }

  get sessionStatus() {
    return Object.freeze({
      account: this.identity.account,
      connected: this.connected,
      deviceId: this.deviceId,
      expiresAt: this.#session?.expiresAt || null,
    });
  }

  async connect() {
    const challenge = await this.#request("/app/session/challenges", {
      account: this.identity.account,
      deviceId: this.deviceId,
      deviceSigningPublicKey: this.device.deviceSigningPublicKey,
    });
    if (challenge?.account !== this.identity.account || challenge?.signDocument?.account !== this.identity.account || challenge.signDocument.deviceId !== this.deviceId || challenge.signDocument.deviceSigningPublicKey !== this.device.deviceSigningPublicKey || challenge.signDocument.chainId !== 6423 || typeof challenge.challengeId !== "string") {
      throw new Error("Gateway ownership challenge binding mismatch");
    }
    const proof = signOwnershipChallenge({
      accountSecret: this.#accountSecret,
      deviceSecret: this.#deviceSecret,
      signBytes: challenge.signBytes,
    });
    const session = await this.#request(`/app/session/challenges/${encodeURIComponent(challenge.challengeId)}/verify`, proof);
    if (session?.account !== this.identity.account || session?.deviceId !== this.deviceId || typeof session.token !== "string" || session.token.length < 32 || !validFutureDate(session.expiresAt, this.#now())) {
      throw new Error("Gateway session binding mismatch");
    }
    this.#session = {token: session.token, expiresAt: session.expiresAt};
    try {
      const registration = squareDeviceRegistration({
        account: this.identity.account,
        deviceId: this.deviceId,
        deviceSecret: this.#deviceSecret,
        idempotencyKey: registrationIdempotencyKey(this.identity.account, this.deviceId, this.device.deviceSigningPublicKey),
      });
      await this.#request("/app/square/devices", registration, this.#sessionHeaders());
    } catch (error) {
      this.#session = undefined;
      throw error;
    }
    return this.sessionStatus;
  }

  createPost({content, tags = [], idempotencyKey = randomIdentifier("post")}) {
    if (typeof content !== "string" || content.trim().length === 0 || content.length > 2000) throw new Error("post content must contain 1 to 2000 characters");
    if (!Array.isArray(tags) || tags.length > 8 || tags.some((tag) => typeof tag !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(tag))) throw new Error("post tags are invalid");
    return this.#signedPost("/app/square/posts", "/square/posts", {idempotencyKey: validIdentifier(idempotencyKey, "idempotency key"), content, ...(tags.length ? {tags} : {})});
  }

  createComment(postId, {content, idempotencyKey = randomIdentifier("comment")}) {
    const id = validPathSegment(postId, "post id");
    if (typeof content !== "string" || content.trim().length === 0 || content.length > 1000) throw new Error("comment content must contain 1 to 1000 characters");
    return this.#signedPost(`/app/square/posts/${id}/comments`, `/square/posts/${id}/comments`, {idempotencyKey: validIdentifier(idempotencyKey, "idempotency key"), content});
  }

  setReaction(postId, {kind, active, idempotencyKey = randomIdentifier("reaction")}) {
    const id = validPathSegment(postId, "post id");
    if (!new Set(["like", "insight", "support"]).has(kind) || typeof active !== "boolean") throw new Error("reaction is invalid");
    return this.#signedPost(`/app/square/posts/${id}/reactions`, `/square/posts/${id}/reactions`, {idempotencyKey: validIdentifier(idempotencyKey, "idempotency key"), kind, active});
  }

  setFollow({account, active, idempotencyKey = randomIdentifier("follow")}) {
    if (typeof account !== "string" || !account.startsWith("ynx1") || typeof active !== "boolean") throw new Error("follow request is invalid");
    return this.#signedPost("/app/square/follows", "/square/follows", {idempotencyKey: validIdentifier(idempotencyKey, "idempotency key"), account, active});
  }

  createReport({targetType, targetId, category, detail, evidenceHashes = [], idempotencyKey = randomIdentifier("report")}) {
    if (!new Set(["post", "comment", "account"]).has(targetType) || typeof targetId !== "string" || targetId.length < 3 || typeof category !== "string" || category.length < 3 || typeof detail !== "string" || detail.length < 3) throw new Error("report request is invalid");
    if (!Array.isArray(evidenceHashes) || evidenceHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) throw new Error("report evidence hashes are invalid");
    return this.#signedPost("/app/square/reports", "/square/reports", {idempotencyKey: validIdentifier(idempotencyKey, "idempotency key"), targetType, targetId, category, detail, ...(evidenceHashes.length ? {evidenceHashes} : {})});
  }

  async disconnect({revokeDevice = false} = {}) {
    if (!this.#session) return;
    const session = this.#session;
    try {
      if (revokeDevice) {
        await this.#signedPost(`/app/square/devices/${encodeURIComponent(this.deviceId)}/revoke`, `/square/devices/${encodeURIComponent(this.deviceId)}/revoke`, undefined);
      }
    } finally {
      try {
        await this.#request("/app/session/revoke", undefined, this.#sessionHeaders(session));
      } finally {
        this.#session = undefined;
      }
    }
  }

  lock() {
    zeroize(this.#accountSecret, this.#deviceSecret);
    this.#session = undefined;
  }

  async #signedPost(publicPath, signedPath, value) {
    const session = this.#requireSession();
    const body = value === undefined ? "" : JSON.stringify(value);
    const timestamp = this.#now().toISOString();
    const signature = signSquareRequest({method: "POST", requestUri: signedPath, timestamp, body, deviceSecret: this.#deviceSecret});
    return this.#request(publicPath, body, {
      ...this.#sessionHeaders(session),
      "X-YNX-Timestamp": timestamp,
      "X-YNX-Device-Signature": signature,
    }, true);
  }

  #requireSession() {
    if (!this.connected) {
      this.#session = undefined;
      throw new Error("YNX application session is not connected or has expired");
    }
    return this.#session;
  }

  #sessionHeaders(session = this.#requireSession()) {
    return {
      "X-YNX-App-Session": session.token,
      "X-YNX-Device-ID": this.deviceId,
    };
  }

  async #request(path, value, headers = {}, bodyIsSerialized = false) {
    const body = value === undefined ? undefined : bodyIsSerialized ? value : JSON.stringify(value);
    const response = await this.#fetch(new URL(path, this.baseURL), {
      method: "POST",
      headers: {"Content-Type": "application/json", ...headers},
      body,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`YNX application endpoint returned invalid JSON (${response.status})`);
    }
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `YNX application endpoint failed (${response.status})`);
    return data;
  }
}

function copySecret(value, label) {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return value.slice();
}

function validBaseURL(value) {
  const url = new URL(value);
  const localHTTP = url.protocol === "http:" && new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname);
  if (url.protocol !== "https:" && !localHTTP) throw new Error("YNX application base URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("YNX application base URL is invalid");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  return url;
}

function validIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function validPathSegment(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(value)) throw new Error(`${label} is invalid`);
  return encodeURIComponent(value);
}

function validFutureDate(value, now) {
  const timestamp = typeof value === "string" ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function registrationIdempotencyKey(account, deviceId, publicKey) {
  let hash = 2166136261;
  for (const character of `${account}\n${deviceId}\n${publicKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `register-${hash.toString(16).padStart(8, "0")}-${deviceId.slice(-12)}`;
}
