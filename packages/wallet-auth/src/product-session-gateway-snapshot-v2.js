import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSession, parseProductSessionChallenge, parseProductSessionAuthoritySnapshot } from "./product-session-v2.js";

// The immutable v2 projection remains a validator, never a runtime downgrade.
export const PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION = 2;
const SNAPSHOT_FIELDS = ["schemaVersion", "authority", "consumedProofs", "idempotency", "audit"];
const SNAPSHOT_V1_FIELDS = ["schemaVersion", "authority", "consumedProofs", "audit"];
const IDEMPOTENCY_FIELDS = ["requestId", "path", "bodyDigest", "responseBody", "subject", "expiresAt"];
const IDEMPOTENT_PATHS = new Set(["/v2/product-sessions/challenge", "/v2/product-sessions/complete"]);

export function parseProductSessionGatewaySnapshot(input) {
  exactFields(input, SNAPSHOT_FIELDS, "Product Session Gateway snapshot");
  if (input.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail("INVALID_GATEWAY_STORE", "Product Session Gateway snapshot version is unsupported");
  const authority = parseProductSessionAuthoritySnapshot(input.authority);
  const consumedProofs = stringSet(input.consumedProofs, /^[0-9a-f]{64}$/, "consumedProofs");
  const idempotency = parseIdempotency(input.idempotency);
  if (!Array.isArray(input.audit) || input.audit.length > 20_000) fail("INVALID_GATEWAY_STORE", "Product Session Gateway audit is invalid");
  const audit = input.audit.map((item, index) => { exactFields(item, ["sequence", "requestId", "path", "outcome", "code", "subject", "at"], "Product Session Gateway audit event"); if (item.sequence !== index + 1 || !/^req_[A-Za-z0-9_-]{12,80}$/.test(item.requestId) || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(item.path) || !["ok", "rejected", "idempotent"].includes(item.outcome) || (item.code !== null && (typeof item.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(item.code))) || typeof item.subject !== "string" || item.subject.length > 128 || !isCanonicalIsoDate(item.at)) fail("INVALID_GATEWAY_STORE", "Product Session Gateway audit event is invalid"); return Object.freeze({ ...item }); });
  return Object.freeze({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority, consumedProofs: Object.freeze(consumedProofs), idempotency: Object.freeze(idempotency), audit: Object.freeze(audit) });
}

export function migrateProductSessionGatewaySnapshotV1(input) {
  exactFields(input, SNAPSHOT_V1_FIELDS, "Product Session Gateway snapshot v1");
  if (input.schemaVersion !== 1) fail("INVALID_GATEWAY_STORE", "Product Session Gateway snapshot v1 is unsupported");
  return parseProductSessionGatewaySnapshot({ ...input, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, idempotency: [] });
}

function stringSet(value, regex, label) { if (!Array.isArray(value) || value.length > 20_000 || value.some((item) => typeof item !== "string" || !regex.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) fail("INVALID_GATEWAY_STORE", `${label} must be unique and sorted`); return [...value]; }
function parseIdempotency(value) {
  if (!Array.isArray(value) || value.length > 20_000) fail("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency store is invalid");
  const entries = value.map((item) => {
    exactFields(item, IDEMPOTENCY_FIELDS, "Product Session Gateway idempotency entry");
    if (typeof item.requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(item.requestId) || !IDEMPOTENT_PATHS.has(item.path) || typeof item.bodyDigest !== "string" || !/^[0-9a-f]{64}$/.test(item.bodyDigest) || typeof item.responseBody !== "string" || item.responseBody.length > 32_768 || typeof item.subject !== "string" || item.subject.length > 128 || !isCanonicalIsoDate(item.expiresAt)) fail("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency entry is invalid");
    let payload; try { payload = JSON.parse(item.responseBody); } catch { fail("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency response is invalid"); }
    exactFields(payload, ["ok", "requestId", "result", "schemaVersion"], "Product Session Gateway idempotency response");
    if (canonicalJSON(payload) !== item.responseBody || payload.ok !== true || payload.requestId !== item.requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency response is not canonical");
    const result = item.path.endsWith("/challenge") ? parseProductSessionChallenge(payload.result) : parseProductSession(payload.result);
    const subject = result.sessionBinding ?? result.challenge;
    if (subject !== item.subject || result.expiresAt !== item.expiresAt) fail("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency subject or expiry is inconsistent");
    return Object.freeze({ ...item });
  });
  if (new Set(entries.map((item) => item.requestId)).size !== entries.length || [...entries].sort((left, right) => left.requestId.localeCompare(right.requestId)).map((item) => item.requestId).join("\n") !== entries.map((item) => item.requestId).join("\n")) fail("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency request IDs must be unique and sorted");
  return entries;
}
function isCanonicalIsoDate(value) { if (typeof value !== "string") return false; const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
