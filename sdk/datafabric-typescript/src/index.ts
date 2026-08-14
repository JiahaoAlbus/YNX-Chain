import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ENVELOPE_SCHEMA_VERSION = "1.0" as const;
export const ENVELOPE_SCHEMA_VERSION_V2 = "2.0" as const;
export const PRODUCER_EVENTS_PATH = "/v1/producer/events" as const;

export interface Actor {
  actorId: string;
  accountId?: string;
  sessionId?: string;
}

export interface SourceMetadata {
  source: string;
  asOf: string;
  version: string;
  confidence?: number;
  coverage?: number;
  status: "authoritative" | "third-party" | "estimated" | "ai-inferred" | "cached" | "user-input" | "unavailable";
  failure?: string;
}

export interface Integrity {
  algorithm: "hmac-sha256";
  keyId: string;
  digest: string;
  signature: string;
}

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  schemaVersion: "1.0" | "2.0";
  producer?: string;
  product: string;
  service: string;
  aggregateType?: string;
  aggregateId: string;
  actor: Actor;
  actorId?: string;
  accountId?: string;
  productSessionId?: string;
  correlationId: string;
  causationId?: string;
  traceId?: string;
  requestId?: string;
  sequence: number;
  timestamp: string;
  occurredAt?: string;
  effectiveAt: string;
  receivedAt?: string;
  sourceCommit: string;
  sourceRelease: string;
  integrity: Integrity;
  integrityHash?: string;
  signature?: string;
  privacyClassification: "public" | "internal" | "confidential" | "restricted";
  retentionClass: "transient" | "operational" | "financial-7y" | "audit-7y" | "legal-hold";
  residencyClass?: "global" | "regional" | "account-home" | "legal-hold";
  auditId: string;
  chainCommitmentId?: string;
  idempotencyKey?: string;
  partitionKey?: string;
  orderingKey?: string;
  source: SourceMetadata;
  payload: TPayload;
  metadata?: Record<string, string>;
}

export interface ProducerReceipt {
  eventId: string;
  status: "committed-to-outbox" | "already-committed";
  auditId: string;
}

export interface RequestBinding {
  method: string;
  path: string;
  contentSha256: string;
}

export interface CanonicalCredentials {
  appSession: string;
  sessionId: string;
  deviceId: string;
  product: string;
  bundleId: string;
  requestId: string;
  requestNonce: string;
  requestTime: string;
  deviceSignature: string;
}

export interface CredentialProvider {
  credentials(binding: RequestBinding, signal?: AbortSignal): Promise<CanonicalCredentials>;
}

export interface AppendResult {
  eventId: string;
  status: "committed-to-outbox";
  auditId: string;
}

export interface EventPage<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  events: Array<EventEnvelope<TPayload>>;
  nextCursor: string;
  source: "ynx-operational-event-store";
  asOf: string;
  version: string;
  status: "authoritative";
}

export class DataFabricError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly errorId?: string,
  ) {
    super(message);
    this.name = "DataFabricError";
  }
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const chainCommitmentIdentifier = /^[0-9a-f]{32}$/;
const maxResponseBytes = 8 * 1024 * 1024;

export function producerDeliverySignature(
  keyId: string,
  timestamp: string,
  nonce: string,
  body: Uint8Array,
  key: Uint8Array,
): string {
  if (!identifier.test(keyId) || !identifier.test(nonce)) throw new Error("producer key ID and nonce must be canonical identifiers");
  requireCanonicalUTC(timestamp, "producer timestamp");
  if (body.byteLength === 0 || key.byteLength < 32) throw new Error("producer delivery requires body bytes and a 32-byte signing key");
  const digest = createHash("sha256").update(body).digest("hex");
  const material = ["ynx-data-fabric-producer-v1", "POST", PRODUCER_EVENTS_PATH, keyId, timestamp, nonce, digest].join("\0");
  return createHmac("sha256", key).update(material).digest("hex");
}

export function verifyEventIntegrity(event: EventEnvelope, key: Uint8Array): void {
  validateEnvelopeBindings(event);
  if (key.byteLength < 32) throw new Error("event signing key must contain at least 32 bytes");
  const material = eventIntegrityMaterial(event);
  const digest = createHash("sha256").update(material).digest();
  const suppliedDigest = decodeHex32(event.integrity.digest, "event integrity digest");
  if (!timingSafeEqual(digest, suppliedDigest)) throw new Error("event integrity check failed");
  const signature = createHmac("sha256", key).update(suppliedDigest).digest();
  const suppliedSignature = decodeHex32(event.integrity.signature, "event integrity signature");
  if (!timingSafeEqual(signature, suppliedSignature)) throw new Error("event integrity check failed");
}

export class ProducerClient {
  private readonly origin: URL;
  private readonly key: Uint8Array;

