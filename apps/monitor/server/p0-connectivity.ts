export const P0_CONNECTIVITY_SCHEMA = 'ynx.monitor.p0-connectivity.v1' as const;

export type P0ConnectivityProbeKind = 'rpc' | 'evm-rpc' | 'gateway' | 'faucet' | 'shop-api' | 'product-api' | 'walletconnect-relay';
export type P0ConnectivityStatus = 'operational' | 'degraded' | 'unavailable' | 'not_configured';
export type P0ConnectivityError =
  | 'RPC_TRANSIENT_TLS_FAILURE'
  | 'EVM_CHAIN_MISMATCH'
  | 'CHAIN_IDENTITY_MISMATCH'
  | 'PRODUCT_SESSION_DEVICE_PROOF_REJECTED'
  | 'PRODUCT_SESSION_PROTOCOL_REJECTED'
  | 'PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW'
  | 'PRODUCT_SESSION_GATEWAY_UNREACHABLE'
  | 'PRODUCT_SESSION_GATEWAY_ERROR'
  | 'PRODUCT_API_FAILURE'
  | 'WALLETCONNECT_RELAY_UNREACHABLE'
  | 'CLIENT_RETIRED'
  | 'ENDPOINT_UNREACHABLE';

export interface P0ConnectivityProbeConfig {
  id: string;
  name: string;
  kind: P0ConnectivityProbeKind;
  /** An HTTPS URL. Query strings, credentials, and private addresses are rejected. */
  url: string;
  /** Optional public HTTPS URL used only to read a release/source identity. */
  versionUrl?: string;
  expectedEvmChainId?: number;
  /**
   * Optional fail-closed service identity contract. When any configured field
   * is missing or differs, a successful HTTP response is reported unavailable.
   */
  expectedChainId?: number;
  expectedCosmosChainId?: string;
  expectedNativeSymbol?: string;
}

export interface P0ConnectivityIdentity {
  sourceCommit: string | null;
  release: string | null;
  startedAt: string | null;
}

export interface P0ServiceChainIdentity {
  chainId: number | null;
  cosmosChainId: string | null;
  nativeSymbol: string | null;
}

export interface P0ConnectivityResult {
  id: string;
  name: string;
  kind: P0ConnectivityProbeKind;
  status: Exclude<P0ConnectivityStatus, 'not_configured'>;
  checkedAt: string;
  endpoint: string;
  identity: P0ConnectivityIdentity;
  chainIdentity?: P0ServiceChainIdentity;
  chainId?: number;
  errorCode?: P0ConnectivityError;
  message: string;
}

export interface P0ConnectivitySnapshot {
  schemaVersion: typeof P0_CONNECTIVITY_SCHEMA;
  availability: 'available';
  status: P0ConnectivityStatus;
  checkedAt: string;
  services: P0ConnectivityResult[];
  limitations: string[];
}

type JSONRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ProbeHistory = Map<string, { tlsFailureAt: string }>;

const sha = /^[a-f0-9]{7,64}$/i;
const id = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const publicText = /^[\w .:@/+-]{1,120}$/;

function object(value: unknown): JSONRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JSONRecord : {};
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80 || !Number.isFinite(Date.parse(value))) return null;
  return new Date(Date.parse(value)).toISOString();
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 120 && publicText.test(normalized) ? normalized : null;
}

function endpointOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('P0 connectivity probe URL must be an absolute HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('P0 connectivity probe URL must be a credential-free HTTPS URL without a query or fragment');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('P0 connectivity probe URL must not target a private address');
  return url.origin;
}

function identityFrom(...values: unknown[]): P0ConnectivityIdentity {
  for (const value of values) {
    const document = object(value);
    const build = object(document.build);
    const commit = document.sourceCommit ?? document.commit ?? build.commit;
    const sourceCommit = typeof commit === 'string' && sha.test(commit) ? commit.toLowerCase() : null;
    const release = text(document.release ?? document.version ?? build.release);
    const startedAt = iso(document.startedAt);
    if (sourceCommit || release || startedAt) return { sourceCommit, release, startedAt };
  }
  return { sourceCommit: null, release: null, startedAt: null };
}

