import { OriginalWalletServicePrivateClient } from './original-wallet-service-private-client.js';
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSessionProofV2 } from "./product-session-proof-v2.js";
import {productSessionApprovalDigest} from './product-session-v2.js';
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from "./product-session-gateway.js";

export const PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 = "x-ynx-product-session-proof-v2";
const MAX_RESPONSE_BYTES = 1_048_576;
// Only this constructor can associate an adapter with its actual private endpoint.
// A public property or duck-typed transport must not choose a persisted authority.
const gatewayAuthorities = new WeakMap();

export function productSessionGatewayAuthority(adapter) {
  if (!gatewayAuthorities.has(adapter)) fail("INVALID_GATEWAY", "Browser storage requires an authority-bound Product Session Gateway fetch adapter");
  return gatewayAuthorities.get(adapter);
}

export class ProductSessionGatewayFetchAdapter {
  #endpoint; #fetch; #walletInstalled; #schemeRegistered; #timeoutMs;
  #deviceV4Entered = new Map();
  constructor(config) {
    exactFields(config, ["endpoint", "fetch", "walletInstalled", "schemeRegistered", "timeoutMs"], "Product Session Gateway fetch adapter configuration");
    this.#endpoint = endpoint(config.endpoint);
    if (typeof config.fetch !== "function" || typeof config.walletInstalled !== "function" || typeof config.schemeRegistered !== "function") fail("INVALID_GATEWAY", "Product Session Gateway fetch adapter dependencies are invalid");
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 30_000) fail("INVALID_GATEWAY", "Product Session Gateway timeout must be between one and thirty seconds");
    this.#fetch = config.fetch; this.#walletInstalled = config.walletInstalled; this.#schemeRegistered = config.schemeRegistered; this.#timeoutMs = config.timeoutMs;
    gatewayAuthorities.set(this, this.#endpoint);
  }

