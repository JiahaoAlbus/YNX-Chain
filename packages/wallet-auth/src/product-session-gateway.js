import {p256} from '@noble/curves/nist.js';
import {decodeBase64url} from './base64url.js';
import {PRODUCT_SESSION_RETURN_VERSION,parseProductSessionReturns} from './product-session-return-record.js';
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, parseProductSessionGatewaySnapshot } from "./product-session-gateway-snapshot-v2.js";
export { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, parseProductSessionGatewaySnapshot, migrateProductSessionGatewaySnapshotV1 } from "./product-session-gateway-snapshot-v2.js";
import { assertProductSessionControlApprovalAllowed, assertProductSessionControlPlanBase, assertProductSessionControlSessionAllowed, parseProductSessionControlIntent, parseProductSessionControlSnapshot, prepareProductSessionControlIntent, productSessionControlClockFloor, projectProductSessionControlSnapshotV2 } from "./product-session-control-intent.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { httpBodyDigest } from "./session-proof.js";
import { assertProductSessionControlOwnerAdmission, parseProductSessionControlCapacityPolicy } from "./product-session-control-capacity.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";
import { deviceBinding, parseProductSession, parseProductSessionApproval, parseProductSessionChallenge, productSessionApprovalDigest, ProductSessionAuthority, parseProductSessionAuthoritySnapshot } from "./product-session-v2.js";
import { productSessionProofV2Digest, verifyProductSessionProofV2 } from "./product-session-proof-v2.js";
import {readAccountPolicyObservation,assertSessionAccountPolicy} from './product-session-account-private.js';
import { verifyWalletSessionControlProof, walletSessionControlReplayKey, walletSessionControlReplayExpiry, walletSessionControlClockAnchor, walletSessionControlClockAnchorTime, walletSessionControlClockFloor, WALLET_SESSION_CONTROL_PATHS, WALLET_SESSION_CONTROL_INTENT_PATHS } from "./wallet-session-control.js";

const INPUT_FIELDS = ["requestId", "method", "path", "body", "proof", "networkAvailable"];
const IDEMPOTENT_PATHS = new Set(["/v2/product-sessions/challenge", "/v2/product-sessions/complete"]);

