export const SCHEMA_VERSION = "ynx.oracle.v1" as const;
export const DERIVATIVES_POLICY_VERSION = "index-funding-mark-v1" as const;
export const DEX_TWAP_POLICY_VERSION = "dex-twap-v1" as const;
export const STABLECOIN_RESERVE_POLICY_VERSION = "stablecoin-reserve-v1" as const;
export const RESERVE_ATTESTATION_VERSION = "reserve-attestation-ed25519-v1" as const;

const PPM_MAX = 1_000_000;
const HEX_32 = /^[a-f0-9]{64}$/;
const HEX_64 = /^[a-f0-9]{128}$/;
const MARKET = /^[A-Z0-9][A-Z0-9._/-]{2,63}$/;
const POSITIVE_DECIMAL = /^0*[1-9][0-9]*$/;
const FUTURE_SKEW_MS = 2_000;

const PRICE_TYPES = [
  "spot_price",
  "index_price",
  "mark_price",
  "funding_reference",
  "premium_reference",
  "basis_reference",
  "fx",
  "stablecoin_price",
  "stablecoin_reserve_ratio",
  "stablecoin_depeg",
  "dex_twap",
  "interest_rate_candidate",
] as const;

const QUALITY_STATUSES = [
  "good",
  "degraded",
  "divergent",
  "partial",
  "corrected",
  "limited_sources",
  "circuit_breaker",
  "last_good_stale",
  "emergency_pause",
  "paused",
  "unavailable",
] as const;

export type PriceType = (typeof PRICE_TYPES)[number];
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export interface Quality {
  status: QualityStatus;
  stale: boolean;
  sourceCount: number;
  requiredSourceCount: number;
  rejectedSources: string[];
  sourceLimitation?: string;
  divergencePpm: number;
  confidencePpm: number;
  coveragePpm: number;
  circuitBreaker: boolean;
  failure?: string;
}

export interface PriceDerivation {
  method: string;
  policyVersion: string;
  componentTypes: string[];
  componentLineageHashes: string[];
  fundingWindowSeconds?: number;
  premiumPpm?: number;
  basisPpm?: number;
  rawAdjustmentPpm?: number;
  appliedAdjustmentPpm?: number;
  clampPpm?: number;
  clamped: boolean;
  observationWindowSeconds?: number;
  startBlock?: number;
  endBlock?: number;
  confirmationDepth?: number;
  chainId?: string;
  pool?: string;
  observationCount?: number;
  reporterCount?: number;
  rejectedBlockNumbers?: number[];
  minimumReserve0?: string;
  minimumReserve1?: string;
  attestationVersion?: string;
  evidenceId?: string;
  issuerId?: string;
  attestorId?: string;
  assuranceStandard?: string;
  jurisdiction?: string;
  unit?: string;
  reserveAssets?: string;
  outstandingClaims?: string;
  reportingPeriodEnd?: string;
  publishedAt?: string;
  expiresAt?: string;
  documentHash?: string;
  conclusion?: "unmodified" | "qualified" | "adverse" | "disclaimer";
  attestationSignatureHex?: string;
}

export interface Price {
  schema: typeof SCHEMA_VERSION;
  market: string;
  type: PriceType;
  value: number;
  scale: number;
  source: string;
  version: string;
  asOf: string;
  producedAt: string;
  quality: Quality;
  observationIds: string[];
  observationHashes: string[];
  lineageHash: string;
  derivation?: PriceDerivation;
}

export interface ValidationPolicy {
  requestedMarket: string;
  requestedType: PriceType;
  expectedVersion: string;
  now?: Date | string | number;
  maximumAgeMs: number;
  minimumConfidencePpm: number;
  minimumCoveragePpm: number;
}

export interface OracleClientOptions {
  timeoutMs?: number;
  maximumResponseBytes?: number;
  fetch?: typeof fetch;
}

export interface PriceRequestOptions {
  signal?: AbortSignal;
}

export class OracleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleValidationError";
  }
}