  async walletInstalled() { return capability(await this.#walletInstalled(), "Wallet installation detection"); }
  async schemeRegistered() { return capability(await this.#schemeRegistered(), "Wallet scheme detection"); }

  // Use a fresh HTTPS authority sample, without extrapolating the device clock or
  // adding half the network RTT. This instant has already passed at the authority.
  async currentTime(input) {
    exactFields(input, ["requestId"], "Product Session Gateway time request");
    try {
      const result = await this.#request(input.requestId, "/v2/product-sessions/time", null, null, "GET");
      exactFields(result, ["serverTime"], "Product Session Gateway time response");
      const now = new Date(result.serverTime);
      if (typeof result.serverTime !== "string" || !Number.isFinite(now.getTime()) || now.toISOString() !== result.serverTime) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway time is invalid");
      return now;
    } catch (error) {
      if (error instanceof WalletAuthError && error.code === "NETWORK_UNAVAILABLE") throw error;
      fail("CLOCK_UNAVAILABLE", "Product Session authority time could not be verified; Retry when Auth is available");
    }
  }

  async challenge(input) {
    exactFields(input, ["requestId", "request", "approval"], "Product Session Gateway challenge request");
    return this.#request(input.requestId, "/v2/product-sessions/challenge", { request: input.request, approval: input.approval }, null);
  }

  async complete(input) {
    exactFields(input, ["requestId", "request", "approval", "completion"], "Product Session Gateway completion request");
    return this.#request(input.requestId, "/v2/product-sessions/complete", { request: input.request, approval: input.approval, completion: input.completion }, null);
  }

  // Exact original Auth v4 routes, not the v2 response wrapper. The existing
  // coordinator must persist its original intent BEFORE this transport call.
  // This per-instance guard does not replace that durable journal or recovery.
  pairDeviceV4(input) { return this.#deviceV4('/v4/product-pairs', ['operationId','request','registrationOriginal','registrationMember','approval'], input); }
  challengeDeviceV4(input) { return this.#deviceV4('/v4/product-session-challenges', ['operationId','request','registrationOriginal','approval'], input); }
  completeDeviceV4(input) { return this.#deviceV4('/v4/product-sessions', ['operationId','request','registrationOriginal','approval','completion'], input); }

  async #deviceV4(route, fields, input) {
    const {originalBody, signal, operationId} = captureDeviceV4Request(input, fields);
    const prior=this.#deviceV4Entered.get(operationId);
    if (prior) { if(prior.failed)throw prior.error;throw deviceV4Unknown(operationId, new WalletAuthError('PAIR_V4_RECOVER_ORIGINAL_ONLY','Query the original operation; transport never resubmits it')); }
    const controller = new AbortController();
    const forward = () => controller.abort(deviceV4Reason.call(signal));
    deviceV4Listen.call(signal,'abort', forward, {once:true});
    let rejectAbort;
    const stopped = new Promise((_, reject) => { rejectAbort = reject; });
    const onStop = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', onStop, {once:true});
    const timer = setTimeout(() => controller.abort(new WalletAuthError('PAIR_V4_HTTP_TIMEOUT','Original operation outcome must be reconciled')), this.#timeoutMs);
    try {
      if (deviceV4Aborted.call(signal)) throw deviceV4Reason.call(signal);
      this.#deviceV4Entered.set(operationId,{failed:false}); // one fetch, including synchronous/falsy failure
      const fetch = this.#fetch;
      const response = await Promise.race([Promise.resolve().then(() => fetch(this.#endpoint+route, {method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:originalBody,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal})), stopped]);
      const result = await readDeviceV4Response(response, stopped);
      if (deviceV4Aborted.call(signal)) throw deviceV4Reason.call(signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      return result;
    } catch (cause) {
      if (!this.#deviceV4Entered.has(operationId)) throw cause;
      const record=this.#deviceV4Entered.get(operationId);
      if(!record.failed){record.failed=true;record.error=deviceV4Unknown(operationId,cause);}
      throw record.error;
    } finally {
      clearTimeout(timer); deviceV4Unlisten.call(signal,'abort', forward);
      controller.signal.removeEventListener('abort', onStop);
    }
  }

  async publishReturn(input) {
    exactFields(input,['requestId','request','approval'],'Original return publication');
    const result=await this.#request(input.requestId,'/v2/product-sessions/returns',{request:input.request,approval:input.approval},null);
    exactFields(result,['reference','nonce','state','expiresAt'],'Original publication result');
    if(!validPublicationReference(result.reference)||result.nonce!==input.request?.nonce||result.state!==input.request?.state||!validPublicationExpiry(result.expiresAt,input.request))fail('INVALID_GATEWAY_RESPONSE','Publication result differs from the exact original request');
    return result;
  }
  async returnChallenge(input) {
    exactFields(input,['requestId','reference','request'],'Original return challenge');
    return this.#request(input.requestId,'/v2/product-sessions/returns/challenge',{reference:input.reference,request:input.request},null);
  }
  async completeReturn(input) {
    exactFields(input,['requestId','reference','request','completion'],'Original return completion');
    return this.#request(input.requestId,'/v2/product-sessions/returns/complete',{reference:input.reference,request:input.request,completion:input.completion},null);
  }
  async returnOutcome(input) {
    exactFields(input,['requestId','reference','request','completion'],'Original return outcome');
    return this.#request(input.requestId,'/v2/product-sessions/returns/outcome',{reference:input.reference,request:input.request,completion:input.completion},null);
  }
  async publicationOutcome(input) {
    exactFields(input,['requestId','publicationRequestId','request','approval'],'Original publication recovery');
    const result=await this.#request(input.requestId,'/v2/product-sessions/returns/outcome',{selector:'YNX-PRODUCT-SESSION-PUBLICATION/v1',publicationRequestId:input.publicationRequestId,request:input.request,approval:input.approval},null);
    exactFields(result,result?.state==='not_found'?['state','retryAuthorized']:['state','reference','expiresAt','requestDigest','account','approvalDigest','retryAuthorized'],'Original publication outcome');
    if(result.retryAuthorized!==false)fail('INVALID_GATEWAY_RESPONSE','Publication outcome cannot authorize retry');
    if(result.state==='not_found')return result;
    if(!['pending','completed'].includes(result.state)||!validPublicationReference(result.reference)||!validPublicationExpiry(result.expiresAt,input.request)||result.account!==input.approval?.account||result.requestDigest!==input.approval?.requestDigest||result.approvalDigest!==productSessionApprovalDigest(input.approval))fail('INVALID_GATEWAY_RESPONSE','Publication outcome differs from its exact original account and approval');
    return result;
  }

  async introspect(input) {
    exactFields(input, ["requestId", "sessionBinding", "requiredScopes", "proof"], "Product Session Gateway introspection request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/introspect", { requiredScopes: input.requiredScopes }, proof);
  }

  async revoke(input) {
    exactFields(input, ["requestId", "sessionBinding", "proof"], "Product Session Gateway revoke request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/revoke", {}, proof);
  }

  async #request(requestId, path, body, proof, method = "POST") {
    if (typeof requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId)) fail("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid");
    const encodedBody = method === "GET" ? undefined : canonicalJSON(body);
    const headers = { "accept": "application/json", "x-request-id": requestId };
    if (method === "POST") headers["content-type"] = "application/json";
    if (proof !== null) headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] = encodeProductSessionGatewayProofHeaderV2(proof);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      // Native Window.fetch rejects a Gateway instance as its receiver. Invoke
      // the injected function directly; explicitly bound adapters keep theirs.
      const fetch = this.#fetch;
      response = await fetch(`${this.#endpoint}${path}`, { method, headers, body: encodedBody, cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof WalletAuthError && error.code === "ORIGINAL_PRIVATE_OUTCOME_UNKNOWN") throw error;
      fail("NETWORK_UNAVAILABLE", "Product Session Gateway is unavailable; no local response was substituted");
    }
    try {
      return await readGatewayResponse(response, requestId);
    } finally { clearTimeout(timeout); }
  }
}

const deviceV4Aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const deviceV4Reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const deviceV4Listen = EventTarget.prototype.addEventListener;
const deviceV4Unlisten = EventTarget.prototype.removeEventListener;
function deviceV4Unknown(operationId,cause) {
  return Object.assign(new WalletAuthError('PAIR_V4_HTTP_OUTCOME_UNKNOWN','Retain the original operation and reconcile; no retry is authorized'),{operationId,cause,recoverOnly:true,outcomeUnknown:true,retryAuthorized:false});
}
function captureDeviceV4Request(input,fields) {
  exactFields(input,['originalBody','abortContext'],'Original device v4 transport input');
  const descriptors=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(descriptors).length!==2||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))fail('PAIR_V4_HTTP_INPUT','Only original data inputs are accepted');
  const {originalBody,abortContext}=input;
  if(!abortContext||Object.getPrototypeOf(abortContext)!==Object.prototype||!Object.isFrozen(abortContext)||Reflect.ownKeys(abortContext).length!==1)fail('PAIR_V4_ABORT_CONTEXT','Original frozen context required');
  const d=Object.getOwnPropertyDescriptor(abortContext,'signal');
  if(!d||!Object.hasOwn(d,'value'))fail('PAIR_V4_ABORT_CONTEXT','Original signal required');
  const signal=d.value;let aborted;try{aborted=deviceV4Aborted.call(signal);}catch{fail('PAIR_V4_ABORT_CONTEXT','Original signal required');}
  if(aborted)throw deviceV4Reason.call(signal);
  if(typeof originalBody!=='string'||!originalBody.length||new TextEncoder().encode(originalBody).length>393216)fail('PAIR_V4_HTTP_SIZE','Original body exceeds the Auth route budget');
  let body;try{body=JSON.parse(originalBody);}catch{fail('PAIR_V4_HTTP_BODY','Original body must be JSON');}
  exactFields(body,fields,'Original device v4 route body');
  if(canonicalJSON(body)!==originalBody||typeof body.operationId!=='string'||!/^[a-f0-9]{64}$/.test(body.operationId)||body.request?.version!=='4'||body.approval?.version!=='4'||typeof body.registrationOriginal!=='string')fail('PAIR_V4_HTTP_BODY','Original route binding is invalid');
  return {originalBody,signal,operationId:body.operationId};
}
async function readDeviceV4Response(response,stopped) {
  if(!response||!Number.isInteger(response.status)||!response.headers||typeof response.headers.get!=='function'||!response.body||typeof response.body.getReader!=='function')fail('PAIR_V4_HTTP_RESPONSE','Original streaming response required');
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')||!/(^|,)\s*no-store\s*(,|$)/i.test(response.headers.get('cache-control')??''))fail('PAIR_V4_HTTP_RESPONSE','Original response headers invalid');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>MAX_RESPONSE_BYTES))fail('PAIR_V4_HTTP_RESPONSE','Response exceeds budget');
  const reader=response.body.getReader(),chunks=[];let size=0,done=false;
  try { while(true){const part=await Promise.race([reader.read(),stopped]);if(part.done){done=true;break;}if(!(part.value instanceof Uint8Array))fail('PAIR_V4_HTTP_RESPONSE','Byte stream required');size+=part.value.length;if(size>MAX_RESPONSE_BYTES)fail('PAIR_V4_HTTP_RESPONSE','Response exceeds budget');chunks.push(Uint8Array.from(part.value));} }
  finally { if(!done){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* Preserve the original read/abort cause while cancellation drains. */}}else reader.releaseLock(); }
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('PAIR_V4_HTTP_RESPONSE','Invalid response JSON');}
  if(response.status===409){exactFields(value,['code','newSession'],'Original recovery-only response');if(value.code!=='PAIR_V4_RECOVER_ORIGINAL_ONLY'||value.newSession!==false)fail('PAIR_V4_HTTP_RESPONSE','Invalid recovery-only response');throw Object.assign(new WalletAuthError(value.code,'Original operation requires recovery'),{originalResponse:value});}
  if(response.status!==200){exactFields(value,['code','authorized','newSession'],'Original refused response');if(typeof value.code!=='string'||!/^PAIR_V4_[A-Z0-9_]+$/.test(value.code)||value.authorized!==false||value.newSession!==false)fail('PAIR_V4_HTTP_RESPONSE','Invalid refusal');throw Object.assign(new WalletAuthError(value.code,'Original Auth refused this request'),{originalResponse:value});}
  exactFields(value,['original','durable','sourceAdmission','nativeAdmission'],'Original durable response');
  if(value.durable!==true||value.sourceAdmission!==false||value.nativeAdmission!==false||typeof value.original!=='string'||!value.original.length||new TextEncoder().encode(value.original).length>393216)fail('PAIR_V4_HTTP_RESPONSE','Invalid original result');
  let original;try{original=JSON.parse(value.original);}catch{fail('PAIR_V4_HTTP_RESPONSE','Original result is not JSON');}
  if(canonicalJSON(original)!==value.original)fail('PAIR_V4_HTTP_RESPONSE','Original result bytes changed');
  // DATA only. The existing caller verifies the returned original against the
  // request, current Source, account approval and fixed proof codecs.
  return Object.freeze(value);
}

export function decodeProductSessionGatewayProofHeaderV2(value) {
  if (typeof value !== "string" || value.length > 16_384) fail("INVALID_PROOF_HEADER", "Product Session proof header is invalid");
  let parsed; try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value, "Product Session proof header"))); } catch { fail("INVALID_PROOF_HEADER", "Product Session proof header is invalid"); }
  return parseProductSessionProofV2(parsed);
}

export function encodeProductSessionGatewayProofHeaderV2(value) {
  const proof = parseProductSessionProofV2(value);
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(proof)));
  if (encoded.length > 16_384) fail("INVALID_PROOF_HEADER", "Product Session proof header exceeds policy");
  return encoded;
}