export class ProductSessionGatewayKernel {
  #returns=null;
  #accountContext; #registry; #authority; #tokens; #proofs; #idempotency; #audit; #controlIntents; #deviceScopes; #capacityPolicy;
  constructor(registryInput, tokenFactory, snapshot, capacityPolicy, accountContext = null) {
    this.#accountContext = accountContext;
    this.#capacityPolicy = parseProductSessionControlCapacityPolicy(capacityPolicy);
    this.#registry = parseProductSessionRegistry(registryInput);
    if (typeof tokenFactory !== "function") fail("INVALID_RANDOM_SOURCE", "Product Session Gateway requires a cryptographic challenge source");
    this.#tokens = () => { const value = tokenFactory(); if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(value)) fail("INVALID_RANDOM_SOURCE", "Gateway challenge source returned an invalid token"); return value; };
    const parsed = snapshot === undefined
      ? Object.freeze({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority: new ProductSessionAuthority(this.#registry).snapshot(), consumedProofs: Object.freeze([]), idempotency: Object.freeze([]), audit: Object.freeze([]) })
      : snapshot.schemaVersion === 3 ? parseProductSessionControlSnapshot(snapshot) : parseProductSessionGatewaySnapshot(snapshot);
    this.#controlIntents = parsed.schemaVersion === 3 ? [...parsed.controlIntents] : null;
    this.#deviceScopes = parsed.schemaVersion === 3 ? [...parsed.authority.revokedDeviceScopes] : [];
    const legacy = parsed.schemaVersion === 3 ? projectProductSessionControlSnapshotV2(parsed) : parsed;
    this.#authority = new ProductSessionAuthority(this.#registry, legacy.authority, this.#accountContext);
    this.#returns=parsed.returnPublications??null;
    this.#proofs = [...parsed.consumedProofs]; this.#idempotency = [...parsed.idempotency]; this.#audit = [...parsed.audit];
  }

  // Trusted server-only read: no device proof replay, no new grant, no writes.
  revalidate(sessionInput, requiredScopes, productId, at = new Date(), businessRevalidation = false) {
    const session=parseProductSession(sessionInput);
    if(typeof businessRevalidation!=='boolean'||session.productId!==productId||(!businessRevalidation&&session.platform!=='web'))fail('CROSS_PRODUCT_SESSION','Backend cannot inspect another registered product or an unregistered platform');
    const current=this.#authority.snapshot().sessions.find(value=>value.sessionBinding===session.sessionBinding);
    if(!current||canonicalJSON(current)!==canonicalJSON(session))fail('CROSS_PRODUCT_SESSION','Revalidation must retain the original complete verified session');
    const lastSeen=this.#controlIntents===null?walletSessionControlClockFloor({consumedProofs:this.#proofs,audit:this.#audit}):productSessionControlClockFloor(this.snapshot());
    if(validDate(at).getTime()<lastSeen)fail('CLOCK_UNAVAILABLE','Revalidation clock is behind original durable history');
    if(this.#controlIntents!==null)assertProductSessionControlSessionAllowed(this.snapshot(),session.sessionBinding,at);
    const {chainId,clientId,platform,applicationId,bundleId,packageId,origin,callback,account,deviceId,deviceKey}=session;
    return this.#authority.introspect(session.sessionBinding,{chainId,productId,clientId,platform,applicationId,bundleId,packageId,origin,callback,account,deviceId,deviceKey,requiredScopes},at);
  }

  dispatch(input, at = new Date()) {
    if(input?.path==='/v2/product-sessions/returns/outcome'&&input?.body?.selector==='YNX-PRODUCT-SESSION-PUBLICATION/v1')return this.#publicationOutcome(input,at);
    const instant = validDate(at);
    const lastSeen = this.#controlIntents === null ? walletSessionControlClockFloor({ consumedProofs: this.#proofs, audit: this.#audit }) : productSessionControlClockFloor(this.snapshot());
    const clockRegressed = instant.getTime() < lastSeen, auditTime = new Date(Math.max(instant.getTime(), lastSeen));
    const requiresAnchor = this.#proofs.some(value => walletSessionControlReplayExpiry(value) !== null || walletSessionControlClockAnchorTime(value) !== null);
    const withoutAnchors = this.#proofs.filter(value => walletSessionControlClockAnchorTime(value) === null);
    const anchorAtCapacity = requiresAnchor && withoutAnchors.length >= 20_000;
    if (requiresAnchor && !anchorAtCapacity) this.#proofs = [...withoutAnchors, walletSessionControlClockAnchor(auditTime)].sort();
    if (!clockRegressed && !anchorAtCapacity) {
      const sessions = new Map(this.#authority.snapshot().sessions.map(session => [session.sessionBinding,session]));
      this.#idempotency = this.#idempotency.filter((item) => {
        if (item.expiresAt > instant.toISOString()) return true;
        if (item.path !== "/v2/product-sessions/challenge") return false;
        // A lost completion response may outlive the short challenge window.
        // Keep its exact original challenge while the corresponding session can
        // still be recovered. Retain revoked entries too so retries are rejected
        // by current authority instead of creating a different challenge.
        const challenge = JSON.parse(item.responseBody).result;
        const session = sessions.get(digestHex("YNX_PRODUCT_SESSION_BINDING_V2",challenge));
        return session !== undefined && session.expiresAt > instant.toISOString();
      });
      this.#proofs = this.#proofs.filter(value => { const expires = walletSessionControlReplayExpiry(value); return expires === null || expires > instant.getTime(); });
    }
    let requestId = "req_invalid_request_000";
    const beforeReturns=this.#returns;
    const beforeAuthority = this.#authority.snapshot();
    const beforeIntents = this.#controlIntents, beforeScopes = this.#deviceScopes;
    const beforeProofs = [...this.#proofs];
    const beforeIdempotency = [...this.#idempotency];
    try {
      const request = parseInput(input); requestId = request.requestId;
      if (anchorAtCapacity) fail("CAPACITY", "Wallet session control cannot preserve its durable clock at the current replay capacity");
      if (clockRegressed) fail("CLOCK_UNAVAILABLE", "Product Session authority clock moved behind its durable history");
      if (!request.networkAvailable) fail("NETWORK_UNAVAILABLE", "Product Session Gateway network dependency is unavailable");
      const walletControl = WALLET_SESSION_CONTROL_PATHS.includes(request.path) || WALLET_SESSION_CONTROL_INTENT_PATHS.includes(request.path);
      if (walletControl ? request.proof !== null : request.walletControlProof != null) fail("UNEXPECTED_PROOF", "Wallet owner and product device proofs cannot be interchanged");
      if (IDEMPOTENT_PATHS.has(request.path) && request.proof !== null) fail("UNEXPECTED_PROOF", "Challenge and completion do not accept a Product Session proof");
      const bodyDigest = httpBodyDigest(canonicalJSON(request.body));
      const cached = this.#idempotency.find((item) => item.requestId === request.requestId);
      if (cached) {
        if (cached.path !== request.path || cached.bodyDigest !== bodyDigest) fail("IDEMPOTENCY_CONFLICT", "Product Session request ID was reused with a different route or body");
        this.#assertCachedResponseUsable(cached, request, instant);
        this.#record(requestId, request.path, "idempotent", null, cached.subject, instant);
        return cachedResponse(cached.responseBody, requestId);
      }
      const result = this.#route(request, instant);
      const completed = response(200, requestId, { ok: true, result });
      if (IDEMPOTENT_PATHS.has(request.path)) {
        if (this.#idempotency.length >= 20_000) fail("CAPACITY", "Product Session idempotency store is at capacity");
        const subject = result?.sessionBinding ?? result?.challenge ?? "none";
        this.#idempotency.push(Object.freeze({ requestId, path: request.path, bodyDigest, responseBody: completed.body, subject, expiresAt: result.expiresAt }));
        this.#idempotency.sort((left, right) => left.requestId.localeCompare(right.requestId));
      }
      this.#record(requestId, request.path, "ok", null, result?.preparedReceipt?.intentDigest ?? result?.sessionBinding ?? result?.session?.sessionBinding ?? result?.revoked ?? result?.reference ?? (typeof result?.challenge==='string'?result.challenge:'none'), instant);
      return completed;
    } catch (error) {
      this.#returns=beforeReturns;
      this.#authority = new ProductSessionAuthority(this.#registry, beforeAuthority, this.#accountContext);
      this.#controlIntents = beforeIntents; this.#deviceScopes = beforeScopes;
      this.#proofs = beforeProofs;
      this.#idempotency = beforeIdempotency;
      const publicError = normalizeError(error);
      this.#record(requestId, auditPath(input?.path), "rejected", publicError.code, "none", auditTime);
      return response(publicError.status, requestId, { ok: false, error: { code: publicError.code, message: publicError.message } });
    }
  }

  // Owning Native dispatcher only. Same original route/Authority checks,
  // without audit/pruning so reconciliation cannot change the old terminal's
  // stateAfterDigest. The response is not a resolution of the old UNKNOWN.
  dispatchOriginalReferenceOutcome(input,at=new Date()){
    let requestId='req_invalid_request_000';
    try{
      const request=parseInput(input);requestId=request.requestId;const instant=validDate(at);
      if(request.path!=='/v2/product-sessions/returns/outcome'||request.proof!==null||request.walletControlProof!=null)fail('ORIGINAL_PRIVATE_REQUEST_INVALID','Native readonly lookup requires the original reference outcome');
      const floor=this.#controlIntents===null?walletSessionControlClockFloor({consumedProofs:this.#proofs,audit:this.#audit}):productSessionControlClockFloor(this.snapshot());
      if(instant.getTime()<floor)fail('CLOCK_UNAVAILABLE','Native lookup is behind durable history');
      if(!request.networkAvailable)fail('NETWORK_UNAVAILABLE','Native lookup requires the original service');
      return response(200,requestId,{ok:true,result:this.#returnRoute(request,instant)});
    }catch(error){const normalized=normalizeError(error);return response(normalized.status,requestId,{ok:false,error:{code:normalized.code,message:normalized.message}});}
  }

  snapshot() {
    const base = { ...(this.#returns?{returnPublications:this.#returns}:{}),schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority: this.#authority.snapshot(), consumedProofs: Object.freeze([...this.#proofs]), idempotency: Object.freeze([...this.#idempotency]), audit: Object.freeze([...this.#audit]) };
    return this.#controlIntents === null ? Object.freeze(base) : Object.freeze({ ...base, schemaVersion: 3, authority: Object.freeze({ ...base.authority, schemaVersion: 3, revokedDeviceScopes: Object.freeze([...this.#deviceScopes]) }), controlIntents: Object.freeze([...this.#controlIntents]) });
  }

  #assertAccountPolicy(subject,at) {
    const context=this.#accountContext;
    if(context?.observation==null){if(context?.required||subject.version==='3')fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Original policy resource is required');return;}
    assertSessionAccountPolicy(subject,readAccountPolicyObservation(context.observation,subject.account,at));
  }

  #assertCachedResponseUsable(cached, request, at) {
    const approval = this.#controlIntents === null
      ? parseProductSessionApproval(this.#registry, request.body.request, request.body.approval, at, this.#accountContext?.verifiedApproval ?? null)
      : assertProductSessionControlApprovalAllowed(this.snapshot(), this.#registry, request.body.request, request.body.approval, at, this.#accountContext?.verifiedApproval ?? null);
    this.#assertAccountPolicy(approval,at);
    const snapshot = this.#authority.snapshot();
    if (snapshot.revokedDevices.includes(deviceBinding(approval, approval.account)) || snapshot.revokedAccounts.some((item) => item.account === approval.account && approval.issuedAt <= item.before)) fail("SESSION_REVOKED", "Wallet approval or its product device binding was revoked");
    const result = JSON.parse(cached.responseBody).result;
    let session;
    if (cached.path === "/v2/product-sessions/complete") {
      session = parseProductSession(result);
    } else {
      const challenge = parseProductSessionChallenge(result);
      const issued = snapshot.issuedChallenges.find((item) => item.challenge === challenge.challenge);
      if (issued && canonicalJSON(issued) === canonicalJSON(challenge)) return;
      // SDK recovery retries challenge before complete after a lost response.
      // A consumed challenge remains recoverable only through its live session.
      session = snapshot.sessions.find((item) => item.sessionBinding === digestHex("YNX_PRODUCT_SESSION_BINDING_V2", challenge));
      if (!session) fail("CHALLENGE_NOT_ISSUED", "Cached Product Session challenge is no longer available");
    }
    // Keep the immutable historical completion receipt, but never expose its
    // success as current authority after revocation. Active retries stay exact.
    if (this.#controlIntents !== null) assertProductSessionControlSessionAllowed(this.snapshot(), session.sessionBinding, at);
    this.#authority.introspect(session.sessionBinding, {
      chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform,
      applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId,
      origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId,
      deviceKey: session.deviceKey, requiredScopes: [],
    }, at);
  }

  #route(request, at) {
    if(request.path.startsWith("/v2/product-sessions/returns"))return this.#returnRoute(request,at);
    if (WALLET_SESSION_CONTROL_INTENT_PATHS.includes(request.path)) return this.#walletIntent(request, at);
    if (WALLET_SESSION_CONTROL_PATHS.includes(request.path)) return this.#walletControl(request, at);
    if (request.path === "/v2/product-sessions/challenge") {
      if (request.proof !== null) fail("UNEXPECTED_PROOF", "Challenge issuance does not accept a Product Session proof");
      exactFields(request.body, ["request", "approval"], "Product Session Gateway challenge body");
      if (this.#controlIntents !== null) {
        const snapshot = this.snapshot();
        const approval = assertProductSessionControlApprovalAllowed(snapshot, this.#registry, request.body.request, request.body.approval, at, this.#accountContext?.verifiedApproval ?? null);
        assertProductSessionControlOwnerAdmission(snapshot, approval.account, this.#capacityPolicy);
      }
      return this.#authority.issueChallenge({ request: request.body.request, approval: request.body.approval, challenge: this.#tokens() }, at);
    }
    if (request.path === "/v2/product-sessions/complete") {
      if (request.proof !== null) fail("UNEXPECTED_PROOF", "Session completion does not accept an existing Product Session proof");
      exactFields(request.body, ["request", "approval", "completion"], "Product Session Gateway completion body");
      if (this.#controlIntents !== null) assertProductSessionControlApprovalAllowed(this.snapshot(), this.#registry, request.body.request, request.body.approval, at, this.#accountContext?.verifiedApproval ?? null);
      const completed=this.#authority.complete(request.body, at);this.#markReturnCompleted(request.body,completed);return completed;
    }
    if (request.path === "/v2/product-sessions/introspect") {
      exactFields(request.body, ["requiredScopes"], "Product Session introspection body");
      return this.#authorize(request, request.body.requiredScopes, at);
    }
    if (request.path === "/v2/product-sessions/revoke") {
      exactFields(request.body, [], "Product Session revoke body");
      const authorized = this.#authorize(request, [], at); this.#authority.revokeSession(authorized.session.sessionBinding); return Object.freeze({ revoked: authorized.session.sessionBinding });
    }
    if (request.path === "/v2/product-sessions/devices/revoke") {
      exactFields(request.body, [], "Product Session device revoke body");
      const authorized = this.#authorize(request, [], at); this.#authority.revokeDevice(authorized.session.deviceBinding); return Object.freeze({ revoked: authorized.session.deviceBinding });
    }
    fail("ROUTE_NOT_FOUND", "Product Session Gateway route is not registered");
  }

  returnPublication(reference){
    const row=this.#returns?.records.find(r=>r.reference===reference);if(!row)return null;
    return Object.freeze({requestRaw:row.requestRaw,approvalRaw:row.approvalRaw,completed:row.status==='completed'});
  }
  returnPublicationByRequestId(requestId){const row=this.#returns?.records.find(r=>r.requestId===requestId);return row?this.returnPublication(row.reference):null;}
  returnPublicationSessionByRequestId(requestId){const row=this.#returns?.records.find(r=>r.requestId===requestId);return row?this.returnPublicationSession(row.reference):null;}
  #publicationOutcome(input,at){
    let requestId='req_invalid_request_000';
    try{
      const request=parseInput(input);requestId=request.requestId;const instant=validDate(at);
      if(!request.networkAvailable)fail('NETWORK_UNAVAILABLE','Publication read requires the normal service');
      if(request.proof!==null||request.walletControlProof!=null)fail('UNEXPECTED_PROOF','Publication recovery uses the full original Wallet approval');
      if(this.#accountContext?.required!==true)fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Publication recovery requires the original current Source');
      const floor=this.#controlIntents===null?walletSessionControlClockFloor({consumedProofs:this.#proofs,audit:this.#audit}):productSessionControlClockFloor(this.snapshot());
      if(instant.getTime()<floor)fail('CLOCK_UNAVAILABLE','Publication recovery is behind durable authority history');
      const body=request.body;exactFields(body,['selector','publicationRequestId','request','approval'],'Original publication recovery selector');
      if(body.selector!=='YNX-PRODUCT-SESSION-PUBLICATION/v1'||typeof body.publicationRequestId!=='string'||!/^req_[A-Za-z0-9_-]{12,80}$/.test(body.publicationRequestId)||body.approval?.version!=='3'||new TextEncoder().encode(canonicalJSON({request:body.request,approval:body.approval})).length>196608)fail('INVALID_BODY','Publication recovery requires exact bounded original N1 approval');
      this.#assertAccountPolicy(body.approval,instant);
      const row=this.#returns?.records.find(r=>r.requestId===body.publicationRequestId);
      if(!row)return response(200,requestId,{ok:true,result:Object.freeze({state:'not_found',retryAuthorized:false})});
      if(canonicalJSON(body.request)!==row.requestRaw||canonicalJSON(body.approval)!==row.approvalRaw)fail('SESSION_BINDING_MISMATCH','Publication recovery differs from the exact saved original');
      const approval=JSON.parse(row.approvalRaw),state=this.#authority.snapshot(),binding=deviceBinding(approval,approval.account);
      this.#assertAccountPolicy(approval,instant);
      if(state.revokedDevices.includes(binding)||state.revokedAccounts.some(r=>r.account===approval.account&&approval.issuedAt<=r.before)||this.#deviceScopes.some(r=>r.account===approval.account&&r.deviceBinding===binding&&approval.issuedAt<=r.before)||row.sessionBinding&&state.revokedSessions.includes(row.sessionBinding))fail('SESSION_REVOKED','Original publication was revoked');
      if(row.sessionBinding&&this.#controlIntents!==null)assertProductSessionControlSessionAllowed(this.snapshot(),row.sessionBinding,instant);
      return response(200,requestId,{ok:true,result:this.readOriginalReturnPublicationOutcome(body.publicationRequestId)});
    }catch(error){const normalized=normalizeError(error);return response(normalized.status,requestId,{ok:false,error:{code:normalized.code,message:normalized.message}});}
    // Deliberately no audit, nonce, challenge, expiry, cache or state mutation.
  }
  returnPublicationSession(reference){const row=this.#returns?.records.find(r=>r.reference===reference);return row?.sessionBinding?this.#authority.snapshot().sessions.find(s=>s.sessionBinding===row.sessionBinding)??null:null;}
  readOriginalReturnPublicationOutcome(requestId){
    const row=this.#returns?.records.find(r=>r.requestId===requestId);
    if(!row)return Object.freeze({state:'not_found',retryAuthorized:false});
    const approval=JSON.parse(row.approvalRaw);
    return Object.freeze({state:row.status,reference:row.reference,expiresAt:row.expiresAt,requestDigest:approval.requestDigest,account:approval.account,approvalDigest:productSessionApprovalDigest(approval),retryAuthorized:false});
  }
  #setReturn(row){
    const rows=[...(this.#returns?.records??[])],index=rows.findIndex(r=>r.reference===row.reference);
    if(index<0)rows.push(row);else rows[index]=row;
    rows.sort((a,b)=>a.requestId.localeCompare(b.requestId));this.#returns=parseProductSessionReturns({version:PRODUCT_SESSION_RETURN_VERSION,records:rows});
  }
  #markReturnCompleted(body,session){
    const requestRaw=canonicalJSON(body.request),approvalRaw=canonicalJSON(body.approval);
    const row=this.#returns?.records.find(r=>r.requestRaw===requestRaw&&r.approvalRaw===approvalRaw&&r.challengeRaw===canonicalJSON(body.completion.challenge));
    if(row)this.#setReturn({...row,status:'completed',completionRaw:canonicalJSON(body.completion),sessionBinding:session.sessionBinding});
  }
  #returnRoute(request,at){
    if(this.#accountContext?.required!==true)fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Reference returns require the normal current account policy');
    if(request.proof!==null||request.walletControlProof!=null)fail('UNEXPECTED_PROOF','Reference returns use only the original pending device completion');
    const path=request.path,body=request.body;
    if(path==='/v2/product-sessions/returns'){
      exactFields(body,['request','approval'],'Original return publication');
      const approval=parseProductSessionApproval(this.#registry,body.request,body.approval,at,this.#accountContext.verifiedApproval);
      this.#assertAccountPolicy(approval,at);if(approval.version!=='3')fail('PQ_COMPLETION_V3_REQUIRED','Reference return requires full PQ approval');
      const requestRaw=canonicalJSON(body.request),approvalRaw=canonicalJSON(approval),old=this.#returns?.records.find(r=>r.requestId===request.requestId||JSON.parse(r.approvalRaw).requestDigest===approval.requestDigest);
      if(old){if(old.requestRaw!==requestRaw||old.approvalRaw!==approvalRaw)fail('IDEMPOTENCY_CONFLICT','Publication differs from its original approval');return Object.freeze({reference:old.reference,nonce:body.request.nonce,state:body.request.state,expiresAt:old.expiresAt});}
      if((this.#returns?.records.length??0)>=64)fail('CAPACITY','Original pending return capacity is unavailable');
      if(this.#controlIntents!==null)assertProductSessionControlApprovalAllowed(this.snapshot(),this.#registry,body.request,approval,at,this.#accountContext.verifiedApproval);
      const token=this.#tokens();if(token.length!==43)fail('INVALID_RANDOM_SOURCE','Return references require an original 32-byte random token');
      const reference='ynxpsr1_'+token;if(this.#returns?.records.some(r=>r.reference===reference))fail('IDEMPOTENCY_CONFLICT','Original return reference is already selected');
      const challenge=this.#authority.issueChallenge({request:body.request,approval,challenge:this.#tokens()},at);
      this.#setReturn({version:PRODUCT_SESSION_RETURN_VERSION,reference,requestId:request.requestId,requestRaw,approvalRaw,challengeRaw:canonicalJSON(challenge),createdAt:challenge.issuedAt,expiresAt:challenge.expiresAt,status:'pending',completionRaw:null,sessionBinding:null});
      return Object.freeze({reference,nonce:body.request.nonce,state:body.request.state,expiresAt:challenge.expiresAt});
    }
    const challengeRead=path==='/v2/product-sessions/returns/challenge',outcome=path==='/v2/product-sessions/returns/outcome';
    if(!challengeRead&&!outcome&&path!=='/v2/product-sessions/returns/complete')fail('ROUTE_NOT_FOUND','Reference return route is not registered');
    exactFields(body,challengeRead?['reference','request']:['reference','request','completion'],'Original reference return');
    const row=this.#returns?.records.find(r=>r.reference===body.reference);if(!row)fail('RETURN_REFERENCE_NOT_FOUND','Original return reference is unavailable');
    if(canonicalJSON(body.request)!==row.requestRaw)fail('SESSION_BINDING_MISMATCH','Reference crosses its original request');
    const approval=JSON.parse(row.approvalRaw),challenge=parseProductSessionChallenge(JSON.parse(row.challengeRaw));
    this.#assertAccountPolicy(approval,at);
    const state=this.#authority.snapshot(),binding=deviceBinding(approval,approval.account);
    if(state.revokedDevices.includes(binding)||state.revokedAccounts.some(r=>r.account===approval.account&&approval.issuedAt<=r.before)||this.#deviceScopes.some(r=>r.account===approval.account&&r.deviceBinding===binding&&approval.issuedAt<=r.before))fail('SESSION_REVOKED','Original return approval was revoked');
    if(row.status==='pending'&&row.expiresAt<=validDate(at).toISOString())fail('SESSION_EXPIRED','Original reference challenge expired');
    if(challengeRead)return Object.freeze({reference:row.reference,challenge});
    exactFields(body.completion,['challenge','deviceSignature'],'Original return completion');
    if(canonicalJSON(body.completion.challenge)!==row.challengeRaw)fail('SESSION_BINDING_MISMATCH','Reference completion challenge changed');
    let valid=false;try{valid=p256.verify(decodeBase64url(body.completion.deviceSignature,'deviceSignature'),new TextEncoder().encode('YNX_PRODUCT_SESSION_CHALLENGE_V2\n'+canonicalJSON(challenge)),decodeBase64url(challenge.deviceKey,'deviceKey'),{format:'der',lowS:false});}catch{}
    if(!valid)fail('INVALID_DEVICE_PROOF','Reference completion device proof is invalid');
    if(row.status==='completed'){
      if(canonicalJSON(body.completion)!==row.completionRaw)fail('IDEMPOTENCY_CONFLICT','Reference completion differs from its captured original');
      const session=this.#authority.snapshot().sessions.find(s=>s.sessionBinding===row.sessionBinding);if(!session)fail('SESSION_NOT_FOUND','Original completed session is unavailable');
      if(this.#controlIntents!==null)assertProductSessionControlSessionAllowed(this.snapshot(),session.sessionBinding,at);
      if(outcome&&session.expiresAt<=validDate(at).toISOString()){
        // Historical target only, after exact device proof, fresh policy and
        // revocation/control checks. Never an active introspection or grant.
        if(state.revokedSessions.includes(session.sessionBinding))fail('SESSION_REVOKED','Original completed session was revoked');
        if(session.issuedAt>at.toISOString())fail('ISSUED_IN_FUTURE','Original session is ahead of authority time');
        return Object.freeze({state:'expired',session,retryAuthorized:false});
      }
      const {chainId,productId,clientId,platform,applicationId,bundleId,packageId,origin,callback,account,deviceId,deviceKey}=session;
      const live=this.#authority.introspect(session.sessionBinding,{chainId,productId,clientId,platform,applicationId,bundleId,packageId,origin,callback,account,deviceId,deviceKey,requiredScopes:[]},at).session;
      return outcome?Object.freeze({state:'completed',session:live,retryAuthorized:false}):live;
    }
    if(outcome)return Object.freeze({state:'pending',retryAuthorized:false});
    const completeBody={request:body.request,approval,completion:body.completion};
    const session=this.#authority.complete(completeBody,at);this.#markReturnCompleted(completeBody,session);return session;
  }

  #verifyOwner(request, at) {
    if (request.walletControlProof == null) fail("PROOF_REQUIRED", "Wallet account owner proof is required");
    const proof = verifyWalletSessionControlProof(request.walletControlProof, { method: request.method, path: request.path, bodyDigest: httpBodyDigest(canonicalJSON(request.body)) }, at);
    // Existing global account-control proof is classic. An active PQ account
    // cannot use it as a fallback. Device-bound session revocation is separate.
    this.#assertAccountPolicy({version:'2',account:proof.account},at);
    const replayKey = walletSessionControlReplayKey(proof);
    const controlRecords = this.#proofs.filter(value => walletSessionControlReplayExpiry(value) !== null);
    if (controlRecords.some(value => value.slice(28) === replayKey.slice(28))) fail("REPLAY", "Wallet session control nonce was already consumed");
    const needsAnchor = !this.#proofs.some(value => walletSessionControlClockAnchorTime(value) !== null);
    if (controlRecords.length >= 512 || this.#proofs.length + Number(needsAnchor) >= 18_000) fail("CAPACITY", "Wallet session control replay budget is unavailable");
    return { proof, replayKey, needsAnchor };
  }

  #walletIntent(request, at) {
    if (this.#controlIntents === null) fail("CONTROL_STORE_REQUIRED", "Wallet batch logout requires an explicitly migrated version-three store");
    const { proof, replayKey, needsAnchor } = this.#verifyOwner(request, at);
    const intent = parseProductSessionControlIntent({ account: proof.account, operation: request.path.endsWith("/revoke-all") ? "account-logout" : "device-logout", body: request.body });
    const before = this.snapshot(), prepared = prepareProductSessionControlIntent(before, intent, at, undefined, this.#capacityPolicy);
    const candidate = assertProductSessionControlPlanBase(prepared, before, this.#capacityPolicy);
    this.#authority = new ProductSessionAuthority(this.#registry, projectProductSessionControlSnapshotV2(candidate).authority, this.#accountContext);
    this.#deviceScopes = [...candidate.authority.revokedDeviceScopes];
    this.#controlIntents = [...candidate.controlIntents];
    if (needsAnchor) this.#proofs.push(walletSessionControlClockAnchor(at));
    this.#proofs.push(replayKey); this.#proofs.sort();
    // An in-memory kernel cannot attest durable storage. Only the v3 Node
    // transaction boundary may turn this prepared result into confirmation.
    return Object.freeze({ status: "prepared", revocationConfirmed: false, preparedReceipt: prepared.preparedReceipt });
  }

  #walletControl(request, at) {
    const revoke = request.path.endsWith("/revoke");
    exactFields(request.body, revoke ? ["sessionBinding"] : [], "Wallet session control body");
    if (revoke && (typeof request.body.sessionBinding !== "string" || !/^[0-9a-f]{64}$/.test(request.body.sessionBinding))) fail("INVALID_FIELD", "Wallet session control target binding is invalid");
    const { proof, replayKey, needsAnchor } = this.#verifyOwner(request, at);
    const snapshot = this.#authority.snapshot(), asOf = at.toISOString();
    let result;
    if (revoke) {
      const session = snapshot.sessions.find(item => item.sessionBinding === request.body.sessionBinding && item.account === proof.account);
      if (!session) fail("SESSION_NOT_FOUND", "Wallet-owned Product Session was not found");
      const alreadyRevoked = snapshot.revokedSessions.includes(session.sessionBinding);
      if (!alreadyRevoked) this.#authority.revokeSession(session.sessionBinding);
      result = Object.freeze({ account: proof.account, sessionBinding: session.sessionBinding, revoked: true, alreadyRevoked, asOf });
    } else {
      const sessions = snapshot.sessions.filter(session => session.account === proof.account).map(session => {
        const registration = this.#registry.products.find(product => product.productId === session.productId && product.clientId === session.clientId);
        if (!registration) fail("UNKNOWN_PRODUCT", "Stored Product Session registration is unavailable");
        const inactiveReasons = [];
        if (snapshot.revokedSessions.includes(session.sessionBinding)) inactiveReasons.push("session-revoked");
        if (snapshot.revokedDevices.includes(session.deviceBinding)) inactiveReasons.push("device-revoked");
        if (this.#deviceScopes.some(item => item.account === session.account && item.deviceBinding === session.deviceBinding && session.issuedAt <= item.before)) inactiveReasons.push("device-logout");
        if (snapshot.revokedAccounts.some(item => item.account === proof.account && session.issuedAt <= item.before)) inactiveReasons.push("account-revoked");
        if (session.expiresAt <= asOf) inactiveReasons.push("expired");
        if (session.issuedAt > asOf) inactiveReasons.push("issued-in-future");
        return Object.freeze({ sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, displayName: registration.displayName, platform: session.platform, applicationId: session.applicationId, origin: session.origin, callback: session.callback, deviceId: session.deviceId, deviceBinding: session.deviceBinding, scopes: session.scopes, issuedAt: session.issuedAt, expiresAt: session.expiresAt, active: inactiveReasons.length === 0, inactiveReasons: Object.freeze(inactiveReasons) });
      });
      result = Object.freeze({ account: proof.account, asOf, sessions: Object.freeze(sessions) });
    }
    if (needsAnchor) this.#proofs.push(walletSessionControlClockAnchor(at));
    this.#proofs.push(replayKey); this.#proofs.sort();
    return result;
  }

  #authorize(request, requiredScopes, at) {
    if (request.proof === null) fail("PROOF_REQUIRED", "A sender-constrained Product Session proof is required");
    const session = this.#authority.snapshot().sessions.find((item) => item.sessionBinding === request.proof?.sessionBinding);
    if (!session) fail("SESSION_NOT_FOUND", "Product Session was not found");
    const proof = verifyProductSessionProofV2(request.proof, session, { method: request.method, path: request.path, bodyDigest: httpBodyDigest(canonicalJSON(request.body)) }, at);
    const proofDigest = productSessionProofV2Digest(proof);
    if (this.#proofs.includes(proofDigest)) fail("REPLAY", "Product Session proof was already consumed");
    if (this.#proofs.length >= 20_000) fail("CAPACITY", "Product Session proof replay store is at capacity");
    if (this.#controlIntents !== null) assertProductSessionControlSessionAllowed(this.snapshot(), session.sessionBinding, at);
    const result = this.#authority.introspect(session.sessionBinding, { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes }, at);
    this.#proofs.push(proofDigest); this.#proofs.sort(); return result;
  }

  #record(requestId, path, outcome, code, subject, at) {
    if (this.#audit.length >= 20_000) {
      this.#audit.shift();
      this.#audit = this.#audit.map((event, index) => Object.freeze({ ...event, sequence: index + 1 }));
    }
    this.#audit.push(Object.freeze({ sequence: this.#audit.length + 1, requestId, path, outcome, code, subject, at: validDate(at).toISOString() }));
  }
}

function parseInput(input) { exactFields(input, input && Object.hasOwn(input, "walletControlProof") ? [...INPUT_FIELDS, "walletControlProof"] : INPUT_FIELDS, "Product Session Gateway input"); if (typeof input.requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(input.requestId)) fail("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid"); if (input.method !== "POST") fail("METHOD_NOT_ALLOWED", "Product Session Gateway accepts POST only"); if (typeof input.path !== "string" || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(input.path) || input.path.includes("//") || input.path.endsWith("/")) fail("INVALID_PATH", "Product Session Gateway path is invalid"); if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) fail("INVALID_BODY", "Product Session Gateway body must be an object"); if (input.proof !== null && (!input.proof || typeof input.proof !== "object" || Array.isArray(input.proof))) fail("INVALID_PROOF", "Product Session Gateway proof is invalid"); if (input.walletControlProof != null && (typeof input.walletControlProof !== "object" || Array.isArray(input.walletControlProof))) fail("INVALID_PROOF", "Wallet account owner proof is invalid"); if (typeof input.networkAvailable !== "boolean") fail("INVALID_NETWORK_STATE", "Product Session Gateway network state is invalid"); return Object.freeze(input); }
function response(status, requestId, payload) { return Object.freeze({ status, headers: Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId }), body: canonicalJSON({ ...payload, requestId, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }) }); }
function normalizeError(error) { if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Product Session Gateway failed closed" }; const forbidden = ["CROSS_PRODUCT_SESSION", "INVALID_DEVICE_PROOF", "INVALID_SIGNATURE", "SESSION_REVOKED", "SESSION_EXPIRED", "SCOPE_WIDENING", "PROOF_REQUIRED"]; const conflict = ["REPLAY", "ALREADY_REVOKED", "IDEMPOTENCY_CONFLICT", "INTENT_EXPIRED", "STALE_CONTROL_STATE"]; const status = ["NETWORK_UNAVAILABLE", "CLOCK_UNAVAILABLE"].includes(error.code) ? 503 : error.code === "METHOD_NOT_ALLOWED" ? 405 : error.code === "ROUTE_NOT_FOUND" || (error.code === "SESSION_NOT_FOUND" || error.code === "DEVICE_NOT_FOUND") ? 404 : conflict.includes(error.code) ? 409 : forbidden.includes(error.code) ? 403 : 400; return { status, code: error.code, message: error.message.length <= 300 ? error.message : "Product Session Gateway rejected the request" }; }
function auditPath(value) { return typeof value === "string" && /^\/[A-Za-z0-9/_-]{1,255}$/.test(value) && !value.includes("//") && !value.endsWith("/") ? value : "/invalid"; }
function cachedResponse(body, requestId) { return Object.freeze({ status: 200, headers: Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId }), body }); }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Product Session Gateway time is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
