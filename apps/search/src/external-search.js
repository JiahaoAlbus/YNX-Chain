import { assertPublicOutboundUrl } from "./network.js";

const CONTRACT_VERSION = "1.0.0";
const MAX_QUERY_LENGTH = 256;
const MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512_000;
const DEFAULT_MAX_STALENESS_SECONDS = 900;
const HEALTH_STATES = new Set(["available", "degraded"]);

function boundedInteger(value, { minimum, maximum, fallback }) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function externalError(message, { status = 502, code = "SEARCH_EXTERNAL_PROVIDER_FAILED", retryAfterSeconds = null } = {}) {
  return Object.assign(new Error(message), { status, code, retryAfterSeconds });
}

function parseIso(value, field) {
  if (typeof value !== "string" || !value) throw externalError(`external provider ${field} required`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw externalError(`external provider ${field} invalid`);
  return { value: new Date(timestamp).toISOString(), timestamp };
}

function parseOptionalIso(value, field) {
  if (value == null) return null;
  return parseIso(value, field).value;
}

function boundedText(value, field, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string") throw externalError(`external provider ${field} required`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) throw externalError(`external provider ${field} invalid`);
  return normalized;
}

function parseRateLimit(value, response) {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const header = name => response.headers.get(name);
  const numeric = input => {
    if (input == null || input === "") return null;
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const limit = numeric(body.limit ?? header("x-ratelimit-limit"));
  const remaining = numeric(body.remaining ?? header("x-ratelimit-remaining"));
  const resetAt = parseOptionalIso(body.resetAt ?? header("x-ratelimit-reset-at"), "rateLimit.resetAt");
  if (limit != null && remaining != null && remaining > limit) throw externalError("external provider rate limit invalid");
  return {
    status: limit == null && remaining == null && resetAt == null ? "unknown" : "reported",
    limit,
    remaining,
    resetAt,
  };
}

async function readBoundedJson(response, maximumBytes) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) throw externalError("external provider response must be JSON");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw externalError("external provider response too large");
  if (!response.body) throw externalError("external provider response body missing");

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw externalError("external provider response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks.map(value => Buffer.from(value))).toString("utf8"));
  } catch {
    throw externalError("external provider response JSON invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw externalError("external provider response object required");
  return parsed;
}

async function validateResult(item, { provider, asOf, retention, resolveHost }) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw externalError("external provider result object required");
  const title = boundedText(item.title, "result title", 300);
  let url;
  try {
    url = (await assertPublicOutboundUrl(
      boundedText(item.url, "result URL", 2_048),
      { resolveHost },
    )).toString();
  } catch {
    throw externalError("external provider result URL rejected");
  }
  const snippet = boundedText(item.snippet ?? "", "result snippet", 1_000, { allowEmpty: true });
  const publishedAt = parseOptionalIso(item.publishedAt, "result publishedAt");
  const language = item.language == null ? null : boundedText(item.language, "result language", 35);
  return {
    resultType: "external-result",
    title,
    sourceUrl: url,
    sourceLabel: provider,
    provider,
    snippet,
    language,
    freshness: { publishedAt, asOf },
    retrieval: "external-provider",
    inference: false,
    retention,
  };
}

export class ExternalSearchAdapter {
  constructor({
    provider = null,
    endpoint = null,
    credential = null,
    retentionDays = null,
    retentionPolicyUrl = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxStalenessSeconds = DEFAULT_MAX_STALENESS_SECONDS,
    fetchImpl = fetch,
    resolveHost,
    clock = () => new Date(),
  } = {}) {
    this.provider = typeof provider === "string" && provider.trim() ? provider.trim() : null;
    this.endpoint = typeof endpoint === "string" && endpoint.trim() ? endpoint.trim() : null;
    this.credential = typeof credential === "string" && credential ? credential : null;
    this.retentionDays = retentionDays != null && retentionDays !== "" && Number.isInteger(Number(retentionDays)) && Number(retentionDays) >= 0 ? Number(retentionDays) : null;
    this.retentionPolicyUrl = typeof retentionPolicyUrl === "string" && retentionPolicyUrl.trim() ? retentionPolicyUrl.trim() : null;
    this.timeoutMs = boundedInteger(timeoutMs, { minimum: 50, maximum: 30_000, fallback: DEFAULT_TIMEOUT_MS });
    this.maxResponseBytes = boundedInteger(maxResponseBytes, { minimum: 1_024, maximum: 2_000_000, fallback: DEFAULT_MAX_RESPONSE_BYTES });
    this.maxStalenessSeconds = boundedInteger(maxStalenessSeconds, { minimum: 1, maximum: 86_400, fallback: DEFAULT_MAX_STALENESS_SECONDS });
    this.fetch = fetchImpl;
    this.resolveHost = resolveHost;
    this.clock = clock;
  }

  get configured() {
    return Boolean(this.provider && this.endpoint && this.credential && this.retentionDays != null && this.retentionPolicyUrl);
  }

  status() {
    return {
      schemaVersion: CONTRACT_VERSION,
      status: this.configured ? "configured" : "unavailable",
      provider: this.provider,
      coverage: "external-provider-response-only",
      resultType: "external-result",
      separatedFrom: ["ynx-index-result", "ai-answer"],
      retention: this.retentionDays == null ? null : {
        providerReportedDays: this.retentionDays,
        searchCache: "none",
        policyUrl: this.retentionPolicyUrl,
      },
      health: this.configured ? "not-yet-checked" : "unavailable",
      limits: {
        maximumQueryLength: MAX_QUERY_LENGTH,
        maximumResults: MAX_RESULTS,
        timeoutMs: this.timeoutMs,
        maximumResponseBytes: this.maxResponseBytes,
        maximumStalenessSeconds: this.maxStalenessSeconds,
      },
      credentialExposed: false,
    };
  }

  async search(query, { pageSize = 10, signal } = {}) {
    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    if (!normalizedQuery || normalizedQuery.length > MAX_QUERY_LENGTH) {
      throw externalError("external search query must contain 1 to 256 characters", { status: 400, code: "SEARCH_EXTERNAL_INVALID_QUERY" });
    }
    const limit = boundedInteger(pageSize, { minimum: 1, maximum: MAX_RESULTS, fallback: 10 });
    if (!this.configured) {
      throw externalError("external Search provider unavailable", { status: 503, code: "SEARCH_EXTERNAL_PROVIDER_UNAVAILABLE" });
    }

    let endpoint;
    let retentionPolicyUrl;
    try {
      endpoint = await assertPublicOutboundUrl(this.endpoint, { resolveHost: this.resolveHost });
      retentionPolicyUrl = await assertPublicOutboundUrl(this.retentionPolicyUrl, { resolveHost: this.resolveHost });
    } catch {
      throw externalError("external Search provider configuration rejected", { status: 503, code: "SEARCH_EXTERNAL_PROVIDER_CONFIGURATION" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    let response;
    try {
      response = await this.fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.credential}`,
        },
        body: JSON.stringify({
          schemaVersion: CONTRACT_VERSION,
          query: normalizedQuery,
          limit,
          safeSearch: "strict",
          resultClass: "external-result",
        }),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw externalError("external Search provider timed out", { status: 504, code: "SEARCH_EXTERNAL_PROVIDER_TIMEOUT" });
      throw externalError("external Search provider request failed", { status: 502, code: "SEARCH_EXTERNAL_PROVIDER_FAILED" });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }

    if (response.status === 429) {
      const retryAfter = boundedInteger(response.headers.get("retry-after"), { minimum: 1, maximum: 86_400, fallback: null });
      throw externalError("external Search provider rate limited", { status: 429, code: "SEARCH_EXTERNAL_PROVIDER_RATE_LIMIT", retryAfterSeconds: retryAfter });
    }
    if (!response.ok) {
      throw externalError("external Search provider unavailable", { status: response.status >= 500 ? 503 : 502, code: "SEARCH_EXTERNAL_PROVIDER_FAILED" });
    }

    const value = await readBoundedJson(response, this.maxResponseBytes);
    if (value.schemaVersion !== CONTRACT_VERSION) throw externalError("external provider schema version unsupported");
    if (value.provider !== this.provider) throw externalError("external provider identity mismatch");
    if (!HEALTH_STATES.has(value.health)) throw externalError("external provider health invalid");
    const asOf = parseIso(value.asOf, "asOf");
    const now = this.clock().getTime();
    if (asOf.timestamp > now + 300_000) throw externalError("external provider asOf is in the future");
    if (now - asOf.timestamp > this.maxStalenessSeconds * 1_000) {
      throw externalError("external provider response stale", { status: 502, code: "SEARCH_EXTERNAL_PROVIDER_STALE" });
    }
    if (!Array.isArray(value.results)) throw externalError("external provider results required");
    if (value.results.length > limit) throw externalError("external provider returned too many results");

    const retention = {
      providerReportedDays: this.retentionDays,
      searchCache: "none",
      policyUrl: retentionPolicyUrl.toString(),
    };
    const seen = new Set();
    const results = [];
    for (const item of value.results) {
      const result = await validateResult(item, { provider: this.provider, asOf: asOf.value, retention, resolveHost: this.resolveHost });
      if (seen.has(result.sourceUrl)) continue;
      seen.add(result.sourceUrl);
      results.push({ ...result, rank: results.length + 1 });
    }

    return {
      schemaVersion: CONTRACT_VERSION,
      resultClass: "external-provider",
      provider: this.provider,
      providerBacked: true,
      providerHealth: value.health,
      asOf: asOf.value,
      coverage: "external-provider-response-only",
      query: normalizedQuery,
      total: results.length,
      results,
      rateLimit: parseRateLimit(value.rateLimit, response),
      retention,
      separatedFrom: ["ynx-index-result", "ai-answer"],
      inference: false,
    };
  }
}

export const EXTERNAL_SEARCH_CONTRACT = Object.freeze({
  version: CONTRACT_VERSION,
  maximumQueryLength: MAX_QUERY_LENGTH,
  maximumResults: MAX_RESULTS,
  resultType: "external-result",
  coverage: "external-provider-response-only",
  separatedFrom: ["ynx-index-result", "ai-answer"],
  requiredProviderFields: ["schemaVersion", "provider", "health", "asOf", "results"],
  unavailableWithoutConfiguration: true,
  searchCache: "none",
});
