#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { canonicalJSON } from "../src/canonical.js";

export const PRODUCT_SESSION_V2_PUBLIC_PROBE_PATH = "/v2/product-sessions/challenge";
export const PRODUCT_SESSION_V2_PUBLIC_PROBE_MAX_RESPONSE_BYTES = 65_536;

export function verifyProductSessionV2PublicMountResponse(input) {
  const { body, cacheControl, contentType, requestId, status } = input ?? {};
  if (status !== 400) fail("UNEXPECTED_HTTP_STATUS", `Product Session v2 mount probe expected HTTP 400, received ${String(status)}`);
  if (typeof contentType !== "string" || !/^application\/json(?:; charset=utf-8)?$/.test(contentType.toLowerCase())) fail("UNEXPECTED_CONTENT_TYPE", "Product Session v2 mount probe requires canonical JSON content type");
  if (typeof cacheControl !== "string" || !cacheControl.toLowerCase().split(",").map((item) => item.trim()).includes("no-store")) fail("CACHE_POLICY_MISSING", "Product Session v2 mount probe requires Cache-Control: no-store");
  if (typeof requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId)) fail("INVALID_REQUEST_ID", "Product Session v2 mount probe request ID is invalid");
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > PRODUCT_SESSION_V2_PUBLIC_PROBE_MAX_RESPONSE_BYTES) fail("INVALID_RESPONSE_BODY", "Product Session v2 mount probe response body is invalid or oversized");
  let payload;
  try { payload = JSON.parse(body); } catch { fail("INVALID_RESPONSE_JSON", "Product Session v2 mount probe response is not JSON"); }
  if (canonicalJSON(payload) !== body) fail("NON_CANONICAL_RESPONSE", "Product Session v2 mount probe response is not canonical JSON");
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).sort().join("\n") !== ["error", "ok", "requestId", "schemaVersion"].join("\n")) fail("INVALID_RESPONSE_SCHEMA", "Product Session v2 mount probe response fields do not match schema v2");
  if (payload.ok !== false || payload.schemaVersion !== 2 || payload.requestId !== requestId) fail("INVALID_RESPONSE_BINDING", "Product Session v2 mount probe response is not bound to schema v2 and the exact request ID");
  if (!payload.error || typeof payload.error !== "object" || Array.isArray(payload.error) || Object.keys(payload.error).sort().join("\n") !== ["code", "message"].join("\n") || typeof payload.error.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code) || payload.error.code === "INTERNAL" || typeof payload.error.message !== "string" || payload.error.message.length < 1 || payload.error.message.length > 300) fail("INVALID_FAIL_CLOSED_ERROR", "Product Session v2 mount probe did not return a bounded fail-closed protocol error");
  return Object.freeze({
    mounted: true,
    path: PRODUCT_SESSION_V2_PUBLIC_PROBE_PATH,
    requestId,
    responseErrorCode: payload.error.code,
    responseSchemaVersion: payload.schemaVersion,
    stateCreated: false,
    status,
  });
}

export async function probeProductSessionV2PublicMount(options = {}) {
  const endpoint = publicOrigin(options.endpoint ?? process.env.YNX_PRODUCT_SESSION_V2_PUBLIC_URL ?? "https://wallet-auth.ynxweb4.com", options.allowLoopback ?? process.env.YNX_PRODUCT_SESSION_V2_ALLOW_LOOPBACK === "1");
  const requestId = options.requestId ?? `req_public_v2_${randomBytes(18).toString("base64url")}`;
  const timeoutMs = timeout(options.timeoutMs ?? process.env.YNX_PRODUCT_SESSION_V2_PUBLIC_TIMEOUT_MS ?? 20_000);
  const attempts = attemptCount(options.attempts ?? process.env.YNX_PRODUCT_SESSION_V2_PUBLIC_ATTEMPTS ?? 3);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") fail("FETCH_UNAVAILABLE", "Product Session v2 public mount probe requires fetch");
  let lastNetworkError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(new URL(PRODUCT_SESSION_V2_PUBLIC_PROBE_PATH, endpoint), {
        body: "{}",
        headers: { "content-type": "application/json", "x-request-id": requestId },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
      const body = await boundedResponseBody(response, PRODUCT_SESSION_V2_PUBLIC_PROBE_MAX_RESPONSE_BYTES);
      return Object.freeze({ ...verifyProductSessionV2PublicMountResponse({
        body,
        cacheControl: response.headers.get("cache-control"),
        contentType: response.headers.get("content-type"),
        requestId,
        status: response.status,
      }), attemptsUsed: attempt });
    } catch (error) {
      if (typeof error?.code === "string") throw error;
      lastNetworkError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastNetworkError?.name === "AbortError") fail("PROBE_TIMEOUT", `Product Session v2 public mount probe timed out after ${attempts} bounded attempts`);
  fail("NETWORK_FAILURE", `Product Session v2 public mount probe failed before a protocol response after ${attempts} bounded attempts`);
}

async function boundedResponseBody(response, limit) {
  if (!response?.body || typeof response.body.getReader !== "function") fail("INVALID_HTTP_RESPONSE", "Product Session v2 public mount probe received an invalid HTTP response");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > limit)) fail("RESPONSE_TOO_LARGE", "Product Session v2 public mount probe response exceeds its byte limit");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        fail("RESPONSE_TOO_LARGE", "Product Session v2 public mount probe response exceeds its byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

function publicOrigin(value, allowLoopback) {
  let parsed;
  try { parsed = new URL(value); } catch { fail("INVALID_PUBLIC_ORIGIN", "Product Session v2 public mount probe URL is invalid"); }
  const loopback = allowLoopback && parsed.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) fail("INVALID_PUBLIC_ORIGIN", "Product Session v2 public mount probe requires a canonical HTTPS origin or explicitly allowed loopback");
  return parsed;
}

function timeout(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 60_000) fail("INVALID_TIMEOUT", "Product Session v2 public mount probe timeout must be 1000-60000 milliseconds");
  return parsed;
}

function attemptCount(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3) fail("INVALID_ATTEMPTS", "Product Session v2 public mount probe attempts must be 1-3");
  return parsed;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  if (process.env.YNX_PRODUCT_SESSION_V2_PUBLIC_PROBE !== "1") {
    process.stderr.write("Set YNX_PRODUCT_SESSION_V2_PUBLIC_PROBE=1 to run the state-free public mount probe.\n");
    process.exitCode = 2;
  } else {
    probeProductSessionV2PublicMount().then(
      (result) => process.stdout.write(`${canonicalJSON({ ok: true, result })}\n`),
      (error) => {
        process.stderr.write(`${canonicalJSON({ error: { code: typeof error?.code === "string" ? error.code : "PROBE_FAILED", message: typeof error?.message === "string" ? error.message : "Product Session v2 public mount probe failed" }, ok: false })}\n`);
        process.exitCode = 1;
      },
    );
  }
}