function endpoint(value) { if (typeof value !== "string" || value.length > 512) fail("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid"); let parsed; try { parsed = new URL(value); } catch { fail("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid"); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.pathname !== "/" || value !== parsed.origin) fail("INVALID_GATEWAY", "Product Session Gateway endpoint must be a canonical HTTPS origin"); return parsed.origin; }
function capability(value, label) { if (typeof value !== "boolean") fail("INVALID_GATEWAY", `${label} must return a boolean`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
function validPublicationReference(value){return typeof value==='string'&&/^ynxpsr1_[A-Za-z0-9_-]{43}$/.test(value);}
function validPublicationExpiry(value,request){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value&&typeof request?.expiresAt==='string'&&value<=request.expiresAt;}

async function readGatewayResponse(response, requestId) {
      if (!response || typeof response.status !== "number" || !response.headers || typeof response.headers.get !== "function" || typeof response.text !== "function") fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is invalid");
      const contentType = response.headers.get("content-type") ?? "";
      const responseRequestId = response.headers.get("x-request-id");
      const cacheControl = response.headers.get("cache-control") ?? "";
      const contentLength = response.headers.get("content-length");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) || responseRequestId !== requestId || !/(^|,)\s*no-store\s*(,|$)/i.test(cacheControl)) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response headers are invalid");
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let text; try { text = await response.text(); } catch { fail("NETWORK_UNAVAILABLE", "Product Session Gateway response stream was interrupted; no local response was substituted"); }
      if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let payload; try { payload = JSON.parse(text); } catch { fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not JSON"); }
      if (canonicalJSON(payload) !== text) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not canonical JSON");
      if (response.status >= 200 && response.status < 300) {
        exactFields(payload, ["ok", "requestId", "result", "schemaVersion"], "Product Session Gateway success response");
        if (payload.ok !== true || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway success response binding is invalid");
        return payload.result;
      }
      exactFields(payload, ["error", "ok", "requestId", "schemaVersion"], "Product Session Gateway error response");
      exactFields(payload.error, ["code", "message"], "Product Session Gateway public error");
      if (payload.ok !== false || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION || typeof payload.error.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code) || typeof payload.error.message !== "string" || payload.error.message.length > 300) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway error response binding is invalid");
      throw new WalletAuthError(payload.error.code, payload.error.message);
}

// The fixed class shares this module's authority map and response parser. No
// public registration hook, endpoint selector or supplied dispatch callback.
export class ProductSessionGatewayPrivateAdapter extends ProductSessionGatewayFetchAdapter {
  #client;
  async publishReturn(){fail('ORIGINAL_PRIVATE_OPERATION_UNSUPPORTED','Reference publication requires the fixed normal HTTP adapter');}
  async returnChallenge(input){
    exactFields(input,['requestId','reference','request'],'Original Native reference challenge');
    return this.#reference('challenge',input.requestId,{reference:input.reference,request:input.request});
  }
  async completeReturn(input){
    exactFields(input,['requestId','reference','request','completion'],'Original Native reference complete');
    return this.#reference('complete',input.requestId,{reference:input.reference,request:input.request,completion:input.completion});
  }
  async returnOutcome(input){
    exactFields(input,['requestId','reference','request','completion'],'Original Native reference outcome');
    return this.#reference('outcome',input.requestId,{reference:input.reference,request:input.request,completion:input.completion});
  }
  async #reference(action,requestId,body){
    const response=await this.#client.requestReference(action,requestId,canonicalJSON(body));
    return readGatewayResponse(responseView(response),requestId);
  }
  async publicationOutcome(){fail('ORIGINAL_PRIVATE_OPERATION_UNSUPPORTED','Publication recovery requires the fixed normal HTTP adapter');}
  constructor(config) {
    exactFields(config, ['walletInstalled', 'schemeRegistered', 'timeoutMs'], 'Original Wallet Gateway configuration');
    const client = new OriginalWalletServicePrivateClient({timeoutMs: config.timeoutMs});
    const origin = 'https://wallet-auth.ynxweb4.com';
    const fetch = async (url, options) => {
      const operations = {'/v2/product-sessions/challenge': 'beginYNX', '/v2/product-sessions/complete': 'handleReturn', '/v2/product-sessions/introspect': 'restore', '/v2/product-sessions/revoke': 'disconnect'};
      const path = typeof url === 'string' && url.startsWith(origin) ? url.slice(origin.length) : '';
      if (!Object.hasOwn(operations, path) || options.method !== 'POST') fail('ORIGINAL_PRIVATE_REQUEST_INVALID', 'Original Wallet operation must be explicit');
      const response = await client.request(operations[path], 'effect', options.headers['x-request-id'], options.body, options.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] ?? null, options.signal);
      return responseView(response);
    };
    super({endpoint: origin, fetch, walletInstalled: config.walletInstalled, schemeRegistered: config.schemeRegistered, timeoutMs: config.timeoutMs});
    this.#client = client;
  }
  async currentTime() { fail('CLOCK_UNAVAILABLE', 'Original Wallet time requires a fixed operation context'); }
  async currentTimeForOperation(operation, input) {
    exactFields(input, ['requestId'], 'Original Wallet time request');
    const response = await this.#client.request(operation, 'time', input.requestId, null, null);
    const result = await readGatewayResponse(responseView(response), input.requestId);
    exactFields(result, ['serverTime'], 'Original Wallet time response');
    const now = new Date(result.serverTime);
    if (typeof result.serverTime !== 'string' || !Number.isFinite(now.getTime()) || now.toISOString() !== result.serverTime) fail('CLOCK_UNAVAILABLE', 'Original Wallet authority time is invalid');
    return now;
  }
}
function responseView(response) {
  return {status: response.status, headers: {get: name => response.headers[name.toLowerCase()] ?? null}, text: async () => response.body};
}
