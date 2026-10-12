import {createHash} from 'node:crypto';
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeProductSessionGatewayProofHeaderV2, PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 } from "./product-session-gateway-client.js";
import { ProductSessionGatewayHttpHandler } from "./product-session-gateway-http.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";
import { decodeWalletSessionControlProofHeader, WALLET_SESSION_CONTROL_INTENT_PATHS, WALLET_SESSION_CONTROL_PATHS, WALLET_SESSION_CONTROL_PROOF_HEADER } from "./wallet-session-control.js";
import { observeDurableProductSessionControlIntent, parseProductSessionControlIntent, productSessionControlClockFloor } from "./product-session-control-intent.js";
import { verifyProductSessionProofV2 } from './product-session-proof-v2.js';
import { parseOriginalOperationMapping, captureOriginalRecoveryIdentity, captureOriginalReaderBytes, captureOriginalRecoveryJSON } from './original-operation-recovery-state.js';
import { originalSessionProjectionRecord } from './product-session-authority-projection.js';
import { ProductSessionControlNodeStore } from "./product-session-control-node-store.js";
import { parseProductSessionControlCapacityPolicy, productSessionControlPublicCapacityPolicy } from "./product-session-control-capacity.js";

import {assertOriginalOperatorRoleVerifier} from './original-device-reader-operator-role-certificate.js';
import {assertOriginalBackendOperationAuthenticator} from './original-backend-operation-auth.js';

const TIME = "/v2/product-sessions/time", CAPABILITIES = "/v2/product-sessions/capabilities", WALLET = "https://wallet.ynxweb4.com";
const READ_ROUTES = new Set([TIME, CAPABILITIES]);
const OWNER_ROUTES = new Set([...WALLET_SESSION_CONTROL_PATHS, ...WALLET_SESSION_CONTROL_INTENT_PATHS]);
const ROUTES = new Set([...READ_ROUTES, ...OWNER_ROUTES, "/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect", "/v2/product-sessions/revoke", "/v2/product-sessions/devices/revoke"]);

const originalControlRuntimeSources=new WeakMap();
export function captureOriginalControlWalletRuntimeHostSource(source){
 const owned=originalControlRuntimeSources.get(source);
 if(!owned)fail('ORIGINAL_RUNTIME_NOT_CONFIGURED','Actual original control Host source is required');
 owned.assertCurrent();return owned.view;
}

