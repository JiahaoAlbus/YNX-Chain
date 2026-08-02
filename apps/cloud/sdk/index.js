const RETRYABLE = new Set([429, 503]);
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE"]);
const CLIENT_ENCRYPTION_ALGORITHM = "AES-256-GCM";
const CLIENT_ENVELOPE_MEDIA_TYPE = "application/vnd.ynx.cloud-encrypted+json";
const CLIENT_ENVELOPE_DOMAIN = "ynx-cloud-client-envelope-v1";
const CLIENT_RECOVERY_MEDIA_TYPE = "application/vnd.ynx.cloud-key-recovery+json";
const CLIENT_RECOVERY_DOMAIN = "ynx-cloud-key-recovery-v1";

export class YNXCloudError extends Error {
  constructor(message, { status = 0, requestId = "", errorId = "", retryAfter = 0, cause } = {}) {
    super(message, { cause });
    this.name = "YNXCloudError";
    this.status = status;
    this.requestId = requestId;
    this.errorId = errorId;
    this.retryAfter = retryAfter;
  }
}

function endpointURL(endpoint, path) {
  const base = endpoint.replace(/\/+$/, "");
  const prefix = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
  return `${prefix}${path.startsWith("/") ? path : `/${path}`}`;
}

function safeSegment(value) {
  if (!value || typeof value !== "string") throw new TypeError("a non-empty identifier is required");
  return encodeURIComponent(value);
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function cryptoProvider() {
  const provider = globalThis.crypto;
  if (!provider?.subtle || typeof provider.getRandomValues !== "function") {
    throw new YNXCloudError("Web Crypto AES-GCM support is unavailable");
  }
  return provider;
}

function bytes(value, field) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new TypeError(`${field} must be a string, ArrayBuffer, or typed array`);
}

function base64urlEncode(value) {
  const input = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < input.length; offset += 0x8000) {
    binary += String.fromCharCode(...input.subarray(offset, offset + 0x8000));
  }
  if (typeof globalThis.btoa === "function") return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  throw new YNXCloudError("Base64 encoding support is unavailable");
}

function base64urlDecode(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(`${field} must be unpadded base64url`);
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  throw new YNXCloudError("Base64 decoding support is unavailable");
}

function encryptionContext(context) {
  if (!context || typeof context !== "object") throw new TypeError("encryption context is required");
  if (context.product !== "cloud" && context.product !== "docs") throw new TypeError("encryption context product must be cloud or docs");
  const account = typeof context.account === "string" ? context.account.trim() : "";
  const contextId = typeof context.contextId === "string" ? context.contextId.trim() : "";
  const version = context.version === undefined ? 1 : Number(context.version);
  if (!account || account.length > 256) throw new TypeError("encryption context account is required");
  if (!contextId || contextId.length > 256) throw new TypeError("encryption context contextId is required");
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("encryption context version must be a positive integer");
  return { product: context.product, account, contextId, version };
}

function contextAAD(context) {
  return new TextEncoder().encode(`${CLIENT_ENVELOPE_DOMAIN}\n${JSON.stringify(context)}`);
}

function recoveryField(value, field, maximum = 128) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximum || !/^[A-Za-z0-9._:@/-]+$/.test(normalized)) {
    throw new TypeError(`${field} must contain 1 to ${maximum} safe characters`);
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new TypeError(`${field} must be a positive integer`);
  return normalized;
}

function recoveryAAD(context, generation, recoveryPolicyId) {
  return new TextEncoder().encode(`${CLIENT_RECOVERY_DOMAIN}\n${JSON.stringify({ context, generation, recoveryPolicyId })}`);
}

async function sha256(provider, value) {
  return new Uint8Array(await provider.subtle.digest("SHA-256", value));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function parseClientEnvelope(content) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(content, "encrypted content")));
  } catch (cause) {
    throw new YNXCloudError("Encrypted content is not a valid YNX client envelope", { cause });
  }
  if (parsed?.schemaVersion !== 1 || parsed?.algorithm !== CLIENT_ENCRYPTION_ALGORITHM || parsed?.mediaType !== CLIENT_ENVELOPE_MEDIA_TYPE) {
    throw new YNXCloudError("Encrypted content uses an unsupported envelope version or algorithm");
  }
  return parsed;
}