async function boundedJSON(response: Response): Promise<JSONRecord> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 262_144) throw new Error('response_too_large');
  const raw = await response.text();
  if (raw.length > 262_144) throw new Error('response_too_large');
  try { return object(JSON.parse(raw)); } catch { return {}; }
}

function gatewayError(code: unknown, httpStatus: number): P0ConnectivityError {
  const normalized = typeof code === 'string' ? code.toUpperCase() : '';
  if (['INVALID_DEVICE_PROOF', 'INVALID_DEVICE_KEY', 'DEVICE_MISMATCH', 'SESSION_BINDING_MISMATCH'].includes(normalized)) return 'PRODUCT_SESSION_DEVICE_PROOF_REJECTED';
  if (['UNKNOWN_OR_MISSING_FIELD', 'NON_CANONICAL_JSON', 'INVALID_JSON', 'INVALID_FIELD', 'INVALID_PROOF_HEADER'].includes(normalized)) return 'PRODUCT_SESSION_PROTOCOL_REJECTED';
  if (['EXPIRED', 'INVALID_EXPIRY', 'INVALID_TIME', 'ISSUED_IN_FUTURE'].includes(normalized)) return 'PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW';
  if (httpStatus === 410 || normalized === 'CLIENT_RETIRED') return 'CLIENT_RETIRED';
  if (httpStatus >= 500) return 'PRODUCT_SESSION_GATEWAY_UNREACHABLE';
  return 'PRODUCT_SESSION_GATEWAY_ERROR';
}

function unavailable(kind: P0ConnectivityProbeKind): P0ConnectivityError {
  if (kind === 'gateway') return 'PRODUCT_SESSION_GATEWAY_UNREACHABLE';
  if (kind === 'walletconnect-relay') return 'WALLETCONNECT_RELAY_UNREACHABLE';
  return 'ENDPOINT_UNREACHABLE';
}

function errorMessage(code: P0ConnectivityError): string {
  const messages: Record<P0ConnectivityError, string> = {
    RPC_TRANSIENT_TLS_FAILURE: 'RPC recovered after an observed TLS transport failure; continued monitoring is required.',
    EVM_CHAIN_MISMATCH: 'EVM endpoint responded successfully but reported a different chain ID.',
    CHAIN_IDENTITY_MISMATCH: 'Service did not prove the required canonical chain identity.',
    PRODUCT_SESSION_DEVICE_PROOF_REJECTED: 'The private Product Session device proof was rejected. Standard Wallet connection is not implied to be disconnected.',
    PRODUCT_SESSION_PROTOCOL_REJECTED: 'The private Product Session request was rejected by protocol validation. Standard Wallet connection is not implied to be disconnected.',
    PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW: 'The private Product Session request expired or its clock data was invalid. Standard Wallet connection is not implied to be disconnected.',
    PRODUCT_SESSION_GATEWAY_UNREACHABLE: 'The private Product Session gateway could not be reached. Standard Wallet connection and public chain data remain separate.',
    PRODUCT_SESSION_GATEWAY_ERROR: 'The private Product Session gateway returned an application error. Standard Wallet connection is not implied to be disconnected.',
    PRODUCT_API_FAILURE: 'The product API did not return a successful response.',
    WALLETCONNECT_RELAY_UNREACHABLE: 'The WalletConnect relay could not be reached.',
    CLIENT_RETIRED: 'This client or endpoint is retired; it is not classified as offline.',
    ENDPOINT_UNREACHABLE: 'The public endpoint could not be reached.',
  };
  return messages[code];
}

function evmChainId(body: JSONRecord): number | null {
  const result = body.result;
  if (typeof result === 'string' && /^0x[0-9a-f]+$/i.test(result)) return Number.parseInt(result, 16);
  if (typeof result === 'number' && Number.isSafeInteger(result)) return result;
  return null;
}

function numericChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d{1,12}$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function cosmosChainId(value: unknown): string | null {
  return typeof value === 'string' && /^ynx_\d{1,12}-\d{1,6}$/i.test(value) ? value.toLowerCase() : null;
}

function nativeSymbol(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z0-9]{2,16}$/i.test(value) ? value.toUpperCase() : null;
}

