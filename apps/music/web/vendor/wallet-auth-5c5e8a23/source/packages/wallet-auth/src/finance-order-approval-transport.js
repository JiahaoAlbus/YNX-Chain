import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { productPlatformBinding } from "./product-session-registry.js";
import {
  assertFinanceOrderApprovalActive, financeOrderApprovalDigest,
  parseFinanceOrderApprovalUnsigned, parseSignedFinanceOrderApproval,
  parseSignedFinanceOrderApprovalRevocation, verifySignedFinanceOrderApproval,
  verifySignedFinanceOrderApprovalRevocation, verifySignedFinanceOrderApprovalRevocationAgainstUnsigned,
} from "./finance-order-approval.js";

export const FINANCE_ORDER_APPROVAL_ROUTE = "ynxwallet://finance-order-approval";
const REQUEST_FIELDS = ["kind", "route", "unsigned", "version"];
const RESULT_COMMON = ["callbackStateHash", "kind", "requestId", "status", "version"];
const LIMIT = 32 * 1024;

export function createFinanceOrderApprovalRequest(unsigned, at) {
  const approval = assertFinanceOrderApprovalActive(parseFinanceOrderApprovalUnsigned(unsigned), at);
  return Object.freeze({ kind: "finance_order_approval_request", route: FINANCE_ORDER_APPROVAL_ROUTE, unsigned: approval, version: "1" });
}

export function parseFinanceOrderApprovalRequest(input, at) {
  const fields = record(input, REQUEST_FIELDS, "Finance order approval request");
  if (fields.kind !== "finance_order_approval_request" || fields.route !== FINANCE_ORDER_APPROVAL_ROUTE || fields.version !== "1") fail("INVALID_FINANCE_APPROVAL_ROUTE", "Finance order approval request route or version is invalid");
  const unsigned = assertFinanceOrderApprovalActive(parseFinanceOrderApprovalUnsigned(fields.unsigned), at);
  const request = Object.freeze({ kind: "finance_order_approval_request", route: FINANCE_ORDER_APPROVAL_ROUTE, unsigned, version: "1" });
  bounded(canonicalJSON(request)); return request;
}

export function financeOrderApprovalRequestDigest(input, at) {
  return digestHex("YNX_FINANCE_ORDER_APPROVAL_REQUEST_V1", parseFinanceOrderApprovalRequest(input, at));
}

export function encodeFinanceOrderApprovalWalletURL(input, at) {
  const request = parseFinanceOrderApprovalRequest(input, at), raw = canonicalJSON(request); bounded(raw);
  return `${FINANCE_ORDER_APPROVAL_ROUTE}?request=${encodeBase64url(new TextEncoder().encode(raw))}`;
}

export function parseFinanceOrderApprovalWalletURL(url, at) {
  return parseFinanceOrderApprovalRequest(decodeRoute(url, FINANCE_ORDER_APPROVAL_ROUTE, "request"), at);
}

export function createFinanceOrderApprovalReturnURL(registry, requestInput, decision, at) {
  const request = parseFinanceOrderApprovalRequest(requestInput, at), status = Object.getOwnPropertyDescriptor(decision ?? {}, "status")?.value;
  let candidate, approvalForRevocation = null;
  if (status === "approved") candidate = { approval: decision.approval, callbackStateHash: request.unsigned.callbackStateHash, kind: "finance_order_approval_result", requestId: request.unsigned.requestId, status, version: "1" };
  else if (status === "rejected") candidate = { callbackStateHash: request.unsigned.callbackStateHash, kind: "finance_order_approval_result", reason: decision.reason, requestId: request.unsigned.requestId, status, version: "1" };
  else if (status === "revoked") { approvalForRevocation = decision.approval; candidate = { callbackStateHash: request.unsigned.callbackStateHash, kind: "finance_order_approval_result", requestId: request.unsigned.requestId, revocation: decision.revocation, status, version: "1" }; }
  else fail("INVALID_FINANCE_APPROVAL_RESULT", "Finance order approval decision status is invalid");
  const result = resultFor(request, candidate, at, approvalForRevocation);
  const binding = financeBinding(registry), raw = canonicalJSON(result); bounded(raw);
  return `${binding.callback}?financeOrderApprovalResult=${encodeBase64url(new TextEncoder().encode(raw))}`;
}