function parseRecoveryPackage(content) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(content, "recovery package")));
  } catch (cause) {
    throw new YNXCloudError("Recovery package is not valid YNX recovery JSON", { cause });
  }
  if (parsed?.schemaVersion !== 1 || parsed?.algorithm !== CLIENT_ENCRYPTION_ALGORITHM || parsed?.mediaType !== CLIENT_RECOVERY_MEDIA_TYPE) {
    throw new YNXCloudError("Recovery package uses an unsupported version or algorithm");
  }
  return parsed;
}

export async function generateClientSideEncryptionKey() {
  const provider = cryptoProvider();
  return base64urlEncode(provider.getRandomValues(new Uint8Array(32)));
}

export async function generateClientSideRecoveryKey() {
  return generateClientSideEncryptionKey();
}

export async function encryptClientSideContent({ content, key, context, recoveryPolicy, keyHint = "" } = {}) {
  const provider = cryptoProvider();
  const rawKey = base64urlDecode(key, "key");
  if (rawKey.length !== 32) throw new TypeError("key must contain exactly 32 bytes");
  const normalizedContext = encryptionContext(context);
  const policy = typeof recoveryPolicy === "string" ? recoveryPolicy.trim() : "";
  const hint = typeof keyHint === "string" ? keyHint.trim() : "";
  if (!policy || policy.length > 512) throw new TypeError("recoveryPolicy is required and must be at most 512 characters");
  if (hint.length > 128) throw new TypeError("keyHint must be at most 128 characters");
  const iv = provider.getRandomValues(new Uint8Array(12));
  const plaintext = bytes(content, "content");
  const imported = await provider.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await provider.subtle.encrypt({ name: "AES-GCM", iv, additionalData: contextAAD(normalizedContext), tagLength: 128 }, imported, plaintext));
  const envelope = {
    schemaVersion: 1,
    mediaType: CLIENT_ENVELOPE_MEDIA_TYPE,
    algorithm: CLIENT_ENCRYPTION_ALGORITHM,
    context: normalizedContext,
    nonce: base64urlEncode(iv),
    ciphertext: base64urlEncode(ciphertext),
    ciphertextSha256: base64urlEncode(await sha256(provider, ciphertext)),
    plaintextBytes: plaintext.length,
  };
  return {
    content: new TextEncoder().encode(JSON.stringify(envelope)),
    contentType: CLIENT_ENVELOPE_MEDIA_TYPE,
    encryption: { clientSide: true, algorithm: CLIENT_ENCRYPTION_ALGORITHM, keyHint: hint, recoveryPolicy: policy },
    envelope,
  };
}

export async function decryptClientSideContent({ content, key, expectedContext } = {}) {
  const provider = cryptoProvider();
  const rawKey = base64urlDecode(key, "key");
  if (rawKey.length !== 32) throw new TypeError("key must contain exactly 32 bytes");
  const envelope = parseClientEnvelope(content);
  const normalizedExpected = encryptionContext(expectedContext);
  const normalizedEnvelope = encryptionContext(envelope.context);
  if (JSON.stringify(normalizedEnvelope) !== JSON.stringify(normalizedExpected)) {
    throw new YNXCloudError("Encrypted content context does not match the requested account, product, object, or version");
  }
  const iv = base64urlDecode(envelope.nonce, "envelope nonce");
  if (iv.length !== 12) throw new YNXCloudError("Encrypted content nonce length is invalid");
  const ciphertext = base64urlDecode(envelope.ciphertext, "envelope ciphertext");
  const expectedHash = base64urlDecode(envelope.ciphertextSha256, "envelope ciphertext hash");
  const actualHash = await sha256(provider, ciphertext);
  if (!equalBytes(expectedHash, actualHash)) throw new YNXCloudError("Encrypted content failed its ciphertext integrity check");
  const imported = await provider.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  let plaintext;
  try {
    plaintext = new Uint8Array(await provider.subtle.decrypt({ name: "AES-GCM", iv, additionalData: contextAAD(normalizedEnvelope), tagLength: 128 }, imported, ciphertext));
  } catch (cause) {
    throw new YNXCloudError("Encrypted content could not be authenticated or decrypted", { cause });
  }
  if (!Number.isSafeInteger(envelope.plaintextBytes) || envelope.plaintextBytes < 0 || plaintext.length !== envelope.plaintextBytes) {
    throw new YNXCloudError("Encrypted content plaintext length evidence is invalid");
  }
  return plaintext;
}