function serviceChainIdentity(body: JSONRecord): P0ServiceChainIdentity {
  const network = object(body.network);
  const status = object(body.status);
  const result = object(body.result);
  const nodeInfo = object(body.node_info);
  const binding = object(object(body.chain_binding).observed);
  const documents = [body, network, status, result, nodeInfo, binding];
  const first = <T>(read: (value: JSONRecord) => T | null): T | null => {
    for (const document of documents) {
      const value = read(document);
      if (value !== null) return value;
    }
    return null;
  };
  return {
    chainId: first((document) => numericChainId(document.chainId ?? document.chain_id ?? document.expected_numeric_chain_id)),
    cosmosChainId: first((document) => cosmosChainId(document.cosmosChainId ?? document.cometChainId ?? document.chain_id ?? document.network)),
    nativeSymbol: first((document) => nativeSymbol(document.nativeSymbol ?? document.nativeCurrencySymbol ?? document.native_symbol)),
  };
}

function hasExpectedServiceChainIdentity(config: P0ConnectivityProbeConfig): boolean {
  return config.expectedChainId !== undefined || config.expectedCosmosChainId !== undefined || config.expectedNativeSymbol !== undefined;
}

function validExpectedServiceChainIdentity(config: P0ConnectivityProbeConfig): boolean {
  return (config.expectedChainId === undefined || (Number.isSafeInteger(config.expectedChainId) && config.expectedChainId >= 0)) &&
    (config.expectedCosmosChainId === undefined || cosmosChainId(config.expectedCosmosChainId) !== null) &&
    (config.expectedNativeSymbol === undefined || nativeSymbol(config.expectedNativeSymbol) !== null);
}

function matchesExpectedServiceChainIdentity(config: P0ConnectivityProbeConfig, observed: P0ServiceChainIdentity): boolean {
  return (config.expectedChainId === undefined || observed.chainId === config.expectedChainId) &&
    (config.expectedCosmosChainId === undefined || observed.cosmosChainId === config.expectedCosmosChainId.toLowerCase()) &&
    (config.expectedNativeSymbol === undefined || observed.nativeSymbol === config.expectedNativeSymbol.toUpperCase());
}