export function parseFinanceOrderApprovalReturnURL(registry, url, requestInput, at, approvalForRevocation = null) {
  const request = parseFinanceOrderApprovalRequest(requestInput, at), binding = financeBinding(registry);
  return resultFor(request, decodeRoute(url, binding.callback, "financeOrderApprovalResult"), at, approvalForRevocation);
}

function resultFor(request, input, at, approvalForRevocation = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_FINANCE_APPROVAL_RESULT", "Finance order approval result is invalid");
  const status = Object.getOwnPropertyDescriptor(input, "status")?.value;
  const extra = status === "approved" ? ["approval"] : status === "rejected" ? ["reason"] : status === "revoked" ? ["revocation"] : [];
  const fields = record(input, [...RESULT_COMMON, ...extra], "Finance order approval result");
  if (fields.kind !== "finance_order_approval_result" || fields.version !== "1" || fields.requestId !== request.unsigned.requestId || fields.callbackStateHash !== request.unsigned.callbackStateHash) fail("BINDING_MISMATCH", "Finance order approval result does not match the pending request");
  if (status === "approved") {
    const approval = verifySignedFinanceOrderApproval(fields.approval, request.unsigned, at);
    return Object.freeze({ approval, callbackStateHash: request.unsigned.callbackStateHash, kind: "finance_order_approval_result", requestId: request.unsigned.requestId, status: "approved", version: "1" });
  }
  if (status === "rejected") {
    if (fields.reason !== "USER_REJECTED") fail("INVALID_FINANCE_APPROVAL_RESULT", "Finance order rejection reason is invalid");
    return Object.freeze({ callbackStateHash: request.unsigned.callbackStateHash, kind: "finance_order_approval_result", reason: "USER_REJECTED", requestId: request.unsigned.requestId, status: "rejected", version: "1" });
  }
  if (status === "revoked") {
    const revocation = approvalForRevocation
      ? verifySignedFinanceOrderApprovalRevocation(fields.revocation, approvalForRevocation, request.unsigned, at)
      : verifySignedFinanceOrderApprovalRevocationAgainstUnsigned(fields.revocation, request.unsigned, at);
    return Object.freeze({ callbackStateHash: request.unsigned.callbackStateHash, kind: "finance_order_approval_result", requestId: request.unsigned.requestId, revocation, status: "revoked", version: "1" });
  }
  fail("INVALID_FINANCE_APPROVAL_RESULT", "Finance order approval result status is invalid");
}

function financeBinding(registry) {
  const binding = productPlatformBinding(registry, "finance", "web");
  if (binding.applicationId !== "com.ynxweb4.finance.web" || binding.origin !== "https://finance.ynxweb4.com" || binding.callback !== "https://finance.ynxweb4.com/wallet-auth/callback") fail("BINDING_MISMATCH", "Finance Web callback is not the frozen Product Session binding");
  return binding;
}

function decodeRoute(value, target, key) {
  if (typeof value !== "string" || value.length > LIMIT * 2 || !value.startsWith(`${target}?${key}=`)) fail("INVALID_FINANCE_APPROVAL_ROUTE", "Finance approval route is not registered");
  const encoded = value.slice(target.length + key.length + 2);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail("INVALID_ENCODING", "Finance approval route requires one canonical base64url value");
  const bytes = decodeBase64url(encoded);
  if (bytes.length > LIMIT || encodeBase64url(bytes) !== encoded) fail("INVALID_ENCODING", "Finance approval route encoding is invalid");
  let raw, parsed;
  try { raw = decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, "0")}`).join("")); parsed = JSON.parse(raw); }
  catch { fail("INVALID_ENCODING", "Finance approval route JSON or UTF-8 is invalid"); }
  if (canonicalJSON(parsed) !== raw) fail("INVALID_ENCODING", "Finance approval route JSON must be canonical without duplicate fields");
  return parsed;
}

function record(value, fields, label) {
  exactFields(value, fields, label);
  if (Reflect.ownKeys(value).length !== fields.length) fail("INVALID_SHAPE", `${label} contains hidden fields`);
  const out = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("INVALID_SHAPE", `${label} cannot contain accessors or non-enumerable fields`);
    out[key] = descriptor.value;
  }
  return out;
}
function bounded(raw) { if (!raw.length || raw.length > LIMIT || new TextEncoder().encode(raw).length > LIMIT) fail("INVALID_ENCODING", "Finance approval transport exceeds its byte limit"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