export async function createClientSideRecoveryPackage({ key, recoveryKey, context, generation = 1, recoveryPolicyId, keyHint = "" } = {}) {
  const provider = cryptoProvider();
  const dataKey = base64urlDecode(key, "key");
  let wrappingKey;
  try {
    wrappingKey = base64urlDecode(recoveryKey, "recoveryKey");
    if (dataKey.length !== 32 || wrappingKey.length !== 32) throw new TypeError("key and recoveryKey must each contain exactly 32 bytes");
    if (equalBytes(dataKey, wrappingKey)) throw new TypeError("recoveryKey must be independent from the content encryption key");
    const normalizedContext = encryptionContext(context);
    const normalizedGeneration = positiveInteger(generation, "generation");
    const normalizedPolicyId = recoveryField(recoveryPolicyId, "recoveryPolicyId");
    const normalizedHint = keyHint === "" ? "" : recoveryField(keyHint, "keyHint");
    const iv = provider.getRandomValues(new Uint8Array(12));
    const imported = await provider.subtle.importKey("raw", wrappingKey, { name: "AES-GCM" }, false, ["encrypt"]);
    const wrappedKey = new Uint8Array(await provider.subtle.encrypt({
      name: "AES-GCM",
      iv,
      additionalData: recoveryAAD(normalizedContext, normalizedGeneration, normalizedPolicyId),
      tagLength: 128,
    }, imported, dataKey));
    const recoveryPackage = {
      schemaVersion: 1,
      mediaType: CLIENT_RECOVERY_MEDIA_TYPE,
      algorithm: CLIENT_ENCRYPTION_ALGORITHM,
      context: normalizedContext,
      generation: normalizedGeneration,
      recoveryPolicyId: normalizedPolicyId,
      keyHint: normalizedHint,
      keyFingerprint: base64urlEncode(await sha256(provider, dataKey)),
      nonce: base64urlEncode(iv),
      wrappedKey: base64urlEncode(wrappedKey),
      wrappedKeySha256: base64urlEncode(await sha256(provider, wrappedKey)),
    };
    return {
      content: new TextEncoder().encode(JSON.stringify(recoveryPackage)),
      contentType: CLIENT_RECOVERY_MEDIA_TYPE,
      recoveryPackage,
    };
  } finally {
    dataKey.fill(0);
    wrappingKey?.fill(0);
  }
}

export async function recoverClientSideEncryptionKey({ recoveryPackage, recoveryKey, expectedContext, expectedRecoveryPolicyId, minimumGeneration = 1 } = {}) {
  const provider = cryptoProvider();
  const parsed = parseRecoveryPackage(recoveryPackage);
  const normalizedExpected = encryptionContext(expectedContext);
  const normalizedPackageContext = encryptionContext(parsed.context);
  if (JSON.stringify(normalizedExpected) !== JSON.stringify(normalizedPackageContext)) {
    throw new YNXCloudError("Recovery package context does not match the requested account, product, object, or version");
  }
  const expectedPolicyId = recoveryField(expectedRecoveryPolicyId, "expectedRecoveryPolicyId");
  const packagePolicyId = recoveryField(parsed.recoveryPolicyId, "recovery package policy ID");
  if (packagePolicyId !== expectedPolicyId) throw new YNXCloudError("Recovery package policy does not match the expected policy");
  const generation = positiveInteger(parsed.generation, "recovery package generation");
  const minimum = positiveInteger(minimumGeneration, "minimumGeneration");
  if (generation < minimum) throw new YNXCloudError("Recovery package generation is stale");
  const wrappingKey = base64urlDecode(recoveryKey, "recoveryKey");
  let dataKey;
  try {
    if (wrappingKey.length !== 32) throw new TypeError("recoveryKey must contain exactly 32 bytes");
    const iv = base64urlDecode(parsed.nonce, "recovery package nonce");
    if (iv.length !== 12) throw new YNXCloudError("Recovery package nonce length is invalid");
    const wrappedKey = base64urlDecode(parsed.wrappedKey, "recovery package wrapped key");
    if (wrappedKey.length !== 48) throw new YNXCloudError("Recovery package wrapped-key length is invalid");
    const expectedWrappedHash = base64urlDecode(parsed.wrappedKeySha256, "recovery package wrapped-key hash");
    if (expectedWrappedHash.length !== 32 || !equalBytes(expectedWrappedHash, await sha256(provider, wrappedKey))) throw new YNXCloudError("Recovery package failed its wrapped-key integrity check");
    const expectedFingerprint = base64urlDecode(parsed.keyFingerprint, "recovery package key fingerprint");
    if (expectedFingerprint.length !== 32) throw new YNXCloudError("Recovery package key fingerprint length is invalid");
    const normalizedHint = parsed.keyHint === "" ? "" : recoveryField(parsed.keyHint, "recovery package key hint");
    const imported = await provider.subtle.importKey("raw", wrappingKey, { name: "AES-GCM" }, false, ["decrypt"]);
    dataKey = new Uint8Array(await provider.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: recoveryAAD(normalizedPackageContext, generation, packagePolicyId),
      tagLength: 128,
    }, imported, wrappedKey));
    if (dataKey.length !== 32) throw new YNXCloudError("Recovered key length is invalid");
    if (!equalBytes(expectedFingerprint, await sha256(provider, dataKey))) throw new YNXCloudError("Recovery package key fingerprint does not match");
    return { key: base64urlEncode(dataKey), generation, recoveryPolicyId: packagePolicyId, keyHint: normalizedHint, context: normalizedPackageContext };
  } catch (cause) {
    if (cause instanceof YNXCloudError || cause instanceof TypeError) throw cause;
    throw new YNXCloudError("Recovery package could not be authenticated or unwrapped", { cause });
  } finally {
    wrappingKey.fill(0);
    dataKey?.fill(0);
  }
}