  constructor(endpoint: string, private readonly keyId: string, key: Uint8Array, private readonly fetcher: typeof fetch = fetch) {
    this.origin = validateOrigin(endpoint, "Data Fabric producer endpoint");
    if (!identifier.test(keyId)) throw new Error("producer key ID must be a canonical identifier");
    if (key.byteLength < 32) throw new Error("Data Fabric producer signing key must contain at least 32 bytes");
    this.key = new Uint8Array(key);
  }

  async send(event: EventEnvelope, signal?: AbortSignal): Promise<ProducerReceipt> {
    if (event.integrity.keyId !== this.keyId) throw new Error("event integrity key does not match producer client");
    verifyEventIntegrity(event, this.key);
    const body = Buffer.from(goJSON(event));
    const timestamp = new Date().toISOString();
    const nonce = `nonce.producer.${randomBytes(16).toString("hex")}`;
    const signature = producerDeliverySignature(this.keyId, timestamp, nonce, body, this.key);
    const request: RequestInit = {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "X-YNX-Producer-Key-ID": this.keyId,
        "X-YNX-Producer-Timestamp": timestamp,
        "X-YNX-Producer-Nonce": nonce,
        "X-YNX-Producer-Signature": signature,
      },
    };
    if (signal) request.signal = signal;
    const response = await this.fetcher(new URL(PRODUCER_EVENTS_PATH, this.origin), request);
    const payload = await boundedJSON(response, 64 * 1024);
    if (response.status !== 200 && response.status !== 202) throw rejection(response, payload);
    assertExactKeys(payload, ["eventId", "status", "auditId"]);
    if (payload.eventId !== event.eventId || payload.auditId !== event.auditId || (payload.status !== "committed-to-outbox" && payload.status !== "already-committed")) {
      throw new Error("Data Fabric producer receipt contradicts the delivered event");
    }
    return payload as unknown as ProducerReceipt;
  }
}

export class DataFabricClient {
  private readonly origin: URL;

  constructor(endpoint: string, private readonly credentialProvider: CredentialProvider, private readonly fetcher: typeof fetch = fetch) {
    this.origin = validateOrigin(endpoint, "Data Fabric base URL");
    if (!credentialProvider) throw new Error("canonical credential provider is required");
  }

  async appendEvent(event: EventEnvelope, signal?: AbortSignal): Promise<AppendResult> {
    const result = await this.request("POST", "/v1/events", Buffer.from(goJSON(event)), signal);
    assertExactKeys(result, ["eventId", "status", "auditId"]);
    if (result.eventId !== event.eventId || result.auditId !== event.auditId || result.status !== "committed-to-outbox") {
      throw new Error("Data Fabric returned an inconsistent append acknowledgement");
    }
    return result as unknown as AppendResult;
  }

  async events<TPayload extends Record<string, unknown> = Record<string, unknown>>(signal?: AbortSignal): Promise<EventPage<TPayload>> {
    const result = await this.request("GET", "/v1/events", Buffer.alloc(0), signal);
    assertExactKeys(result, ["events", "nextCursor", "source", "asOf", "version", "status"]);
    if (!Array.isArray(result.events) || result.source !== "ynx-operational-event-store" || result.status !== "authoritative" || typeof result.version !== "string" || result.version.length === 0 || typeof result.asOf !== "string") {
      throw new Error("Data Fabric returned incomplete event source metadata");
    }
    requireCanonicalUTC(result.asOf, "event page asOf");
    return result as unknown as EventPage<TPayload>;
  }

  private async request(method: string, path: string, body: Uint8Array, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const binding = { method, path, contentSha256: createHash("sha256").update(body).digest("hex") };
    const credentials = await this.credentialProvider.credentials(binding, signal);
    validateCredentials(credentials);
    const request: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-YNX-App-Session": credentials.appSession,
        "X-YNX-Session-ID": credentials.sessionId,
        "X-YNX-Device-ID": credentials.deviceId,
        "X-YNX-Product": credentials.product,
        "X-YNX-Bundle-ID": credentials.bundleId,
        "X-YNX-Request-ID": credentials.requestId,
        "X-YNX-Request-Nonce": credentials.requestNonce,
        "X-YNX-Timestamp": credentials.requestTime,
        "X-YNX-Device-Signature": credentials.deviceSignature,
        "X-YNX-Content-SHA256": binding.contentSha256,
      },
    };
    if (body.byteLength !== 0) request.body = Buffer.from(body);
    if (signal) request.signal = signal;
    const response = await this.fetcher(new URL(path, this.origin), request);
    const payload = await boundedJSON(response, maxResponseBytes);
    if (!response.ok) throw rejection(response, payload);
    return payload;
  }
}