/** Explicit v3 host; it never initializes or migrates a serving state file. */
export class ProductSessionControlNodeHost {
  static get businessRevalidationSupported() { return true; }
  #registry; #origins; #store; #now; #tokens; #capacityPolicy; #originalMappingProducer; #backendOperationAuth; #originalOperatorRole; #originalDeviceClockFloor = -Infinity;
  constructor(registry, options) {
    exactFields(options, ["now", "statePath", "tokenFactory", ...(Object.hasOwn(options, "io") ? ["io"] : []), ...(Object.hasOwn(options, "capacityPolicy") ? ["capacityPolicy"] : []), ...(Object.hasOwn(options, "originalEffectReadbackVerifier") ? ["originalEffectReadbackVerifier"] : []), ...(Object.hasOwn(options, "originalOperationRecoveryReader") ? ["originalOperationRecoveryReader"] : []), ...["originalOperationMappingVerifier","originalRecoveryRegistrationCurrent","originalBackendOperationAuthenticator","originalOperatorReaderApprovalAuthority","originalOperatorReaderRoleVerifier","originalDeveloperResourceAuthority","originalDeveloperResourceHeldSource"].filter(key=>Object.hasOwn(options,key))], "Product Session control Node host options");
    this.#capacityPolicy = parseProductSessionControlCapacityPolicy(options.capacityPolicy);
    if (typeof options.now !== "function" || typeof options.tokenFactory !== "function") fail("INVALID_HOST", "Control host dependencies are invalid");
    this.#registry = parseProductSessionRegistry(registry);
    this.#origins = new Set(this.#registry.products.map(product => product.webOrigin));
    this.#originalOperatorRole=Object.hasOwn(options,'originalOperatorReaderRoleVerifier')?assertOriginalOperatorRoleVerifier(options.originalOperatorReaderRoleVerifier):undefined;
    if(this.#originalOperatorRole&&(!options.originalOperatorReaderApprovalAuthority||canonicalJSON(this.#originalOperatorRole.operatorAnchor)!==canonicalJSON(options.originalOperatorReaderApprovalAuthority.operatorAnchor)))fail('ORIGINAL_OPERATOR_ROLE_BINDING_MISMATCH','Role and operator approval authority differ');
    this.#now = options.now; this.#tokens = options.tokenFactory; this.#originalMappingProducer=options.originalOperationMappingVerifier; this.#backendOperationAuth=Object.hasOwn(options,'originalBackendOperationAuthenticator')?assertOriginalBackendOperationAuthenticator(options.originalBackendOperationAuthenticator):undefined;
    this.#store = new ProductSessionControlNodeStore({ statePath: options.statePath, projectionTokenFactory: options.tokenFactory, ...(Object.hasOwn(options,"originalEffectReadbackVerifier") ? {originalEffectReadbackVerifier:options.originalEffectReadbackVerifier} : {}), ...(Object.hasOwn(options,"originalOperationRecoveryReader") ? {originalOperationRecoveryReader:options.originalOperationRecoveryReader} : {}), originalRecoveryNow:options.now,originalDeveloperResourceNow:options.now,...(this.#originalOperatorRole?{originalOperatorReaderRoleCurrent:state=>this.#assertOriginalOperatorRole(state)}:{}), ...Object.fromEntries(["originalOperationMappingVerifier","originalRecoveryRegistrationCurrent","originalBackendOperationAuthenticator","originalOperatorReaderApprovalAuthority","originalDeveloperResourceAuthority","originalDeveloperResourceHeldSource"].filter(key=>Object.hasOwn(options,key)).map(key=>[key,options[key]])), ...(options.io ? { io: options.io } : {}) });
  }
  #assertOriginalOperatorRole(state) {
    const binding=this.#originalOperatorRole.binding;
    const session=state.snapshot.authority.sessions.find(row=>row.sessionBinding===binding.sessionBinding);
    if(!session)fail('ORIGINAL_OPERATOR_ROLE_UNAVAILABLE','Original accepted role Session is absent');
    const captured=this.#captureOriginalState(state,session,session.scopes,binding.productId);
    this.#originalOperatorRole.assertOriginalRoleCurrent(captured,this.#instant());
  }
  snapshot() { return this.#store.snapshot(); }
  // Private same-host production callsites. No public unverified HTTP mount.
  // Full signed account action + independently registered resource evidence
  // must reach the original writer before any original domain effect starts.
  reserveOriginalDeveloperResourceOperation(input,actualRawWire){return this.#store.reserveOriginalDeveloperResourceOperation(input,actualRawWire);}
  readOriginalDeveloperResourceOperation(identity,readerProof,originalReaderBody){return this.#store.readOriginalDeveloperResourceOperation(identity,readerProof,originalReaderBody,this.#instant());}
  approveOriginalOperatorReaderRegistration(raw){return this.#store.approveOriginalOperatorReaderRegistration(raw);}
  readOriginalOperatorReaderCheckpoint(operatorId,keyId){return this.#store.readOriginalOperatorReaderCheckpoint(operatorId,keyId);}
  revalidate(session,scopes,productId,at,businessRevalidation=false){const snapshot=this.#store.snapshot(),handler=new ProductSessionGatewayHttpHandler(this.#registry,this.#tokens,snapshot,this.#capacityPolicy);const result=handler.revalidate(session,scopes,productId,at,businessRevalidation);if(canonicalJSON(this.#store.snapshot())!==canonicalJSON(snapshot))fail("STATE_TAMPERED","Private authority changed during revalidation");return result;}
  // INTERNAL same-Node-writer capture, not an HTTP actor claim or a real
  // cross-process Go effect fence. The original Kernel revalidates the actual
  // signed Session and fixed scopes before projected metadata is released.
  #captureOriginalState(state, original, scopes, productId) {
    const now = this.#instant();
    const kernel = new ProductSessionGatewayHttpHandler(this.#registry,this.#tokens,state.snapshot,this.#capacityPolicy);
    const checked = kernel.revalidate(original,scopes,productId,now,true);
    if (checked?.active !== true || canonicalJSON(checked.session) !== canonicalJSON(original)) fail('PROJECTION_SESSION_MISMATCH','Original active Session differs from the requested binding');
    const observed = originalSessionProjectionRecord(state.snapshot,state.projection,original.sessionBinding);
    if (canonicalJSON(observed.session) !== canonicalJSON(checked.session)) fail('PROJECTION_SESSION_MISMATCH','Projection refers to another original signed Session');
    return Object.freeze({session:observed.session, projection:observed.record});
  }
  captureOriginalProjectedAuthority(original, scopes, productId) {
    return this.#store.withOriginalProjectedAuthority(state=>this.#captureOriginalState(state,original,scopes,productId));
  }
  // INTERNAL accepted-device observation, not an HTTP route or effect grant.
  // Both Session/token/current and device signature are checked inside the SAME
  // original writer observation. No caller generation or new enrollment enters.
  readOriginalAcceptedDeviceAuthority(raw, request, scopes, productId) {
    const captured=captureOriginalRecoveryJSON(raw), expected=captureOriginalRecoveryJSON(request), required=captureOriginalRecoveryJSON(scopes);
    exactFields(captured,['session','proof'],'Original accepted-device read');
    exactFields(expected,['method','path','bodyDigest'],'Original fixed device-reader request');
    if(expected.method!=='GET')fail('ORIGINAL_DEVICE_READER_UNAVAILABLE','Accepted-device observer is read-only');
    const checkProof=()=>{
      const at=this.#instant();if(at.getTime()<this.#originalDeviceClockFloor)fail('ORIGINAL_DEVICE_READER_CLOCK_UNAVAILABLE','Accepted-device observation clock regressed');this.#originalDeviceClockFloor=at.getTime();
      const proof=verifyProductSessionProofV2(captured.proof,captured.session,expected,at);
      if(Date.parse(proof.expiresAt)-Date.parse(proof.issuedAt)>30000)fail('ORIGINAL_DEVICE_READER_WINDOW_INVALID','Accepted-device read exceeds finite window');
      return proof;
    };
    return this.#store.withOriginalProjectedAuthority(state=>{
      checkProof();
      const first=this.#captureOriginalState(state,captured.session,required,productId);
      const checked=checkProof();
      const last=this.#captureOriginalState(state,captured.session,required,productId);
      if(canonicalJSON(first)!==canonicalJSON(last))fail('PROJECTION_CHANGED','Accepted-device observation changed');
      checkProof();
      // withOriginalProjectedAuthority performs complete durable identity readback
      // after this callback, including any mutation by the final clock observer.
      return captureOriginalRecoveryJSON({version:'ynx-original-accepted-device-observation/v1',captured:last,request:expected,proofExpiresAt:checked.expiresAt,readOnly:true,effectAuthorized:false});
    });
  }
  // Internal durable reservation only, not an action approval or write grant.
  // Original product still verifies the raw exact Action-Proof and consumes its
  // own original nonce WITH its business effect. No new HTTP route is added.
  reserveOriginalProjectedOperation(captured, input, scopes, productId) {
    exactFields(captured,['session','projection'],'Original captured authority');
    if (input?.sessionBinding !== captured.session?.sessionBinding) fail('EFFECT_BINDING_CONFLICT','Operation refers to another original Session');
    return this.#store.reserveOriginalOperation(input,this.#instant(),state=>{
      const fresh = this.#captureOriginalState(state,captured.session,scopes,productId);
      if (canonicalJSON(fresh) !== canonicalJSON(captured)) fail('PROJECTION_CHANGED','Original current observation changed before durable reservation');
    });
  }
  // Internal original product transport only; no new public handler. Mature
  // device Action-Proof verification is retained, separately from the fixed
  // producer's durable full Node/work mapping authentication.
  reserveOriginalMappedProjectedOperation(captured,input,rawOriginal,scopes,productId) {
    const originalCaptured=captureOriginalRecoveryJSON(captured);
    const originalIdentity=captureOriginalRecoveryIdentity(input);
    const originalScopes=captureOriginalRecoveryJSON(scopes);
    exactFields(originalCaptured,['session','projection'],'Original captured authority');
    exactFields(rawOriginal,['mapping','proof'],'Original mapped reservation proof');
    const original=Object.freeze({mapping:parseOriginalOperationMapping(rawOriginal.mapping),proof:Object.freeze(JSON.parse(canonicalJSON(rawOriginal.proof)))});
    const mapping=original.mapping;
    if (mapping.sessionBinding !== originalCaptured.session.sessionBinding) fail('EFFECT_BINDING_CONFLICT','Mapped request refers to another original Session');
    const proof=verifyProductSessionProofV2(original.proof,originalCaptured.session,{method:mapping.method,path:mapping.path,bodyDigest:mapping.wireDigest},this.#instant());
    if (proof.nonce !== mapping.actionNonce) fail('EFFECT_BINDING_CONFLICT','Durable mapping differs from the verified original action nonce');
    return this.#store.reserveOriginalMappedOperation(originalIdentity,original,this.#instant(),state=>{
      const fresh=this.#captureOriginalState(state,originalCaptured.session,originalScopes,productId);
      if (canonicalJSON(fresh) !== canonicalJSON(originalCaptured)) fail('PROJECTION_CHANGED','Original current changed before mapped reservation');
      verifyProductSessionProofV2(original.proof,originalCaptured.session,{method:mapping.method,path:mapping.path,bodyDigest:mapping.wireDigest},this.#instant());
    });
  }
  // Internal fixed prepared-publication entry. No HTTP route/scope is added.
  // Original product preparation must already exist without business nonce or
  // provider dispatch. Node identities are produced here, never supplied by UI.
  // NEW source-versioned INTERNAL entry. No HTTP route/registration activation.
  // Backend proof is a new explicit purpose, never browser-revalidate proof.
  // Source-only dispatcher release fence. Does not consume another nonce,
  // reserve, renew, confirm a terminal or send a provider request.
  assertOriginalRegisteredOperationRelease(rawAuthenticated) {
    if (!this.#backendOperationAuth) fail('ORIGINAL_OPERATION_REGISTRATION_UNAVAILABLE','Registered purpose unavailable');
    const request=captureOriginalRecoveryJSON(rawAuthenticated);
    const capability=this.#backendOperationAuth.authenticate(request,request.body);
    if(request.body.purpose==='prepared-publication/v1') {
      this.#store.withOriginalProjectedAuthority(state=>{
        const read=()=>{const value=this.#captureOriginalState(state,request.body.captured.session,request.body.requiredScopes,request.body.productId);if(canonicalJSON(value)!==canonicalJSON(request.body.captured))fail('PROJECTION_CHANGED','Original publication changed before release');};
        read();this.#backendOperationAuth.assertCurrent(capability);read();
      });
    } else this.#backendOperationAuth.assertCurrent(capability);
  }
  publishOriginalRegisteredPreparedProjectedOperation(captured,descriptor,actionProof,scopes,productId,backendProof) {
    if (!this.#backendOperationAuth || typeof this.#originalMappingProducer!=='function') fail('ORIGINAL_OPERATION_REGISTRATION_UNAVAILABLE','Registered prepared publication is not configured');
    const body=captureOriginalRecoveryJSON({purpose:'prepared-publication/v1',captured,preparation:descriptor,actionProof,requiredScopes:scopes,productId});
    const signed=captureOriginalRecoveryJSON(backendProof);
    const capability=this.#backendOperationAuth.authenticate({body,proof:signed},body);
    const raw=captureOriginalRecoveryJSON({preparation:{productOperationId:body.preparation.productOperationId,sessionBinding:body.preparation.sessionBinding},proof:body.actionProof});
    const current=state=>{
      const checked=this.#captureOriginalState(state,body.captured.session,body.requiredScopes,body.productId);
      if(canonicalJSON(checked)!==canonicalJSON(body.captured))fail('PROJECTION_CHANGED','Registered publication original authority changed');
      this.#backendOperationAuth.assertCurrent(capability);
    };
    const mapping=this.#store.withOriginalProjectedAuthority(state=>{
      current(state);
      const value=this.#originalMappingProducer(state,raw);
      if(value&&typeof value.then==='function')fail('PROJECTION_READER_ASYNC','Prepared source cannot await under original writer');
      const mapping=parseOriginalOperationMapping(value);
      for(const field of ['productOperationId','sessionBinding','method','path','wireDigest'])if(mapping[field]!==body.preparation[field])fail('ORIGINAL_OPERATION_BODY_MISMATCH','Authenticated backend descriptor differs from durable original preparation');
      return mapping;
    });
    const identity=captureOriginalRecoveryIdentity({operationId:mapping.operationId,sessionBinding:mapping.sessionBinding,requestDigest:mapping.requestDigest});
    const admission=this.#store.reserveOriginalMappedOperation(identity,raw,this.#instant(),current,capability);
    return captureOriginalRecoveryJSON({mapping,admission});
  }
  publishOriginalPreparedProjectedOperation(captured,preparation,proof,scopes,productId) {
    if (typeof this.#originalMappingProducer!=='function') fail('ORIGINAL_MAPPING_PRODUCER_UNAVAILABLE','No original prepared mapping producer is configured');
    const originalCaptured=captureOriginalRecoveryJSON(captured);
    const originalScopes=captureOriginalRecoveryJSON(scopes);
    const raw=captureOriginalRecoveryJSON({preparation,proof});
    exactFields(originalCaptured,['session','projection'],'Original captured prepared authority');
    if (raw.preparation.sessionBinding!==originalCaptured.session.sessionBinding) fail('EFFECT_BINDING_CONFLICT','Preparation refers to another original Session');
    const mapping=this.#store.withOriginalProjectedAuthority(state=>{
      const current=this.#captureOriginalState(state,originalCaptured.session,originalScopes,productId);
      if (canonicalJSON(current)!==canonicalJSON(originalCaptured)) fail('PROJECTION_CHANGED','Original current changed before prepared publication');
      const value=this.#originalMappingProducer(state,raw);
      if (value&&typeof value.then==='function') fail('PROJECTION_READER_ASYNC','Original captured preparation cannot await under writer');
      return parseOriginalOperationMapping(value);
    });
    const identity=captureOriginalRecoveryIdentity({operationId:mapping.operationId,sessionBinding:mapping.sessionBinding,requestDigest:mapping.requestDigest});
    const admission=this.#store.reserveOriginalMappedOperation(identity,raw,this.#instant(),state=>{
      const current=this.#captureOriginalState(state,originalCaptured.session,originalScopes,productId);
      if (canonicalJSON(current)!==canonicalJSON(originalCaptured)) fail('PROJECTION_CHANGED','Original current changed before prepared UNKNOWN publication');
      verifyProductSessionProofV2(raw.proof,originalCaptured.session,{method:mapping.method,path:mapping.path,bodyDigest:mapping.wireDigest},this.#instant());
    });
    return Object.freeze({mapping,admission});
  }
  // INTERNAL versioned confidential reader only. Independent fixed registered
  // source authenticates original owner/device; no current-first dispatch gate,
  // no expiry relaxation, provider call, replacement key or terminal adoption.
  readOriginalRegisteredMappedOperation(input,rawAuthenticated) {
    const identity=captureOriginalRecoveryIdentity(input),signed=captureOriginalRecoveryJSON(rawAuthenticated);
    return this.#store.readOriginalRegisteredMappedOperation(identity,signed,this.#instant());
  }
  readOriginalUnexpiredMappedOperation(input,rawProof,rawRequestBody) {
    const identity=captureOriginalRecoveryIdentity(input);
    const bytes=captureOriginalReaderBytes(rawRequestBody);
    const proof=captureOriginalRecoveryJSON(rawProof);
    return this.#store.readOriginalUnexpiredMappedOperation(identity,proof,bytes,this.#instant());
  }
  confirmOriginalMappedProjectedOperation(operationId,rawReadback) {
    return this.#store.confirmOriginalMappedOperation(operationId,rawReadback);
  }
  assertOriginalProjectedAuthority(captured, scopes, productId) {
    exactFields(captured,['session','projection'],'Original captured authority');
    const fresh = this.captureOriginalProjectedAuthority(captured.session,scopes,productId);
    if (canonicalJSON(fresh) !== canonicalJSON(captured)) fail('PROJECTION_CHANGED','Original writer observation changed');
    return fresh;
  }
  // No current-first guard here: exact admitted records survive revoke/expiry.
  // Authentication is an independent construction-time original reader, and
  // this path never dispatches a provider or allocates a replacement operation.
  readOriginalProjectedOperation(input, rawOriginalReaderProof) {
    return this.#store.readOriginalOperation(input,rawOriginalReaderProof,this.#instant());
  }
  confirmOriginalProjectedOperation(operationId, rawOriginalReadback) {
    return this.#store.confirmOriginalOperation(operationId,rawOriginalReadback);
  }
  captureOriginalWalletServiceRuntimeSource(){
    this.#store.snapshot();
    const registryRaw=canonicalJSON(this.#registry);
    const view=Object.freeze({handler:this.handler(),registryRaw,registryDigest:createHash('sha256').update(registryRaw).digest('hex')});
    const source=Object.freeze({});
    originalControlRuntimeSources.set(source,{view,assertCurrent:()=>{
      this.#store.snapshot();
      if(canonicalJSON(this.#registry)!==registryRaw)fail('ORIGINAL_RUNTIME_SOURCE_CHANGED','Original control Host registry changed');
    }});return source;
  }

  handler() {
    return async (request, response) => {
      const requestId = validRequestId(request.headers["x-request-id"]) ? request.headers["x-request-id"] : "req_invalid_request_000";
      let cors = {}, route = "";
      try {
        route = pathname(request.url); cors = this.#cors(request.headers.origin, route);
        this.#store.snapshot();
        if (!ROUTES.has(route)) fail("ROUTE_NOT_FOUND", "Product Session control route is not registered");
        if (request.method === "OPTIONS") {
          if (!Object.keys(cors).length) fail("ORIGIN_NOT_ALLOWED", "Preflight requires an allowed origin");
          const method = READ_ROUTES.has(route) ? "GET" : "POST";
          if (request.headers["access-control-request-method"] !== method) fail("METHOD_NOT_ALLOWED", "Preflight method does not match this route");
          const requested = single(request.headers["access-control-request-headers"]).split(",").map(value => value.trim().toLowerCase());
          const allowed = headersFor(route).split(", ");
          if (!requested.length || new Set(requested).size !== requested.length || requested.some(header => !allowed.includes(header))) fail("INVALID_CORS_REQUEST", "Preflight headers are not allowed");
          response.writeHead(204, { ...cors, "cache-control": "no-store", "access-control-allow-methods": method, "access-control-allow-headers": headersFor(route), "access-control-max-age": "300" }); response.end(); return;
        }
        if (route === CAPABILITIES) {
          if (request.method !== "GET") fail("METHOD_NOT_ALLOWED", "Control capabilities accepts GET only");
          if (!validRequestId(request.headers["x-request-id"])) fail("INVALID_REQUEST_ID", "Control capabilities requires a valid request ID");
          send(response, 200, requestId, { ok: true, result: { productSessionStateVersion: 3, controlIntentCapacity: productSessionControlPublicCapacityPolicy(this.#capacityPolicy) } }, cors); return;
        }
        if (route === TIME) {
          if (request.method !== "GET") fail("METHOD_NOT_ALLOWED", "Authority time accepts GET only");
          if (!validRequestId(request.headers["x-request-id"])) fail("INVALID_REQUEST_ID", "Authority time requires a valid request ID");
          const now = this.#instant();
          if (now.getTime() < productSessionControlClockFloor(this.#store.snapshot())) fail("CLOCK_UNAVAILABLE", "Authority time is behind the durable control history");
          send(response, 200, requestId, { ok: true, result: { serverTime: now.toISOString() } }, cors); return;
        }
        if (request.method !== "POST") fail("METHOD_NOT_ALLOWED", "Product Session control accepts POST only");
        const body = await boundedBody(request), proofHeader = nullable(request.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2]), walletControlProofHeader = nullable(request.headers[WALLET_SESSION_CONTROL_PROOF_HEADER]);
        this.#originBinding(request.headers.origin, route, body, proofHeader);
        let decisionAt;
        const committed = this.#store.transact(snapshot => {
          decisionAt = this.#instant();
          const candidate = new ProductSessionGatewayHttpHandler(this.#registry, this.#tokens, snapshot, this.#capacityPolicy);
          const value = candidate.handle({ requestId, method: request.method, path: route, contentType: single(request.headers["content-type"]), body, proofHeader, walletControlProofHeader, networkAvailable: true }, decisionAt);
          return { snapshot: candidate.snapshot(), value };
        });
        let value = committed.value;
        if (WALLET_SESSION_CONTROL_INTENT_PATHS.includes(route) && value.status === 200) {
          const payload = JSON.parse(value.body), prepared = payload.result;
          if (payload.ok !== true || prepared?.status !== "prepared" || prepared.revocationConfirmed !== false) fail("INVALID_CONTROL_RESULT", "Control kernel did not produce an unconfirmed preparation");
          const proof = decodeWalletSessionControlProofHeader(walletControlProofHeader);
          const intent = parseProductSessionControlIntent({ account: proof.account, operation: route.endsWith("/revoke-all") ? "account-logout" : "device-logout", body: JSON.parse(body) });
          const confirmed = observeDurableProductSessionControlIntent(committed.snapshot, intent, decisionAt);
          if (!confirmed.revocationConfirmed || canonicalJSON(confirmed.receipt) !== canonicalJSON(prepared.preparedReceipt)) fail("INVALID_CONTROL_RESULT", "Durable readback does not confirm the exact prepared intent");
          this.#store.assertOriginalIntentEffectObligationsClosed(intent);
          value = { ...value, body: canonicalJSON({ ...payload, result: confirmed }) };
        }
        response.writeHead(value.status, { ...value.headers, ...cors }); response.end(value.body);
      } catch (caught) {
        if (response.headersSent || response.destroyed) { response.destroy?.(); return; }
        const error = publicError(caught);
        const uncertain = WALLET_SESSION_CONTROL_INTENT_PATHS.includes(route) && (error.code.startsWith("STATE_") || error.code === "EFFECT_OUTCOME_UNKNOWN");
        send(response, error.status, requestId, { ok: false, error: { code: error.code, message: error.message }, ...(uncertain ? { status: "unknown", revocationConfirmed: false } : {}) }, cors);
      }
    };
  }
  #instant() { const now = this.#now(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("INVALID_TIME", "Authority time is unavailable"); return now; }
  #cors(value, route) {
    if (value === undefined) return {};
    if (typeof value !== "string") fail("ORIGIN_NOT_ALLOWED", "Origin is invalid");
    let parsed; try { parsed = new URL(value); } catch { fail("ORIGIN_NOT_ALLOWED", "Origin is invalid"); }
    if (parsed.protocol !== "https:" || parsed.origin !== value) fail("ORIGIN_NOT_ALLOWED", "Origin must be a canonical HTTPS origin");
    const allowed = OWNER_ROUTES.has(route) ? value === WALLET : this.#origins.has(value) || READ_ROUTES.has(route) && value === WALLET;
    if (!allowed) fail("ORIGIN_NOT_ALLOWED", "Origin is not allowed for this route");
    return { "access-control-allow-origin": value, "access-control-expose-headers": "x-request-id", vary: "origin" };
  }
  #originBinding(origin, route, body, proofHeader) {
    if (origin === undefined || OWNER_ROUTES.has(route)) return;
    let bound;
    if (["/v2/product-sessions/challenge", "/v2/product-sessions/complete"].includes(route)) {
      let parsed; try { parsed = JSON.parse(body); } catch { fail("INVALID_BODY", "Product Session body is invalid JSON"); }
      bound = parsed?.request?.origin;
    } else { if (proofHeader === null) return; bound = decodeProductSessionGatewayProofHeaderV2(proofHeader).origin; }
    if (bound !== origin) fail("ORIGIN_NOT_ALLOWED", "Browser origin differs from the exact Product Session binding");
  }
}
function headersFor(route) { return `content-type, x-request-id, ${OWNER_ROUTES.has(route) ? WALLET_SESSION_CONTROL_PROOF_HEADER : PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2}`; }
function send(response, status, requestId, payload, cors) { response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId, ...cors }); response.end(canonicalJSON({ ...payload, requestId, schemaVersion: 2 })); }
function publicError(error) {
  if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Control host failed closed; no revocation confirmation is available" };
  const status = ["EFFECT_OUTCOME_UNKNOWN", "CLOCK_UNAVAILABLE", "STATE_DURABILITY_UNCERTAIN", "STATE_WRITE_FAILED", "STATE_READ_FAILED", "STATE_WRITER_BUSY"].includes(error.code) ? 503 : error.code === "ORIGIN_NOT_ALLOWED" ? 403 : error.code === "ROUTE_NOT_FOUND" ? 404 : error.code === "METHOD_NOT_ALLOWED" ? 405 : error.code === "BODY_TOO_LARGE" ? 413 : error.code.startsWith("STATE_") ? 500 : 400;
  return { status, code: error.code, message: error.message.slice(0, 300) };
}
function pathname(value) { let url; try { url = new URL(value, "http://127.0.0.1"); } catch { fail("INVALID_PATH", "Control URL is invalid"); } if (url.search || url.hash) fail("INVALID_PATH", "Control URL cannot have query or fragment"); return url.pathname; }
function validRequestId(value) { return typeof value === "string" && /^req_[A-Za-z0-9_-]{12,80}$/.test(value); }
function single(value) { return typeof value === "string" ? value : ""; }
function nullable(value) { return value === undefined ? null : single(value); }
async function boundedBody(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 1_048_576) fail("BODY_TOO_LARGE", "Control body exceeds policy"); chunks.push(chunk); } return Buffer.concat(chunks).toString("utf8"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