export async function rotateClientSideEncryptedContent({ content, currentKey, nextKey, expectedContext, nextVersion, recoveryPolicy, keyHint = "" } = {}) {
  const provider = cryptoProvider();
  const currentContext = encryptionContext(expectedContext);
  const version = positiveInteger(nextVersion, "nextVersion");
  if (version <= currentContext.version) throw new TypeError("nextVersion must be greater than the current context version");
  const currentRaw = base64urlDecode(currentKey, "currentKey");
  let nextRaw;
  try {
    nextRaw = base64urlDecode(nextKey, "nextKey");
    if (currentRaw.length !== 32 || nextRaw.length !== 32) throw new TypeError("currentKey and nextKey must each contain exactly 32 bytes");
    if (equalBytes(currentRaw, nextRaw)) throw new TypeError("nextKey must differ from currentKey");
    const previousKeyFingerprint = base64urlEncode(await sha256(provider, currentRaw));
    const nextKeyFingerprint = base64urlEncode(await sha256(provider, nextRaw));
    const plaintext = await decryptClientSideContent({ content, key: currentKey, expectedContext: currentContext });
    try {
      const nextContext = { ...currentContext, version };
      const encrypted = await encryptClientSideContent({ content: plaintext, key: nextKey, context: nextContext, recoveryPolicy, keyHint });
      return { ...encrypted, previousContext: currentContext, nextContext, previousKeyFingerprint, nextKeyFingerprint };
    } finally {
      plaintext.fill(0);
    }
  } finally {
    currentRaw.fill(0);
    nextRaw?.fill(0);
  }
}

