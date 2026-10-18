import {originalPrivateCarrierBudget,originalPrivateSessionCarrier} from './original-wallet-service-private-carrier.js';
import {createOriginalPrivateReferenceCarrier,sameOriginalReferenceCompletion} from './original-wallet-service-private-reference.js';
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from './product-session-gateway-snapshot-v2.js';
import { canonicalJSON, exactFields, WalletAuthError } from './canonical.js';

const bridgeStates = new WeakMap();
const OPERATIONS = new Set(['beginYNX', 'handleReturn', 'restore', 'disconnect']);
const fail = code => { throw new WalletAuthError(code, 'Original Wallet service is unavailable; preserve the original outcome'); };
const size = value => new TextEncoder().encode(value).length;
// A normal bridge is only a transport. Qualification and ACK remain with the
// backend owner; neither this property nor a JSON response grants Native custody.
export function hasOriginalWalletServicePrivateBridge() {
  return globalThis.window?.ynxDesktopWallet !== undefined;
}
export class OriginalWalletServicePrivateClient {
  #bridge; #dispatch; #timeout; #state;
  constructor(config) {
    exactFields(config, ['timeoutMs'], 'Original Wallet service client');
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 30000) fail('INVALID_GATEWAY');
    const bridge = globalThis.window?.ynxDesktopWallet;
    if (typeof bridge?.originalServiceDispatch !== 'function') fail('ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED');
    this.#bridge = bridge; this.#dispatch = bridge.originalServiceDispatch; this.#timeout = config.timeoutMs;
    if (!bridgeStates.has(bridge)) bridgeStates.set(bridge, {records: new Map(), unknown: false,firstCausePresent:false,firstCause:undefined});
    this.#state = bridgeStates.get(bridge);
  }
  async request(operation, phase, requestId, body, proofHeader, signal) {
    if (!OPERATIONS.has(operation) || !['time', 'effect'].includes(phase) || typeof requestId !== 'string' || !/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId)) fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
    if (phase === 'time') { if (body !== null || proofHeader !== null) fail('ORIGINAL_PRIVATE_REQUEST_INVALID'); }
    else {
      if (typeof body !== 'string' || size(body) > 196608 || !(proofHeader === null || typeof proofHeader === 'string' && size(proofHeader) <= 16384)) fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
      let parsed; try { parsed = JSON.parse(body); } catch { fail('ORIGINAL_PRIVATE_REQUEST_INVALID'); }
      if (canonicalJSON(parsed) !== body) fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
      exactFields(parsed, {beginYNX: ['request', 'approval'], handleReturn: ['request', 'approval', 'completion'], restore: ['requiredScopes'], disconnect: []}[operation], 'Original four-operation body');
      if (['beginYNX', 'handleReturn'].includes(operation) ? proofHeader !== null : proofHeader === null) fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
    }
    return this.#requestCarrier(originalPrivateSessionCarrier({requestId,operation,phase,body,proofHeader}),signal);
  }
  requestReference(action,requestId,body,signal){
    return this.#requestCarrier(createOriginalPrivateReferenceCarrier(action,requestId,body),signal);
  }
  #originalOutcomeRead(carrier){
    if(carrier.referenceAction!=='outcome')return null;
    for(const row of this.#state.records.values())if(row.unknown===true&&row.carrier&&sameOriginalReferenceCompletion(row.carrier,carrier))return row;
    return null;
  }
  async #requestCarrier(carrier,signal){
    const {requestId,operation,phase,body}=carrier,budget=originalPrivateCarrierBudget(carrier);
    if(typeof body==='string'&&size(body)>budget.body)fail('ORIGINAL_PRIVATE_CAPACITY');
    const input = canonicalJSON(carrier);
    if (size(input) > budget.envelope) fail('ORIGINAL_PRIVATE_CAPACITY');
    const original=this.#originalOutcomeRead(carrier);
    const permitted=()=>!this.#state.unknown||original!==null&&original.unknown===true&&this.#originalOutcomeRead(carrier)===original;
    if (!permitted()) fail('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN');
    const key = `${operation}:${phase}:${requestId}`;
    if (this.#state.records.has(key)) fail('ORIGINAL_PRIVATE_ALREADY_ENTERED');
    if (this.#state.records.size >= 64) fail('ORIGINAL_PRIVATE_CAPACITY');
    if (signal?.aborted) fail('NETWORK_UNAVAILABLE');
    const current = () => globalThis.window?.ynxDesktopWallet === this.#bridge && this.#bridge.originalServiceDispatch === this.#dispatch;
    if (!current()) fail('ORIGINAL_PRIVATE_BRIDGE_CHANGED');
    const row = {response: null, unknown: true,carrier,originalRaw:input}; this.#state.records.set(key, row);
    const controller = new AbortController(); let timer, cancel;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once: true});
    const cancelled = new Promise((_, reject) => {
      cancel = () => reject(new WalletAuthError('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN', 'Original Wallet response was interrupted; do not replay the request'));
      controller.signal.addEventListener('abort', cancel, {once: true});
      timer = setTimeout(abort, this.#timeout);
    });
    try {
      // Call once. A late fulfillment is observed by Promise.race but cannot
      // release success after interruption or replace an unresolved outcome.
      const pending = Promise.resolve().then(() => {
        if (!permitted()) fail('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN');
        if (controller.signal.aborted || !current()) fail('ORIGINAL_PRIVATE_BRIDGE_CHANGED');
        return this.#dispatch.call(this.#bridge, input, {signal: controller.signal});
      }).then(response => {
        validateOriginalResponse(response, requestId,budget.response);
        row.response = Object.freeze({status: response.status, headers: Object.freeze({...response.headers}), body: response.body});
        return row.response;
      });
      // Retain a late result without treating it as terminal or clearing UNKNOWN.
      void pending.catch(() => {});
      const response = await Promise.race([pending, cancelled]);
      validateOriginalResponse(response, requestId,budget.response);
      row.response = Object.freeze({status: response.status, headers: Object.freeze({...response.headers}), body: response.body});
      if (!permitted() || controller.signal.aborted || !current()) fail('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN');
      row.unknown = false; return row.response;
    } catch (cause) {
      this.#state.unknown = true; row.cause = cause;
      if(!this.#state.firstCausePresent){this.#state.firstCausePresent=true;this.#state.firstCause=cause;}
      // No rejection alone proves pre-entry. Retain all uncertain writes and
      // stop new requests, including those a higher-level retry might create.
      throw new WalletAuthError('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN', 'Original Wallet outcome remains unresolved; preserve protected state and do not replay');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', cancel);
    }
  }
  selectOutcome(operation, phase, requestId) {
    const row = this.#state.records.get(`${operation}:${phase}:${requestId}`);
    if (!row) fail('ORIGINAL_PRIVATE_OUTCOME_REQUIRED');
    return Object.freeze({response: row.response, unknown: row.unknown});
  }
  status() { return Object.freeze({unknown: this.#state.unknown, retained: this.#state.records.size}); }
}
function validateOriginalResponse(value, requestId,limit) {
  exactFields(value, ['status', 'headers', 'body'], 'Original Wallet full response');
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) fail('INVALID_GATEWAY_RESPONSE');
  if (!Number.isInteger(value.status) || value.status < 200 || value.status > 599 || typeof value.body !== 'string' || size(value.body) > 1048576) fail('INVALID_GATEWAY_RESPONSE');
  if (!value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers) || Object.getPrototypeOf(value.headers) !== Object.prototype || Object.keys(value.headers).some(key => !/^[a-z0-9-]+$/.test(key) || typeof value.headers[key] !== 'string' || value.headers[key].length > 16384)) fail('INVALID_GATEWAY_RESPONSE');
  if (Object.keys(value.headers).length > 32 || Object.values(Object.getOwnPropertyDescriptors(value.headers)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) fail('INVALID_GATEWAY_RESPONSE');
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(value.headers['content-type'] ?? '') || value.headers['x-request-id'] !== requestId || !/(^|,)\s*no-store\s*(,|$)/i.test(value.headers['cache-control'] ?? '')) fail('INVALID_GATEWAY_RESPONSE');
  const length = value.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) !== size(value.body))) fail('INVALID_GATEWAY_RESPONSE');
  let payload; try { payload = JSON.parse(value.body); } catch { fail('INVALID_GATEWAY_RESPONSE'); }
  const successful = value.status < 300;
  exactFields(payload, successful ? ['ok', 'requestId', 'result', 'schemaVersion'] : ['error', 'ok', 'requestId', 'schemaVersion'], 'Original Gateway payload');
  if (payload.ok !== successful) fail('INVALID_GATEWAY_RESPONSE');
  if (!successful) { exactFields(payload.error, ['code', 'message'], 'Original Gateway error'); if (typeof payload.error.code !== 'string' || !/^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code) || typeof payload.error.message !== 'string' || payload.error.message.length > 300) fail('INVALID_GATEWAY_RESPONSE'); }
  if (canonicalJSON(payload) !== value.body || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail('INVALID_GATEWAY_RESPONSE');
  if(limit!==undefined&&size(canonicalJSON(value))>limit)fail('INVALID_GATEWAY_RESPONSE');
}