function fail(message: string): never {
  throw new OracleValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${name} must be an object`);
  return value;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], name: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${name} contains unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${name} is missing ${key}`);
  }
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, name);
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function integer(value: unknown, name: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${name} must be a safe integer`);
  if (minimum !== undefined && value < minimum) fail(`${name} is below minimum`);
  if (maximum !== undefined && value > maximum) fail(`${name} exceeds maximum`);
  return value;
}

function optionalInteger(value: unknown, name: string, minimum?: number, maximum?: number): number | undefined {
  if (value === undefined) return undefined;
  return integer(value, name, minimum, maximum);
}

function stringArray(value: unknown, name: string, minimumItems = 0): string[] {
  if (!Array.isArray(value) || value.length < minimumItems) fail(`${name} must contain at least ${minimumItems} item(s)`);
  return value.map((item, index) => stringValue(item, `${name}[${index}]`));
}

function integerArray(value: unknown, name: string): number[] {
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  const parsed = value.map((item, index) => integer(item, `${name}[${index}]`, 1));
  if (new Set(parsed).size !== parsed.length) fail(`${name} must contain unique values`);
  return parsed;
}

function dateTime(value: unknown, name: string): string {
  const parsed = stringValue(value, name);
  const milliseconds = Date.parse(parsed);
  if (!Number.isFinite(milliseconds)) fail(`${name} must be an RFC 3339 date-time`);
  return parsed;
}

function optionalDateTime(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return dateTime(value, name);
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, name: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) fail(`${name} is unsupported`);
  return value as T[number];
}

function parseQuality(input: unknown): Quality {
  const value = record(input, "quality");
  exactKeys(
    value,
    ["status", "stale", "sourceCount", "requiredSourceCount", "rejectedSources", "divergencePpm", "confidencePpm", "coveragePpm", "circuitBreaker"],
    ["sourceLimitation", "failure"],
    "quality",
  );
  return {
    status: enumValue(value.status, QUALITY_STATUSES, "quality.status"),
    stale: booleanValue(value.stale, "quality.stale"),
    sourceCount: integer(value.sourceCount, "quality.sourceCount", 0),
    requiredSourceCount: integer(value.requiredSourceCount, "quality.requiredSourceCount", 0),
    rejectedSources: stringArray(value.rejectedSources, "quality.rejectedSources"),
    sourceLimitation: optionalString(value.sourceLimitation, "quality.sourceLimitation"),
    divergencePpm: integer(value.divergencePpm, "quality.divergencePpm", 0),
    confidencePpm: integer(value.confidencePpm, "quality.confidencePpm", 0, PPM_MAX),
    coveragePpm: integer(value.coveragePpm, "quality.coveragePpm", 0, PPM_MAX),
    circuitBreaker: booleanValue(value.circuitBreaker, "quality.circuitBreaker"),
    failure: optionalString(value.failure, "quality.failure"),
  };
}

const DERIVATION_REQUIRED = ["method", "policyVersion", "componentTypes", "componentLineageHashes", "clamped"] as const;
const DERIVATION_OPTIONAL = [
  "fundingWindowSeconds", "premiumPpm", "basisPpm", "rawAdjustmentPpm", "appliedAdjustmentPpm", "clampPpm",
  "observationWindowSeconds", "startBlock", "endBlock", "confirmationDepth", "chainId", "pool", "observationCount",
  "reporterCount", "rejectedBlockNumbers", "minimumReserve0", "minimumReserve1", "attestationVersion", "evidenceId",
  "issuerId", "attestorId", "assuranceStandard", "jurisdiction", "unit", "reserveAssets", "outstandingClaims",
  "reportingPeriodEnd", "publishedAt", "expiresAt", "documentHash", "conclusion", "attestationSignatureHex",
] as const;

function parseDerivation(input: unknown): PriceDerivation {
  const value = record(input, "derivation");
  exactKeys(value, DERIVATION_REQUIRED, DERIVATION_OPTIONAL, "derivation");
  const componentLineageHashes = stringArray(value.componentLineageHashes, "derivation.componentLineageHashes", 1);
  for (const hash of componentLineageHashes) {
    if (!HEX_32.test(hash)) fail("derivation component lineage hash is invalid");
  }
  const conclusion = value.conclusion === undefined
    ? undefined
    : enumValue(value.conclusion, ["unmodified", "qualified", "adverse", "disclaimer"] as const, "derivation.conclusion");
  return {
    method: stringValue(value.method, "derivation.method"),
    policyVersion: stringValue(value.policyVersion, "derivation.policyVersion"),
    componentTypes: stringArray(value.componentTypes, "derivation.componentTypes", 1),
    componentLineageHashes,
    fundingWindowSeconds: optionalInteger(value.fundingWindowSeconds, "derivation.fundingWindowSeconds", 1),
    premiumPpm: optionalInteger(value.premiumPpm, "derivation.premiumPpm"),
    basisPpm: optionalInteger(value.basisPpm, "derivation.basisPpm"),
    rawAdjustmentPpm: optionalInteger(value.rawAdjustmentPpm, "derivation.rawAdjustmentPpm"),
    appliedAdjustmentPpm: optionalInteger(value.appliedAdjustmentPpm, "derivation.appliedAdjustmentPpm"),
    clampPpm: optionalInteger(value.clampPpm, "derivation.clampPpm", 1, PPM_MAX),
    clamped: booleanValue(value.clamped, "derivation.clamped"),
    observationWindowSeconds: optionalInteger(value.observationWindowSeconds, "derivation.observationWindowSeconds", 1),
    startBlock: optionalInteger(value.startBlock, "derivation.startBlock", 1),
    endBlock: optionalInteger(value.endBlock, "derivation.endBlock", 1),
    confirmationDepth: optionalInteger(value.confirmationDepth, "derivation.confirmationDepth", 1),
    chainId: optionalString(value.chainId, "derivation.chainId"),
    pool: optionalString(value.pool, "derivation.pool"),
    observationCount: optionalInteger(value.observationCount, "derivation.observationCount", 1),
    reporterCount: optionalInteger(value.reporterCount, "derivation.reporterCount", 1),
    rejectedBlockNumbers: value.rejectedBlockNumbers === undefined ? undefined : integerArray(value.rejectedBlockNumbers, "derivation.rejectedBlockNumbers"),
    minimumReserve0: optionalString(value.minimumReserve0, "derivation.minimumReserve0"),
    minimumReserve1: optionalString(value.minimumReserve1, "derivation.minimumReserve1"),
    attestationVersion: optionalString(value.attestationVersion, "derivation.attestationVersion"),
    evidenceId: optionalString(value.evidenceId, "derivation.evidenceId"),
    issuerId: optionalString(value.issuerId, "derivation.issuerId"),
    attestorId: optionalString(value.attestorId, "derivation.attestorId"),
    assuranceStandard: optionalString(value.assuranceStandard, "derivation.assuranceStandard"),
    jurisdiction: optionalString(value.jurisdiction, "derivation.jurisdiction"),
    unit: optionalString(value.unit, "derivation.unit"),
    reserveAssets: optionalString(value.reserveAssets, "derivation.reserveAssets"),
    outstandingClaims: optionalString(value.outstandingClaims, "derivation.outstandingClaims"),
    reportingPeriodEnd: optionalDateTime(value.reportingPeriodEnd, "derivation.reportingPeriodEnd"),
    publishedAt: optionalDateTime(value.publishedAt, "derivation.publishedAt"),
    expiresAt: optionalDateTime(value.expiresAt, "derivation.expiresAt"),
    documentHash: optionalString(value.documentHash, "derivation.documentHash"),
    conclusion,
    attestationSignatureHex: optionalString(value.attestationSignatureHex, "derivation.attestationSignatureHex"),
  };
}

export function parsePrice(input: unknown): Price {
  const value = record(input, "price");
  exactKeys(
    value,
    ["schema", "market", "type", "value", "scale", "source", "version", "asOf", "producedAt", "quality", "observationIds", "observationHashes", "lineageHash"],
    ["derivation"],
    "price",
  );
  if (value.schema !== SCHEMA_VERSION) fail("oracle schema is unsupported");
  const market = stringValue(value.market, "price.market");
  if (!MARKET.test(market)) fail("oracle market is invalid");
  const type = enumValue(value.type, PRICE_TYPES, "price.type");
  const observationHashes = stringArray(value.observationHashes, "price.observationHashes", 1);
  for (const hash of observationHashes) {
    if (!HEX_32.test(hash)) fail("oracle observation hash is invalid");
  }
  const lineageHash = stringValue(value.lineageHash, "price.lineageHash");
  if (!HEX_32.test(lineageHash)) fail("oracle lineage is invalid");
  const result: Price = {
    schema: SCHEMA_VERSION,
    market,
    type,
    value: integer(value.value, "price.value"),
    scale: integer(value.scale, "price.scale", 1),
    source: stringValue(value.source, "price.source"),
    version: stringValue(value.version, "price.version"),
    asOf: dateTime(value.asOf, "price.asOf"),
    producedAt: dateTime(value.producedAt, "price.producedAt"),
    quality: parseQuality(value.quality),
    observationIds: stringArray(value.observationIds, "price.observationIds", 1),
    observationHashes,
    lineageHash,
    derivation: value.derivation === undefined ? undefined : parseDerivation(value.derivation),
  };
  if (result.observationIds.length !== result.observationHashes.length) fail("oracle observation lineage lengths differ");
  validatePriceValue(result);
  validateDerivation(result);
  return result;
}

function validatePriceValue(price: Price): void {
  if (["funding_reference", "premium_reference", "basis_reference", "interest_rate_candidate"].includes(price.type)) return;
  if (price.type === "stablecoin_depeg") {
    if (price.value !== 0 && price.value !== 1) fail("stablecoin depeg value must be binary");
    return;
  }
  if (price.type === "stablecoin_reserve_ratio") {
    if (price.value < 0) fail("stablecoin reserve ratio cannot be negative");
    return;
  }
  if (price.value <= 0) fail("oracle price must be positive");
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) fail(`${name} is required`);
  return value;
}

function validateAdjustment(derivation: PriceDerivation, price?: Price): void {
  const window = requireDefined(derivation.fundingWindowSeconds, "fundingWindowSeconds");
  const raw = requireDefined(derivation.rawAdjustmentPpm, "rawAdjustmentPpm");
  const applied = requireDefined(derivation.appliedAdjustmentPpm, "appliedAdjustmentPpm");
  const clamp = requireDefined(derivation.clampPpm, "clampPpm");
  if (window <= 0 || clamp <= 0 || clamp > PPM_MAX || raw !== applied || applied > clamp || applied < -clamp) {
    fail("derived adjustment is unsafe");
  }
  if (price?.type === "funding_reference" && (price.scale !== PPM_MAX || price.value !== applied)) {
    fail("funding reference does not match its derivation");
  }
}

function validateDerivation(price: Price): void {
  const derived = ["index_price", "funding_reference", "mark_price", "dex_twap", "stablecoin_reserve_ratio"].includes(price.type);
  if (!derived) {
    if (price.derivation !== undefined) fail("direct oracle value contains unexpected derivation metadata");
    return;
  }
  const value = price.derivation;
  if (!value || value.policyVersion !== price.version || value.componentTypes.length === 0 || value.componentLineageHashes.length === 0 || value.clamped) {
    fail("derived oracle value is missing a safe versioned derivation");
  }
  switch (price.type) {
    case "index_price":
      if (value.policyVersion !== DERIVATIVES_POLICY_VERSION || value.method !== "liquidity_weighted_median_spot_index" ||
          !sameStrings(value.componentTypes, ["spot_price"]) || value.componentLineageHashes.length !== 1) {
        fail("index price derivation is invalid");
      }
      break;
    case "funding_reference":
      if (value.policyVersion !== DERIVATIVES_POLICY_VERSION || value.method !== "premium_plus_basis_with_governance_clamp" ||
          !sameStrings(value.componentTypes, ["premium_reference", "basis_reference"]) || value.componentLineageHashes.length !== 2) {
        fail("funding reference derivation is invalid");
      }
      validateAdjustment(value, price);
      break;
    case "mark_price":
      if (value.policyVersion !== DERIVATIVES_POLICY_VERSION || value.method !== "index_times_one_plus_funding_reference" ||
          !sameStrings(value.componentTypes, ["index_price", "funding_reference"]) || value.componentLineageHashes.length !== 2) {
        fail("mark price derivation is invalid");
      }
      validateAdjustment(value);
      break;
    case "dex_twap": {
      const start = requireDefined(value.startBlock, "startBlock");
      const end = requireDefined(value.endBlock, "endBlock");
      const rejected = value.rejectedBlockNumbers ?? [];
      if (value.policyVersion !== DEX_TWAP_POLICY_VERSION || value.method !== "confirmed_multi_block_guarded_twap" ||
          !sameStrings(value.componentTypes, ["dex_pool_state"]) || requireDefined(value.observationWindowSeconds, "observationWindowSeconds") <= 0 ||
          start <= 0 || end < start || requireDefined(value.confirmationDepth, "confirmationDepth") <= 0 || !value.chainId || !value.pool ||
          requireDefined(value.observationCount, "observationCount") < 5 || requireDefined(value.reporterCount, "reporterCount") < 3 ||
          !value.minimumReserve0 || !POSITIVE_DECIMAL.test(value.minimumReserve0) || !value.minimumReserve1 || !POSITIVE_DECIMAL.test(value.minimumReserve1) ||
          value.componentLineageHashes.length !== price.observationHashes.length || !sameStrings(value.componentLineageHashes, price.observationHashes)) {
        fail("DEX TWAP derivation is invalid");
      }
      for (let index = 0; index < rejected.length; index += 1) {
        const block = rejected[index];
        const previous = index > 0 ? rejected[index - 1] : undefined;
        if (block === undefined || block < start || block > end || (previous !== undefined && previous >= block)) {
          fail("DEX TWAP rejected block metadata is invalid");
        }
      }
      break;
    }
    case "stablecoin_reserve_ratio": {
      const assets = value.reserveAssets;
      const claims = value.outstandingClaims;
      const reportingPeriodEnd = value.reportingPeriodEnd;
      const publishedAt = value.publishedAt;
      const expiresAt = value.expiresAt;
      if (value.policyVersion !== STABLECOIN_RESERVE_POLICY_VERSION || value.method !== "reserve_assets_divided_by_outstanding_claims" ||
          !sameStrings(value.componentTypes, ["stablecoin_reserve_evidence"]) || value.componentLineageHashes.length !== 1 ||
          value.componentLineageHashes[0] !== price.observationHashes[0] || value.attestationVersion !== RESERVE_ATTESTATION_VERSION ||
          !value.evidenceId || !value.issuerId || !value.attestorId || value.issuerId === value.attestorId || !value.assuranceStandard ||
          !value.jurisdiction || !value.unit || !MARKET.test(value.unit) || !assets || !POSITIVE_DECIMAL.test(assets) ||
          !claims || !POSITIVE_DECIMAL.test(claims) || !reportingPeriodEnd || !publishedAt || !expiresAt ||
          Date.parse(publishedAt) < Date.parse(reportingPeriodEnd) || Date.parse(expiresAt) <= Date.parse(publishedAt) ||
          !value.documentHash || !HEX_32.test(value.documentHash) || value.conclusion !== "unmodified" ||
          !value.attestationSignatureHex || !HEX_64.test(value.attestationSignatureHex) || price.scale !== PPM_MAX) {
        fail("stablecoin reserve derivation is invalid");
      }
      const expected = (BigInt(assets) * BigInt(price.scale)) / BigInt(claims);
      if (expected !== BigInt(price.value)) fail("stablecoin reserve ratio does not match evidence");
      break;
    }
  }
}

export function validatePrice(price: Price, policy: ValidationPolicy): Price {
  const nowMs = policy.now === undefined ? Date.now() : new Date(policy.now).getTime();
  if (!Number.isFinite(nowMs)) fail("consumer policy now is invalid");
  if (!MARKET.test(policy.requestedMarket) || !PRICE_TYPES.includes(policy.requestedType) || policy.expectedVersion.length === 0) {
    fail("oracle consumer request policy is invalid");
  }
  if (!Number.isSafeInteger(policy.maximumAgeMs) || policy.maximumAgeMs <= 0 ||
      !Number.isSafeInteger(policy.minimumConfidencePpm) || policy.minimumConfidencePpm < 0 || policy.minimumConfidencePpm > PPM_MAX ||
      !Number.isSafeInteger(policy.minimumCoveragePpm) || policy.minimumCoveragePpm < 0 || policy.minimumCoveragePpm > PPM_MAX) {
    fail("oracle consumer quality policy is invalid");
  }
  if (price.market !== policy.requestedMarket || price.type !== policy.requestedType || price.version !== policy.expectedVersion) {
    fail("oracle response does not match the consumer request or policy");
  }
  const asOfMs = Date.parse(price.asOf);
  if (asOfMs > nowMs + FUTURE_SKEW_MS || nowMs - asOfMs > policy.maximumAgeMs) fail("oracle response is stale or future-dated");
  if (price.quality.stale || price.quality.circuitBreaker || price.quality.status !== "good" || Boolean(price.quality.failure)) {
    fail("oracle quality is unsafe");
  }
  if (price.quality.requiredSourceCount < 1 || price.quality.sourceCount < price.quality.requiredSourceCount ||
      price.quality.confidencePpm < policy.minimumConfidencePpm || price.quality.coveragePpm < policy.minimumCoveragePpm) {
    fail("oracle coverage or confidence is unsafe");
  }
  return price;
}

export function parseAndValidatePrice(input: unknown, policy: ValidationPolicy): Price {
  return validatePrice(parsePrice(input), policy);
}

function loopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "::1" || /^127(?:\.[0-9]{1,3}){3}$/.test(host);
}

async function boundedBody(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maximumBytes) fail("oracle response exceeds size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      fail("oracle response exceeds size limit");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

export class OracleClient {
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #maximumResponseBytes: number;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, options: OracleClientOptions = {}) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      fail("invalid Oracle base URL");
    }
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || parsed.search || parsed.hash) {
      fail("invalid Oracle base URL");
    }
    if (parsed.protocol === "http:" && !loopback(parsed.hostname)) fail("plain HTTP is restricted to loopback");
    const timeoutMs = options.timeoutMs ?? 5_000;
    const maximumResponseBytes = options.maximumResponseBytes ?? 1_048_576;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes <= 0) {
      fail("Oracle client limits must be positive integers");
    }
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== "function") fail("Oracle client requires a fetch implementation");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    this.#baseUrl = parsed;
    this.#timeoutMs = timeoutMs;
    this.#maximumResponseBytes = maximumResponseBytes;
    this.#fetch = fetchImplementation;
  }

  async price(market: string, type: PriceType, options: PriceRequestOptions = {}): Promise<Price> {
    if (!MARKET.test(market) || !PRICE_TYPES.includes(type)) fail("invalid Oracle price request");
    const endpoint = new URL(this.#baseUrl.toString());
    endpoint.pathname = `${endpoint.pathname}/prices`;
    endpoint.searchParams.set("market", market);
    endpoint.searchParams.set("type", type);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Oracle request timed out")), this.#timeoutMs);
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.#fetch(endpoint, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Oracle unavailable: HTTP ${response.status}`);
      const body = await boundedBody(response, this.#maximumResponseBytes);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        fail("invalid Oracle response JSON");
      }
      return parsePrice(payload);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