export class YNXCloudClient {
  constructor({ endpoint, product, getAccessToken, fetch: fetchImpl = globalThis.fetch, maxRetries = 2 }) {
    if (!/^https?:\/\//.test(endpoint || "")) throw new TypeError("endpoint must be an absolute HTTP(S) URL");
    if (product !== "cloud" && product !== "docs") throw new TypeError("product must be cloud or docs");
    if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken must be a function");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
    this.endpoint = endpoint;
    this.product = product;
    this.getAccessToken = getAccessToken;
    this.fetch = fetchImpl;
    this.maxRetries = Math.max(0, Math.min(5, Number(maxRetries) || 0));
  }

  async request(path, { method = "GET", body, headers = {}, signal, response = "json", retry } = {}) {
    method = method.toUpperCase();
    const attempts = retry ?? (IDEMPOTENT.has(method) ? this.maxRetries + 1 : 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const token = await this.getAccessToken();
      if (!token || typeof token !== "string") throw new YNXCloudError("Wallet product session is unavailable");
      const requestHeaders = new Headers(headers);
      requestHeaders.set("Authorization", `Bearer ${token}`);
      requestHeaders.set("Accept", response === "json" ? "application/json" : "application/octet-stream");
      let payload = body;
      if (body !== undefined && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && typeof body !== "string" && !(body instanceof Blob)) {
        requestHeaders.set("Content-Type", "application/json");
        payload = JSON.stringify(body);
      }
      let result;
      try {
        result = await this.fetch(endpointURL(this.endpoint, path), { method, headers: requestHeaders, body: payload, signal });
      } catch (cause) {
        throw new YNXCloudError("YNX Cloud request failed before a response was received", { cause });
      }
      const requestId = result.headers.get("x-request-id") || "";
      const errorId = result.headers.get("x-error-id") || "";
      const retryAfter = parseRetryAfter(result.headers.get("retry-after"));
      if (!result.ok) {
        let message = `YNX Cloud returned HTTP ${result.status}`;
        try {
          const error = await result.json();
          if (typeof error?.error === "string" && error.error) message = error.error;
        } catch {}
        if (RETRYABLE.has(result.status) && attempt + 1 < attempts) {
          await delay(Math.min(5000, retryAfter || 100 * 2 ** attempt));
          continue;
        }
        throw new YNXCloudError(message, { status: result.status, requestId, errorId, retryAfter });
      }
      if (response === "response") return result;
      if (response === "bytes") return new Uint8Array(await result.arrayBuffer());
      if (response === "text") return result.text();
      if (result.status === 204) return null;
      return result.json();
    }
    throw new YNXCloudError("YNX Cloud retry budget was exhausted");
  }

  list(options = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== "") query.set(key, String(value));
    return this.request(`/objects?${query}`);
  }
  getObject(id) { return this.request(`/objects/${safeSegment(id)}`); }
  createObject(input) { return this.request("/objects", { method: "POST", body: input }); }
  deleteObject(id) { return this.request(`/objects/${safeSegment(id)}`, { method: "DELETE", body: { confirm: "DELETE" }, retry: 1 }); }
  content(id, { range, signal } = {}) { return this.request(`/objects/${safeSegment(id)}/content`, { headers: range ? { Range: range } : {}, response: "response", signal }); }
  versions(id) { return this.request(`/objects/${safeSegment(id)}/versions`); }
  restoreVersion(id, version) { return this.request(`/objects/${safeSegment(id)}/versions/${safeSegment(String(version))}/restore`, { method: "POST" }); }
  saveDocument(id, input) { return this.request(`/objects/${safeSegment(id)}/document`, { method: "PUT", body: input, retry: 1 }); }
  star(id, starred) { return this.request(`/objects/${safeSegment(id)}/star`, { method: "POST", body: { starred } }); }
  trash(id) { return this.request(`/objects/${safeSegment(id)}/trash`, { method: "POST" }); }
  restore(id) { return this.request(`/objects/${safeSegment(id)}/restore`, { method: "POST" }); }
  quota() { return this.request("/quota"); }
  usage() { return this.request("/usage"); }
  audit() { return this.request("/audit"); }
  exportData() { return this.request("/export", { response: "response" }); }
  eraseProductData() { return this.request("/account-data", { method: "DELETE", body: { confirm: `DELETE ${this.product.toUpperCase()} DATA` }, retry: 1 }); }
  erasureReceipts() { return this.request("/account-data/erasures"); }
  deletionRecords() { return this.request("/deletions"); }
  retryDeletion(id) { return this.request(`/deletions/${safeSegment(id)}/retry`, { method: "POST" }); }

  initiateMultipart(input) { return this.request("/multipart", { method: "POST", body: input }); }
  multipartStatus(id) { return this.request(`/multipart/${safeSegment(id)}`); }
  putMultipartPart(id, part, bytes, sha256) {
    return this.request(`/multipart/${safeSegment(id)}/parts/${safeSegment(String(part))}`, { method: "PUT", body: bytes, headers: { "Content-Type": "application/octet-stream", "X-Content-SHA256": sha256 } });
  }
  completeMultipart(id, parts) { return this.request(`/multipart/${safeSegment(id)}/complete`, { method: "POST", body: { parts } }); }
  cancelMultipart(id) { return this.request(`/multipart/${safeSegment(id)}`, { method: "DELETE", retry: 1 }); }

  initiateDirectUpload(input) { return this.request("/direct-uploads", { method: "POST", body: input }); }
  directUploadStatus(id) { return this.request(`/direct-uploads/${safeSegment(id)}`); }
  completeDirectUpload(id) { return this.request(`/direct-uploads/${safeSegment(id)}/complete`, { method: "POST" }); }
  cancelDirectUpload(id) { return this.request(`/direct-uploads/${safeSegment(id)}`, { method: "DELETE", retry: 1 }); }

  createAIJob(input) { return this.request("/ai/jobs", { method: "POST", body: input }); }
  getAIJob(id) { return this.request(`/ai/jobs/${safeSegment(id)}`); }
  cancelAIJob(id) { return this.request(`/ai/jobs/${safeSegment(id)}/cancel`, { method: "POST" }); }
  reviewAIJob(id, decision) { return this.request(`/ai/jobs/${safeSegment(id)}/review`, { method: "POST", body: { decision } }); }
}
