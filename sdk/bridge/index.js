const DEFAULT_TIMEOUT_MS = 10_000;
const STATE_MACHINE_VERSION = "ynx.bridge.lifecycle.v1";
const PHASES = new Set([
  "quote",
  "user_review",
  "source_submitted",
  "source_accepted",
  "source_finalized",
  "proof_attestation_available",
  "proof_verified",
  "destination_mint_release_submitted",
  "destination_mint_release_confirmed",
  "destination_available",
  "failed",
  "retryable",
  "refund_pending",
  "refunded",
  "recovery_required",
  "disputed",
  "corrected",
  "expired",
  "paused",
]);
const RECOVERY_PHASES = new Set(["failed", "retryable", "refund_pending", "recovery_required", "disputed"]);
const ASSET_CLASSES = new Set(["testnet-stablecoin", "wrapped-test-asset", "ynxt-bridge-candidate", "other-testnet-asset-candidate"]);

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

  async getVersion() {
    return validateVersion(await this.#request("version"));
  }

  async getStateMachine() {
    return validateStateMachine(await this.#request("bridge/state-machine"));
  }

  async getTransparency() {
    return validateTransparency(await this.#request("bridge/transparency"));
  }

  async getRoutes() {
    return validateRoutes(await this.#request("bridge/routes"));
  }

  async getProviders() {
    return validateProviders(await this.#request("bridge/providers"));
  }

  async getAssets() {
    return validateAssets(await this.#request("bridge/assets"));
  }

  async getStatus() {
    return validateStatus(await this.#request("bridge/status"));
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
  if (transfer.stateMachineVersion !== undefined && transfer.stateMachineVersion !== STATE_MACHINE_VERSION) {
    throw new YNXBridgeSDKError("Bridge transfer state machine version is unsupported");
  }
  const assetAvailable = transfer.phase === "destination_available" && transfer.destinationAssetAvailable === true;
  return Object.freeze({
    schemaVersion: 2,
    source: "ynx-bridge-lifecycle",
    stateMachineVersion: STATE_MACHINE_VERSION,
    asOf: transfer.updatedAt,
    coverage: "coordinator-recorded-phase-and-explicit-availability-not-independent-chain-proof",
    phase: transfer.phase,
    assetAvailable,
    mayPay: assetAvailable,
    mayCreditExchange: assetAvailable,
    showRecovery: RECOVERY_PHASES.has(transfer.phase),
  });
}

function validateHealth(value) {
  if (!value || typeof value !== "object" || value.service !== "ynx-bridged" || value.schemaVersion !== 7 || value.stateMachineVersion !== STATE_MACHINE_VERSION || !validTimestamp(value.startedAt) || typeof value.ok !== "boolean" || typeof value.degraded !== "boolean" || typeof value.providerStatus !== "string" || !validProviderCounts(value) || typeof value.contractStatus !== "string" || typeof value.reconciliationStatus !== "string" || typeof value.liveBridge !== "boolean" || typeof value.externalSubmissionEnabled !== "boolean") {
    throw new YNXBridgeSDKError("Bridge health contract is invalid");
  }
  if (value.liveBridge && !value.externalSubmissionEnabled) throw new YNXBridgeSDKError("Bridge health claims live status without external submission");
  if (value.liveBridge && (value.providerStatus.startsWith("unavailable") || value.contractStatus.startsWith("unavailable"))) throw new YNXBridgeSDKError("Bridge health claims live status with unavailable dependencies");
  return Object.freeze(value);
}

function validateVersion(value) {
  if (!value || typeof value !== "object" || value.service !== "ynx-bridged" || value.source !== "ynx-bridge-runtime" || value.schemaVersion !== 7 || value.stateMachineVersion !== STATE_MACHINE_VERSION || !validTimestamp(value.startedAt) || !validTimestamp(value.asOf) || typeof value.degraded !== "boolean" || typeof value.paused !== "boolean" || typeof value.providerStatus !== "string" || !validProviderCounts(value) || typeof value.contractStatus !== "string" || typeof value.reconciliationStatus !== "string" || typeof value.liveBridge !== "boolean" || typeof value.externalSubmissionEnabled !== "boolean" || !value.build || typeof value.build !== "object") {
    throw new YNXBridgeSDKError("Bridge version contract is invalid");
  }
  if (value.liveBridge && (!value.externalSubmissionEnabled || value.providerStatus.startsWith("unavailable") || value.contractStatus.startsWith("unavailable"))) throw new YNXBridgeSDKError("Bridge version overclaims live status");
  return Object.freeze(value);
}

function validateStateMachine(value) {
  if (!value || typeof value !== "object" || value.version !== STATE_MACHINE_VERSION || value.source !== "ynx-bridge-runtime" || !validTimestamp(value.asOf) || !Array.isArray(value.states) || value.states.length !== PHASES.size || !Array.isArray(value.transitions) || value.transitions.length === 0 || !value.legacyAliases || typeof value.legacyAliases !== "object") {
    throw new YNXBridgeSDKError("Bridge state machine contract is invalid");
  }
  const seen = new Set();
  for (const state of value.states) {
    if (!state || typeof state !== "object" || !PHASES.has(state.id) || seen.has(state.id) || typeof state.terminal !== "boolean" || typeof state.destinationAssetAvailable !== "boolean" || typeof state.description !== "string" || state.description.length < 3) {
      throw new YNXBridgeSDKError("Bridge state machine state is invalid");
    }
    seen.add(state.id);
    if ((state.id === "destination_available") !== state.destinationAssetAvailable) throw new YNXBridgeSDKError("Bridge state machine availability boundary is invalid");
  }
  for (const transition of value.transitions) {
    if (!transition || !PHASES.has(transition.from) || !PHASES.has(transition.to) || typeof transition.condition !== "string" || transition.condition.length < 3) {
      throw new YNXBridgeSDKError("Bridge state machine transition is invalid");
    }
  }
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

function validateRoutes(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.source !== "ynx-bridge-route-registry" || !validTimestamp(value.asOf) || value.coverage !== "configured-fail-closed-candidates-not-live-provider-quotes" || !Array.isArray(value.routes)) {
    throw new YNXBridgeSDKError("Bridge route catalog contract is invalid");
  }
  for (const route of value.routes) {
    const endpoints = [route?.source, route?.destination];
    const unavailable = ["unavailable", "live-provider-terms-on-authenticated-quote-request"].includes(route?.availability) && route?.executable === false && route?.externalSubmissionEnabled === false && typeof route?.failureStatus === "string" && route.failureStatus.length >= 3;
    const nullEndpointEvidence = endpoints.every((endpoint) => endpoint && validAssetClass(endpoint.assetClass) && endpoint.contract === null && endpoint.symbol === null && endpoint.decimals === null && endpoint.explorerUrl === null && endpoint.contractVerified === false);
    const verifiedEndpointEvidence = endpoints.every((endpoint) => endpoint && validAssetClass(endpoint.assetClass) && endpoint.symbol === "USDC" && endpoint.decimals === 6 && typeof endpoint.contract === "string" && endpoint.contract.length >= 3 && endpoint.contractVerified === true && validEvidenceURL(endpoint.explorerUrl));
    const nullQuoteEvidence = route?.fees?.status === "unavailable-no-executable-route" && [route.fees.currency, route.fees.sourceGas, route.fees.destinationGas, route.fees.providerFee, route.fees.ynxFee, route?.slippage?.maximumBps, route?.timing?.estimatedMinSeconds, route?.timing?.estimatedMaxSeconds, route?.finality?.destinationRule, route?.refund?.sla].every((item) => item === null);
    if (!unavailable || (!nullEndpointEvidence && !verifiedEndpointEvidence) || !nullQuoteEvidence || route.fees.hiddenSpread !== false || route.refund?.available !== false || typeof route.classification !== "string" || !validRoute(route.limits)) {
      throw new YNXBridgeSDKError("Bridge route catalog overclaims route availability");
    }
  }
  return Object.freeze(value);
}

function validateProviders(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.source !== "ynx-bridge-provider-registry" || !validTimestamp(value.asOf) || !["configured-provider-identities-and-routes-only-no-live-provider-session-commercial-rights-or-independent-incident-history", "configured-provider-routes-and-cached-live-api-health-no-executable-route-or-independent-incident-history"].includes(value.coverage) || !Array.isArray(value.providers)) {
    throw new YNXBridgeSDKError("Bridge provider registry contract is invalid");
  }
  for (const provider of value.providers) {
    const identities = [provider?.id, provider?.provider, provider?.product, provider?.classification, provider?.routeId, provider?.sourceChain, provider?.destinationChain];
    const neverExecutable = provider?.productionStatus === "unavailable" && provider?.routeAvailable === false && provider?.executable === false && typeof provider?.failureStatus === "string" && provider.failureStatus.length >= 3;
    const missingContracts = provider?.sourceContract === null && provider?.destinationContract === null;
    const missingVersions = provider?.apiVersion === "not-configured" && provider?.sdkVersion === "not-configured" && provider?.authentication === "not-applicable-route-unavailable" && provider?.rateLimit === "unknown-route-unavailable";
    const commercialUnknown = provider?.fees?.status === "unavailable-no-executable-route" && provider?.fees?.hiddenSpread === false && provider?.slippage?.status === "not-applicable-no-executable-route" && provider?.estimatedTime?.status === "unavailable-no-provider-route" && provider?.refundPolicy?.available === false;
    const governanceUnknown = provider?.jurisdiction === "not-approved" && provider?.license === "not-approved" && provider?.terms === "not-approved" && provider?.dataRetention === "not-reviewed" && provider?.dataRights === "not-reviewed" && provider?.custodyModel === "not-established" && provider?.auditStatus === "not-reviewed";
    const operationsUnknown = Array.isArray(provider?.incidentHistory) && provider.incidentHistory.length === 0 && provider?.incidentHistoryComplete === false && provider?.lastSuccess === null && provider?.lastFailure === null && provider?.fallback === "none";
    const unconfigured = provider?.testnetStatus === "unavailable" && provider?.credentialsConfigured === false && provider?.agreementApproved === false && provider?.contractsConfigured === false && provider?.health === "not-connected" && missingContracts && missingVersions && commercialUnknown && governanceUnknown && operationsUnknown && provider?.finality?.proofVerification === "local-relayer-attestation-only-not-independent-chain-proof";
    const configuredEvidence = typeof provider?.sourceContract === "string" && provider.sourceContract.length >= 3 && typeof provider?.destinationContract === "string" && provider.destinationContract.length >= 3 && provider?.apiVersion === "v2" && provider?.sdkVersion === "direct-official-http-api" && provider?.authentication === "permissionless-public-api-no-key" && provider?.credentialsRequired === false && provider?.credentialsConfigured === true && provider?.fees?.status === "unavailable-no-executable-route" && provider?.fees?.hiddenSpread === false && provider?.slippage?.status === "not-applicable-native-usdc-burn-mint" && provider?.estimatedTime?.status === "configured-reviewed-estimate" && provider?.refundPolicy?.available === false && provider?.finality?.proofVerification === "circle-attestation-provider-not-independent-ynx-light-client" && provider?.incidentHistoryComplete === false && Array.isArray(provider?.incidentHistory) && ["not-connected", "unavailable", "connected-live-fee-api"].includes(provider?.health) && (provider?.lastSuccess === null || validTimestamp(provider.lastSuccess)) && (provider?.lastFailure === null || validTimestamp(provider.lastFailure));
    const approvalsValid = provider?.routeSupportVerified !== true || validEvidenceURL(provider?.routeSupportEvidence);
    const agreementValid = provider?.agreementApproved !== true || (validEvidenceURL(provider?.agreementEvidence) && validEvidenceURL(provider?.terms) && typeof provider?.license === "string" && provider.license.length >= 3);
    const operationsValid = provider?.operationalReviewApproved !== true || (validEvidenceURL(provider?.operationalReviewEvidence) && [provider?.jurisdiction, provider?.dataRetention, provider?.dataRights, provider?.fallback, provider?.outageMode].every((item) => typeof item === "string" && item.length >= 3));
    if (!identities.every((item) => typeof item === "string" && item.length >= 3) || !Array.isArray(provider.supportedAssets) || provider.supportedAssets.length < 2 || !provider.supportedAssets.every((item) => typeof item === "string" && item.includes(":")) || !neverExecutable || (!unconfigured && !configuredEvidence) || !approvalsValid || !agreementValid || !operationsValid || provider.finality?.sourceConfirmations < 1 || typeof provider.recoveryProcess !== "string" || provider.recoveryProcess.length < 3 || !validRoute(provider.limits) || typeof provider.securityModel !== "string" || provider.securityModel.length < 3 || typeof provider.decommissionPlan !== "string" || provider.decommissionPlan.length < 3) {
      throw new YNXBridgeSDKError("Bridge provider registry overclaims provider readiness");
    }
  }
  return Object.freeze(value);
}

function validateAssets(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.source !== "ynx-bridge-asset-registry" || !validTimestamp(value.asOf) || !["configured-token-allowlist-candidates-not-verified-contracts", "configured-token-allowlist-plus-provider-contract-metadata-not-executable-or-independent-reserve-proof"].includes(value.coverage) || !Array.isArray(value.assets)) {
    throw new YNXBridgeSDKError("Bridge asset catalog contract is invalid");
  }
  for (const asset of value.assets) {
    const nullMetadata = [asset?.symbol, asset?.decimals, asset?.contract, asset?.explorerUrl].every((item) => item === null);
    const verifiedMetadata = asset?.symbol === "USDC" && asset?.decimals === 6 && typeof asset?.contract === "string" && asset.contract.length >= 3 && asset?.contractVerified === true && validEvidenceURL(asset?.explorerUrl);
    if (!asset || !validAssetClass(asset.assetClass) || !["canonical", "represented"].includes(asset.canonicality) || (!nullMetadata && !verifiedMetadata) || (nullMetadata && asset.contractVerified !== false) || asset.allowlistedForCoordinatorIntent !== true || asset.availability !== "unavailable" || asset.supplyAuthority !== "not-configured" || asset.externalExecutionEnabled !== false || !Array.isArray(asset.movementModes) || asset.movementModes.length === 0 || !Array.isArray(asset.routeIds) || asset.routeIds.length === 0 || !Array.isArray(asset.risk) || asset.risk.length === 0) {
      throw new YNXBridgeSDKError("Bridge asset catalog overclaims asset availability");
    }
  }
  return Object.freeze(value);
}

function validAssetClass(value) {
  return ASSET_CLASSES.has(value);
}

function validEvidenceURL(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validProviderCounts(value) {
  return Number.isInteger(value?.providerCount) && value.providerCount >= 1 && Number.isInteger(value?.availableProviderCount) && value.availableProviderCount >= 0 && value.availableProviderCount <= value.providerCount;
}

function validateStatus(value) {
  const supportURLs = [value?.support?.supportUrl, value?.support?.privacyUrl, value?.support?.securityUrl, value?.support?.publicStatusUrl];
  const counts = [value?.routeCount, value?.providerCount, value?.availableProviderCount, value?.assetCount, value?.transferCount, value?.openExposureTransferCount, value?.reconciliation?.recordCount];
  const validCounts = counts.every((item) => Number.isInteger(item) && item >= 0);
  const reconciliationStates = new Set(["no-operator-observation", "operator-observed-balanced", "operator-observed-imbalance"]);
  const reconciliationTimeValid = value?.reconciliation?.state === "no-operator-observation" ? value?.reconciliation?.latestRecordedAt === null : validTimestamp(value?.reconciliation?.latestRecordedAt);
  const executionDisabled = value?.externalSubmissionEnabled === false && value?.userAssetMovementEnabled === false && value?.officialStablecoinRouteAvailable === false && value?.deployedPublic === false;
  const providerObservationValid =
    (value?.coverage === "local-coordinator-and-configured-candidates-not-public-provider-health" && value?.failureStatus === "no-verified-provider-contract-or-public-deployment" && value?.externalBridgeState === "unavailable" && value?.providerConnection === "not-connected" && value?.availableProviderCount === 0) ||
    (value?.coverage === "local-coordinator-plus-live-provider-api-observation-not-executable-route-or-public-deployment" && value?.failureStatus === "source-intent-builder-testnet-execution-and-public-deployment-unavailable" && value?.externalBridgeState === "provider-api-connected-route-execution-unavailable" && value?.providerConnection === "connected-live-provider-api-route-execution-disabled" && value?.availableProviderCount > 0);
  const capabilities = value?.capabilities;
  if (!value || value.schemaVersion !== 1 || value.source !== "ynx-bridge-status" || !validTimestamp(value.asOf) || !["available-local-coordinator", "paused-local-coordinator"].includes(value.coordinatorState) || !validCounts || !validProviderCounts(value) || !providerObservationValid || !executionDisabled || !reconciliationStates.has(value.reconciliation?.state) || !reconciliationTimeValid || value.reconciliation?.independentVerification !== false || capabilities?.readOnlyEvidence !== true || capabilities?.quoteExecution !== false || capabilities?.sourceSubmission !== false || capabilities?.destinationMintRelease !== false || capabilities?.refundExecution !== false || capabilities?.disputeRecording !== true || capabilities?.emergencyExitExecution !== false || value.support?.configured !== false || !supportURLs.every((item) => item === null)) {
    throw new YNXBridgeSDKError("Bridge product status overclaims readiness");
  }
  if ((value.coordinatorState === "paused-local-coordinator") !== (value.paused === true)) {
    throw new YNXBridgeSDKError("Bridge product status pause state is inconsistent");
  }
  return Object.freeze(value);
}

function validRoute(route) {
  const identities = [route.provider, route.classification, route.sourceChain, route.destinationChain, route.sourceAsset, route.destinationAsset, route.assetBoundary];
  return identities.every((value) => typeof value === "string" && value.length >= 3) &&
    validAssetClass(route.sourceAssetClass) && validAssetClass(route.destinationAssetClass) &&
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