function eventIntegrityMaterial(event: EventEnvelope): Buffer {
  const integrity = { algorithm: event.integrity.algorithm, keyId: event.integrity.keyId, digest: "", signature: "" };
  const ordered: Record<string, unknown> = {};
  const fields: Array<keyof EventEnvelope> = [
    "eventId", "eventType", "schemaVersion", "producer", "product", "service", "aggregateType", "aggregateId", "actor",
    "actorId", "accountId", "productSessionId", "correlationId", "causationId", "traceId", "requestId", "sequence", "timestamp",
    "occurredAt", "effectiveAt", "receivedAt", "sourceCommit", "sourceRelease", "integrity", "integrityHash", "signature",
    "privacyClassification", "retentionClass", "residencyClass", "auditId", "chainCommitmentId", "idempotencyKey", "partitionKey", "orderingKey", "source", "payload", "metadata",
  ];
  for (const field of fields) {
    let value: unknown = event[field];
    if (field === "integrity") value = integrity;
    if (field === "actor") value = compactObject(["actorId", "accountId", "sessionId"], event.actor as unknown as Record<string, unknown>);
    if (field === "source") value = compactObject(["source", "asOf", "version", "confidence", "coverage", "status", "failure"], event.source as unknown as Record<string, unknown>);
    if (field === "integrityHash" || field === "signature") value = "";
    if (value === undefined || value === "" && optionalOmit(field) || field === "metadata" && isEmptyObject(value)) continue;
    ordered[field] = field === "payload" || field === "metadata" ? sortJSON(value) : value;
  }
  return Buffer.from(goJSON(ordered));
}

function optionalOmit(field: keyof EventEnvelope): boolean {
  return new Set<keyof EventEnvelope>(["producer", "aggregateType", "actorId", "accountId", "productSessionId", "causationId", "traceId", "requestId", "occurredAt", "receivedAt", "integrityHash", "signature", "residencyClass", "chainCommitmentId", "idempotencyKey", "partitionKey", "orderingKey"]).has(field);
}

function validateEnvelopeBindings(event: EventEnvelope): void {
  if (event.schemaVersion !== "1.0" && event.schemaVersion !== "2.0") throw new Error("event schema version is unsupported");
  if (!identifier.test(event.eventId) || !identifier.test(event.auditId) || !identifier.test(event.aggregateId)) throw new Error("event identifiers are invalid");
  if (event.integrity.algorithm !== "hmac-sha256" || !identifier.test(event.integrity.keyId)) throw new Error("event integrity binding is invalid");
  if (event.chainCommitmentId !== undefined && (event.schemaVersion !== "2.0" || !chainCommitmentIdentifier.test(event.chainCommitmentId))) throw new Error("chainCommitmentId must be a canonical Chain Core v1 commitment reference on Envelope v2");
  if (event.schemaVersion === "2.0" && (event.integrityHash !== event.integrity.digest || event.signature !== event.integrity.signature)) throw new Error("v2 integrity aliases do not match");
}

function validateOrigin(raw: string, label: string): URL {
  let value: URL;
  try { value = new URL(raw); } catch { throw new Error(`${label} must be an absolute origin URL`); }
  const loopback = value.hostname === "localhost" || value.hostname === "127.0.0.1" || value.hostname === "[::1]" || value.hostname === "::1";
  if ((value.protocol !== "https:" && !(value.protocol === "http:" && loopback)) || value.username || value.password || value.pathname !== "/" || value.search || value.hash) {
    throw new Error(`${label} must use HTTPS except on loopback and contain no path, credentials, query, or fragment`);
  }
  return value;
}

function validateCredentials(value: CanonicalCredentials): void {
  for (const field of [value.appSession, value.sessionId, value.deviceId, value.product, value.bundleId, value.requestId, value.requestNonce, value.deviceSignature]) {
    if (typeof field !== "string" || field.trim() === "" || field.length > 4096 || /[\r\n\t]/u.test(field)) throw new Error("canonical credentials are incomplete or unsafe");
  }
  requireCanonicalUTC(value.requestTime, "canonical request time");
}

function requireCanonicalUTC(value: string, label: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be RFC3339 UTC`);
}

async function boundedJSON(response: Response, limit: number): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error("Data Fabric response exceeded the SDK limit");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new Error("Data Fabric response is invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Data Fabric response must be a JSON object");
  return value as Record<string, unknown>;
}

function rejection(response: Response, payload: Record<string, unknown>): DataFabricError {
  const code = typeof payload.code === "string" ? payload.code : typeof payload.error === "string" ? payload.error : undefined;
  const errorId = typeof payload.errorId === "string" ? payload.errorId : undefined;
  return new DataFabricError(`Data Fabric rejected the request: status=${response.status} code=${code ?? ""} errorId=${errorId ?? ""}`, response.status, code, errorId);
}

function assertExactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) throw new Error("Data Fabric response contains unknown or missing fields");
}

function decodeHex32(value: string, label: string): Buffer {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return Buffer.from(value, "hex");
}

function sortJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJSON);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([key, item]) => [key, sortJSON(item)]));
  return value;
}

function compactObject(fields: string[], source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined && value !== "") result[field] = value;
  }
  return result;
}

function isEmptyObject(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function goJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, character => `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}
