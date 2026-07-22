const DEFAULT_TIMEOUT_MS = 10_000;
const PHASES = new Set([
  "quote",
  "user_review",
  "source_submitted",
  "source_accepted",
  "source_finalized",
  "proof_attestation",
  "destination_mint_release",
  "destination_confirmed",
  "failed",
  "refund_recovery",
  "dispute",
  "retry",
]);
const RECOVERY_PHASES = new Set(["failed", "refund_recovery", "dispute"]);

export class YNXBridgeSDKError extends Error {
  constructor(message, {cause, status, requestId, errorId} = {}) {
    super(message, {cause});
    this.name = "YNXBridgeSDKError";
    this.status = status;
    this.requestId = requestId;
    this.errorId = errorId;
  }
}

export class YNXBridgeClient {
  #fetch;
  #timeoutMs;

  constructor({baseURL, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch} = {}) {
    this.baseURL = validBaseURL(baseURL).toString();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new YNXBridgeSDKError("timeoutMs must be between 100 and 30000");
    if (typeof fetchImpl !== "function") throw new YNXBridgeSDKError("fetch is required");
    this.#timeoutMs = timeoutMs;
	this.#fetch = fetchImpl.bind(globalThis);
  }

  async getHealth() {
    return validateHealth(await this.#request("health"));
  }

  async getTransparency() {
    return validateTransparency(await this.#request("bridge/transparency"));
  }

  async #request(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(new URL(path, this.baseURL), {
        method: "GET",
        headers: {Accept: "application/json"},
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const requestId = boundedHeader(response, "X-Request-ID");
      const errorId = boundedHeader(response, "X-Error-ID");
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (cause) {
        throw new YNXBridgeSDKError(`Bridge endpoint returned invalid JSON (${response.status})`, {cause, status: response.status, requestId, errorId});
      }
      if (!response.ok) {
        const detail = typeof data?.error === "string" ? data.error : "Bridge endpoint rejected the request";
        throw new YNXBridgeSDKError(`${detail} (${response.status})`, {status: response.status, requestId, errorId});
      }
      return data;
    } catch (cause) {
      if (cause instanceof YNXBridgeSDKError) throw cause;
      if (cause?.name === "AbortError") throw new YNXBridgeSDKError(`Bridge endpoint timed out after ${this.#timeoutMs}ms`, {cause});
      throw new YNXBridgeSDKError("Bridge endpoint request failed", {cause});
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function bridgeTransferAvailability(transfer) {
  if (!transfer || typeof transfer !== "object" || Array.isArray(transfer) || !PHASES.has(transfer.phase)) {
    throw new YNXBridgeSDKError("Bridge transfer phase is invalid");
  }
  if (typeof transfer.updatedAt !== "string" || !validTimestamp(transfer.updatedAt)) {
    throw new YNXBridgeSDKError("Bridge transfer updatedAt is invalid");
  }
  const assetAvailable = transfer.phase === "destination_confirmed";
  return Object.freeze({
    schemaVersion: 1,
    source: "ynx-bridge-lifecycle",
    asOf: transfer.updatedAt,
    coverage: "coordinator-recorded-phase-not-independent-chain-proof",
    phase: transfer.phase,
    assetAvailable,
    mayPay: assetAvailable,
    mayCreditExchange: assetAvailable,
    showRecovery: RECOVERY_PHASES.has(transfer.phase),
  });
}

function validateHealth(value) {
  if (!value || typeof value !== "object" || value.service !== "ynx-bridged" || typeof value.ok !== "boolean" || typeof value.liveBridge !== "boolean" || typeof value.externalSubmissionEnabled !== "boolean") {
    throw new YNXBridgeSDKError("Bridge health contract is invalid");
  }
  if (value.liveBridge && !value.externalSubmissionEnabled) throw new YNXBridgeSDKError("Bridge health claims live status without external submission");
  return Object.freeze(value);
}

function validateTransparency(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.source !== "ynx-bridge-coordinator" || !validTimestamp(value.asOf) || typeof value.coverage !== "string" || value.coverage.length < 3 || typeof value.liveBridge !== "boolean" || typeof value.externalSubmissionEnabled !== "boolean" || !Array.isArray(value.routes)) {
    throw new YNXBridgeSDKError("Bridge transparency contract is invalid");
  }
  if (value.liveBridge && !value.externalSubmissionEnabled) throw new YNXBridgeSDKError("Bridge transparency claims live status without external submission");
  for (const entry of value.routes) {
    if (!entry || typeof entry !== "object" || !entry.route || typeof entry.coordinatorOutstanding !== "string" || !/^(0|[1-9][0-9]*)$/.test(entry.coordinatorOutstanding) || !validRoute(entry.route)) {
      throw new YNXBridgeSDKError("Bridge transparency route is invalid");
    }
  }
  return Object.freeze(value);
}

function validRoute(route) {
  const identities = [route.provider, route.sourceChain, route.destinationChain, route.sourceAsset, route.destinationAsset, route.assetBoundary];
  return identities.every((value) => typeof value === "string" && value.length >= 3) &&
    typeof route.externalSubmission === "boolean" && /^[1-9][0-9]*$/.test(route.maxAmount) && /^[1-9][0-9]*$/.test(route.maxOutstanding);
}

function validBaseURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new YNXBridgeSDKError("Bridge baseURL is invalid", {cause});
  }
  const localHTTP = url.protocol === "http:" && new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname);
  if (url.protocol !== "https:" && !localHTTP) throw new YNXBridgeSDKError("Bridge baseURL must use HTTPS or loopback HTTP");
  if (url.username || url.password || url.search || url.hash) throw new YNXBridgeSDKError("Bridge baseURL must not contain credentials, query, or fragment");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  return url;
}

function boundedHeader(response, name) {
  const value = response.headers?.get?.(name) || undefined;
  return value && value.length <= 128 ? value : undefined;
}

function validTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