export async function probeP0Connectivity(config: P0ConnectivityProbeConfig, options: { fetch?: FetchLike; now?: Date; history?: ProbeHistory } = {}): Promise<P0ConnectivityResult> {
  if (!id.test(config.id) || !text(config.name)) throw new Error('P0 connectivity probe requires a safe id and name');
  if (!validExpectedServiceChainIdentity(config)) throw new Error('P0 connectivity probe has an invalid expected chain identity');
  const endpoint = endpointOrigin(config.url);
  const checkedAt = (options.now ?? new Date()).toISOString();
  const fetcher = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = config.kind === 'evm-rpc'
      ? await fetcher(config.url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'ynx-monitor-chain-id', method: 'eth_chainId', params: [] }) })
      : await fetcher(config.url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const body = await boundedJSON(response);
    let version: JSONRecord = {};
    if (config.versionUrl) {
      endpointOrigin(config.versionUrl);
      try {
        const versionResponse = await fetcher(config.versionUrl, { signal: controller.signal, headers: { accept: 'application/json' } });
        if (versionResponse.ok) version = await boundedJSON(versionResponse);
      } catch { /* Identity is optional and never turns a healthy service into unhealthy. */ }
    }
    const identity = identityFrom(version, body);
    const chainIdentity = serviceChainIdentity(body);
    if (!response.ok) {
      const errorCode = config.kind === 'gateway' ? gatewayError(body.code ?? body.error, response.status) : response.status === 410 ? 'CLIENT_RETIRED' : config.kind === 'walletconnect-relay' ? 'WALLETCONNECT_RELAY_UNREACHABLE' : 'PRODUCT_API_FAILURE';
      return { id: config.id, name: config.name, kind: config.kind, status: errorCode === 'CLIENT_RETIRED' ? 'degraded' : 'unavailable', checkedAt, endpoint, identity, ...(hasExpectedServiceChainIdentity(config) ? { chainIdentity } : {}), errorCode, message: errorMessage(errorCode) };
    }
    if (config.kind === 'evm-rpc') {
      const chainId = evmChainId(body);
      if (chainId === null || chainId !== config.expectedEvmChainId) {
        const errorCode: P0ConnectivityError = 'EVM_CHAIN_MISMATCH';
        return { id: config.id, name: config.name, kind: config.kind, status: 'unavailable', checkedAt, endpoint, identity, ...(hasExpectedServiceChainIdentity(config) ? { chainIdentity } : {}), ...(chainId === null ? {} : { chainId }), errorCode, message: errorMessage(errorCode) };
      }
      if (hasExpectedServiceChainIdentity(config) && !matchesExpectedServiceChainIdentity(config, chainIdentity)) {
        const errorCode: P0ConnectivityError = 'CHAIN_IDENTITY_MISMATCH';
        return { id: config.id, name: config.name, kind: config.kind, status: 'unavailable', checkedAt, endpoint, identity, chainIdentity, chainId, errorCode, message: errorMessage(errorCode) };
      }
      return { id: config.id, name: config.name, kind: config.kind, status: 'operational', checkedAt, endpoint, identity, ...(hasExpectedServiceChainIdentity(config) ? { chainIdentity } : {}), chainId, message: 'EVM endpoint returned the expected chain ID.' };
    }
    if (hasExpectedServiceChainIdentity(config) && !matchesExpectedServiceChainIdentity(config, chainIdentity)) {
      const errorCode: P0ConnectivityError = 'CHAIN_IDENTITY_MISMATCH';
      return { id: config.id, name: config.name, kind: config.kind, status: 'unavailable', checkedAt, endpoint, identity, chainIdentity, errorCode, message: errorMessage(errorCode) };
    }
    const previousTls = options.history?.get(config.id);
    if (config.kind === 'rpc' && previousTls) {
      options.history?.delete(config.id);
      const errorCode: P0ConnectivityError = 'RPC_TRANSIENT_TLS_FAILURE';
      return { id: config.id, name: config.name, kind: config.kind, status: 'degraded', checkedAt, endpoint, identity, ...(hasExpectedServiceChainIdentity(config) ? { chainIdentity } : {}), errorCode, message: errorMessage(errorCode) };
    }
    return { id: config.id, name: config.name, kind: config.kind, status: 'operational', checkedAt, endpoint, identity, ...(hasExpectedServiceChainIdentity(config) ? { chainIdentity } : {}), message: 'Public endpoint returned a successful response.' };
  } catch (error) {
    const errorCode = unavailable(config.kind);
    if (config.kind === 'rpc' && /tls|certificate|ssl/i.test(error instanceof Error ? error.message : '')) options.history?.set(config.id, { tlsFailureAt: checkedAt });
    return { id: config.id, name: config.name, kind: config.kind, status: 'unavailable', checkedAt, endpoint, identity: { sourceCommit: null, release: null, startedAt: null }, errorCode, message: errorMessage(errorCode) };
  } finally { clearTimeout(timeout); }
}

export async function buildP0ConnectivitySnapshot(probes: P0ConnectivityProbeConfig[], options: { fetch?: FetchLike; now?: Date; history?: ProbeHistory } = {}): Promise<P0ConnectivitySnapshot> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  if (!probes.length) return { schemaVersion: P0_CONNECTIVITY_SCHEMA, availability: 'available', status: 'not_configured', checkedAt, services: [], limitations: ['No public P0 connectivity probes are configured. This is not an offline classification.'] };
  if (probes.length > 32 || new Set(probes.map((probe) => probe.id)).size !== probes.length) throw new Error('P0 connectivity probes must contain unique ids and at most 32 entries');
  const services = await Promise.all(probes.map((probe) => probeP0Connectivity(probe, options)));
  const status: P0ConnectivityStatus = services.some((service) => service.status === 'unavailable') ? 'unavailable' : services.some((service) => service.status === 'degraded') ? 'degraded' : 'operational';
  return { schemaVersion: P0_CONNECTIVITY_SCHEMA, availability: 'available', status, checkedAt, services, limitations: ['This is endpoint-level evidence only. It does not prove installed-client Wallet connection, signing, transaction, or Product Session completion.'] };
}
