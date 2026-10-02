import {createCentralOIDCProvider,CENTRAL_OIDC_PROTOCOL,CENTRAL_OIDC_ROUTES} from './central-oidc-provider.js';
import {createCentralBackendVerifier,createCentralFamilySeal,backendBodyDigest} from './central-browser-backend-auth.js';
import {centralUIPage} from './central-browser-session-locale.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {walletIdentityFromPublicKey} from './crypto.js';
import {CENTRAL_BROWSER_ISSUER,centralBrowserClient,centralBrowserProfiles,centralBrowserApprovedProfile} from './central-browser-session-registry.js';
import {CENTRAL_BROWSER_PURPOSE,centralBrowserConsentSignBytes,parseCentralBrowserSignInApproval} from './central-browser-session-contract.js';
export {centralBrowserConsentSignBytes,CENTRAL_BROWSER_PURPOSE} from './central-browser-session-contract.js';

export const CENTRAL_BROWSER_COOKIE='__Host-ynx-browser-session';
export const CENTRAL_BROWSER_TRANSACTION_COOKIE='__Host-ynx-browser-transaction';
const hash=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const iso=value=>new Date(value).toISOString();
const SESSION_ABSOLUTE=2*60*60*1000,SESSION_IDLE=30*60*1000,GRANT_LIFETIME=5*60*1000;
export function centralBrowserCookie(value,{transaction=false,clear=false}={}){
  if(!clear&&!token(value))fail('SSO_COOKIE_INVALID');
  // A browser-process restart must not discard an otherwise valid server
  // identity. Persist only the original absolute lease; reads never renew it.
  // The server still independently enforces idle expiry, generation and revoke.
  return `${transaction?CENTRAL_BROWSER_TRANSACTION_COOKIE:CENTRAL_BROWSER_COOKIE}=${clear?'':value}; Path=/; Secure; HttpOnly; SameSite=Lax${clear?'; Max-Age=0':transaction?'; Max-Age=120':`; Max-Age=${SESSION_ABSOLUTE/1000}`}`;
}
export function centralBrowserCookieToken(header,name=CENTRAL_BROWSER_COOKIE){
  if(typeof header!=='string'||header.length>8192)return null;
  const matches=header.split(';').map(value=>value.trim()).filter(value=>value.startsWith(`${name}=`));
  if(matches.length!==1)return null;const value=matches[0].slice(name.length+1);return token(value)?value:null;
}

// Identity-only grants are separate from existing Wallet ProductSession proofs.
// No caller may use this grant to bypass a native/sensitive product scope.
export class CentralBrowserSessionAuthority {
  #store;#registry;#now;#random;#backendVerify;#familySeal;#oidc;#socialConsentClient;
  constructor(registry,store,{now=()=>Date.now(),tokenFactory=random,backendClients=[],familySealKey=null,oidc=null}={}){
    if(!Array.isArray(registry)||!store?.transaction||typeof now!=='function'||typeof tokenFactory!=='function')fail('SSO_AUTHORITY_INVALID');
    this.#registry=registry;this.#store=store;this.#now=now;this.#random=tokenFactory;this.#backendVerify=createCentralBackendVerifier(backendClients);this.#familySeal=createCentralFamilySeal(familySealKey);this.#oidc=createCentralOIDCProvider(oidc);this.#socialConsentClient=registry.find(c=>c.productId==='social')?.clientId;
    if(this.#oidc&&(!this.#socialConsentClient||registry.some(c=>c.clientId===this.#oidc.clientId)))fail('OIDC_CONFIG_INVALID');
  }
  challenge(initiator,transactionToken){
    const client=this.#initiator(initiator);if(!token(transactionToken))fail('SSO_BROWSER_BINDING_REQUIRED');
    return this.#transaction((state,now)=>{
      const pending=state.challenges.find(value=>!value.consumed&&value.challenge.browserBinding===hash(transactionToken)&&Date.parse(value.challenge.expiresAt)>now);
      if(pending){if(canonicalJSON(pending.challenge.initiator)!==canonicalJSON(initiator))fail('SSO_REQUEST_PENDING');return {challenge:pending.challenge,clientId:client.clientId};}
      const challenge={version:1,issuer:CENTRAL_BROWSER_ISSUER,purpose:CENTRAL_BROWSER_PURPOSE,
        challengeId:this.#token(),browserBinding:hash(transactionToken),nonce:this.#token(),
        initiator:{...initiator},clients:this.#registry.map(value=>({clientId:value.clientId,origin:value.origin,audience:value.audience,scopes:[...value.scopes]})).sort((a,b)=>a.clientId.localeCompare(b.clientId)),
        issuedAt:iso(now),expiresAt:iso(now+120000)};
      state.challenges.push({challenge,consumed:false});return {challenge,clientId:client.clientId};
    });
  }
  complete(approval,transactionToken,previousSessionToken=null){
    approval=parseCentralBrowserSignInApproval(approval);
    if(!token(transactionToken))fail('SSO_BROWSER_BINDING_REQUIRED');
    return this.#transaction((state,now)=>{
      const record=state.challenges.find(value=>value.challenge.challengeId===approval.challengeId),challenge=record?.challenge;
      if(!challenge||record.consumed)fail('SSO_CHALLENGE_REPLAY');
      if(Date.parse(challenge.expiresAt)<=now)fail('SSO_CHALLENGE_EXPIRED');
      if(!equal(challenge.browserBinding,hash(transactionToken)))fail('SSO_BROWSER_MISMATCH');
      if(typeof approval.accountPublicKey!=='string'||!/^0[23][a-f0-9]{64}$/.test(approval.accountPublicKey)||typeof approval.walletSignature!=='string'||!/^([a-f0-9]{128})$/.test(approval.walletSignature))fail('SSO_SIGNATURE_INVALID');
      let verified=false;
      try{verified=walletIdentityFromPublicKey(approval.accountPublicKey)===approval.account&&secp256k1.verify(hexToBytes(approval.walletSignature),sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,approval.account,approval.accountPublicKey))),hexToBytes(approval.accountPublicKey),{prehash:false,format:'compact',lowS:true});}catch{}
      if(!verified)fail('SSO_SIGNATURE_INVALID');
      // Consume, rotate the prior browser identity and create its generation in
      // ONE durable transaction. Failed validation never consumes a challenge.
      const previous=token(previousSessionToken)?state.sessions.find(value=>equal(value.tokenHash,hash(previousSessionToken))):null;
      if(previous){previous.revoked=true;previous.generation++;}
      const sessionToken=this.#token(),session={id:this.#token(),tokenHash:hash(sessionToken),account:approval.account,
        accountPublicKey:approval.accountPublicKey,approvedClients:structuredClone(challenge.clients),approvedProfile:centralBrowserApprovedProfile(this.#registry,challenge.clients,challenge.initiator.clientId).id,generation:1,createdAt:now,lastSeenAt:now,expiresAt:now+SESSION_ABSOLUTE,revoked:false};
      state.sessions.push(session);record.consumed=true;record.createdSessionId=session.id;
      return {sessionToken,identity:this.#identity(session),initiator:challenge.initiator};
    });
  }
  replaceProfile(challengeId,profileId,transactionToken){
    if(!token(challengeId)||!token(transactionToken)||![3,5,6].includes(profileId))fail('SSO_TRANSACTION_INVALID');
    return this.#transaction((state,now)=>{
      const record=state.challenges.find(r=>r.challenge.challengeId===challengeId),old=record?.challenge;
      if(!old||record.consumed||Date.parse(old.expiresAt)<=now)fail('SSO_CHALLENGE_EXPIRED');
      if(!equal(old.browserBinding,hash(transactionToken)))fail('SSO_BROWSER_MISMATCH');
      const profile=centralBrowserProfiles(this.#registry).find(p=>p.id===profileId);
      if(!profile||!profile.clients.some(c=>c.clientId===old.initiator.clientId))fail('SSO_CLIENTS_MISMATCH');
      const attempted=record.attemptedProfiles??[centralBrowserApprovedProfile(this.#registry,old.clients,old.initiator.clientId).id];
      if(attempted.includes(profileId)||profileId>=Math.min(...attempted))fail('SSO_PROFILE_REPLAY');
      record.consumed=true;
      const challenge={...old,challengeId:this.#token(),nonce:this.#token(),clients:profile.clients};
      state.challenges.push({challenge,consumed:false,lineageId:record.lineageId??old.challengeId,attemptedProfiles:[...attempted,profileId]});
      return {challenge};
    });
  }
  cancel(challengeId,transactionToken){
    if(!token(transactionToken)||!token(challengeId))fail('SSO_BROWSER_BINDING_REQUIRED');
    return this.#transaction(state=>{const record=state.challenges.find(value=>value.challenge.challengeId===challengeId);
      if(!record||!equal(record.challenge.browserBinding,hash(transactionToken)))fail('SSO_BROWSER_MISMATCH');
      const lineageId=record.lineageId??record.challenge.challengeId;
      for(const linked of state.challenges){if((linked.lineageId??linked.challenge.challengeId)!==lineageId||linked.challenge.browserBinding!==record.challenge.browserBinding||canonicalJSON(linked.challenge.initiator)!==canonicalJSON(record.challenge.initiator))continue;const created=linked.createdSessionId?state.sessions.find(value=>value.id===linked.createdSessionId):null;if(created&&!created.revoked){created.revoked=true;created.generation++;}linked.consumed=true;}
      const redirect=new URL(record.challenge.initiator.redirectUri);redirect.searchParams.set('error','access_denied');redirect.searchParams.set('state',record.challenge.initiator.state);
      return {cancelled:true,redirectUri:redirect.href};});
  }
  loginPage(input,transactionToken){this.#initiator(input);return {registry:this.#registry,...this.challenge(input,transactionToken)};}
  loginRequired(input){const client=this.#initiator(input);const redirect=new URL(client.redirectUri);redirect.searchParams.set('state',input.state);redirect.searchParams.set('error','login_required');return {redirectUri:redirect.href};}
  status(sessionToken){return this.#transaction((state,now)=>this.#identity(this.#active(state,sessionToken,now)));}
  authorize(initiator,sessionToken){
    const client=this.#initiator(initiator);
    return this.#transaction((state,now)=>{
      const session=this.#active(state,sessionToken,now);this.#approved(state,session,client.clientId);
      if(state.codes.some(value=>value.sessionId===session.id&&value.clientId===client.clientId&&value.state===initiator.state))fail('SSO_TRANSACTION_REPLAY');
      const code=this.#token();
      state.codes.push({codeHash:hash(code),sessionId:session.id,generation:session.generation,clientId:client.clientId,
        origin:client.origin,redirectUri:client.redirectUri,audience:client.audience,scopes:[...client.scopes],
        state:initiator.state,codeChallenge:initiator.codeChallenge,expiresAt:now+60000,consumed:false});
      const redirect=new URL(client.redirectUri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',initiator.state);
      return {redirectUri:redirect.href};
    });
  }
  redeem(input){return this.#transaction((state,now)=>this.#redeem(state,now,input));}
  #redeem(state,now,input){
    exactFields(input,['clientId','origin','redirectUri','code','state','codeVerifier'],'Central browser code redemption');
    const client=centralBrowserClient(this.#registry,{clientId:input.clientId,origin:input.origin,redirectUri:input.redirectUri});
    if(!token(input.code)||!token(input.state)||typeof input.codeVerifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier))fail('SSO_CODE_INVALID');
      const code=state.codes.find(value=>equal(value.codeHash,hash(input.code)));
      if(!code||code.protocol!==undefined||code.consumed)fail('SSO_CODE_REPLAY');
      if(code.expiresAt<=now)fail('SSO_CODE_EXPIRED');
      if(code.clientId!==client.clientId||code.origin!==client.origin||code.redirectUri!==client.redirectUri||code.state!==input.state)fail('SSO_CODE_BINDING_MISMATCH');
      if(!equal(code.codeChallenge,createHash('sha256').update(input.codeVerifier).digest('base64url')))fail('SSO_PKCE_MISMATCH');
      const session=state.sessions.find(value=>value.id===code.sessionId);this.#assertActive(session,now);
      if(session.generation!==code.generation)fail('SSO_GENERATION_REVOKED');this.#approved(state,session,client.clientId);if(code.audience!==client.audience||canonicalJSON(code.scopes)!==canonicalJSON(client.scopes))fail('SSO_CODE_BINDING_MISMATCH');
      const grantToken=this.#token(),grant={tokenHash:hash(grantToken),sessionId:session.id,generation:session.generation,
        clientId:client.clientId,origin:client.origin,audience:client.audience,scopes:[...client.scopes],expiresAt:Math.min(now+GRANT_LIFETIME,session.expiresAt,session.lastSeenAt+SESSION_IDLE),revoked:false};
      state.grants.push(grant);code.consumed=true;
      return {grantToken,expiresAt:iso(grant.expiresAt),identity:this.#identity(session),audience:grant.audience,scopes:[...grant.scopes]};
  }
  redeemWithFamily(input,proof){
    exactFields(input,['clientId','origin','redirectUri','code','state','codeVerifier','requestId'],'Confidential redemption');
    if(!token(input.requestId))fail('SSO_FAMILY_REQUEST_INVALID');
    return this.#transaction((state,now)=>{
      const auth=this.#authenticateBackend(state,now,'/v2/browser-sessions/token-family',input,proof),digest=backendBodyDigest(input),existing=state.families.find(f=>f.initialCodeHash===hash(input.code));
      if(existing){if(existing.clientId!==input.clientId||existing.initialDigest!==digest||existing.initialRequestId!==input.requestId)fail('SSO_CODE_REPLAY');this.#activeFamily(state,existing,now);if(existing.epoch!==0)fail('SSO_CODE_REPLAY');return this.#familySeal.open(existing.initialResult,existing.id+':initial');}
      const {requestId,...redemption}=input,result=this.#redeem(state,now,redemption),grant=state.grants.find(g=>g.tokenHash===hash(result.grantToken)),session=state.sessions.find(v=>v.id===grant.sessionId),handle=this.#token();
      const family={id:this.#token(),sessionId:session.id,generation:session.generation,lastUserActivityAt:session.lastSeenAt,clientId:grant.clientId,origin:grant.origin,audience:grant.audience,scopes:[...grant.scopes],absoluteExpiresAt:session.expiresAt,epoch:0,activityIds:[],handleHash:hash(handle),revoked:false,initialCodeHash:hash(input.code),initialRequestId:requestId,initialDigest:digest,grantExpiresAt:grant.expiresAt,spentHandles:[],retry:null};
      grant.familyId=family.id;const out={...result,approvedProfile:session.approvedProfile,approvedClientsDigest:hash(canonicalJSON(session.approvedClients)),familyId:family.id,familyEpoch:0,refreshHandle:handle,absoluteExpiresAt:iso(session.expiresAt),idleExpiresAt:iso(Math.min(session.expiresAt,family.lastUserActivityAt+SESSION_IDLE))};family.initialResult=this.#familySeal.seal(out,family.id+':initial');state.families.push(family);return out;
    });
  }
  renewFamily(input,proof){
    exactFields(input,['clientId','familyId','refreshHandle','expectedFamilyEpoch','requestId'],'Confidential renewal');
    if(!token(input.familyId)||!token(input.refreshHandle)||!token(input.requestId)||!Number.isSafeInteger(input.expectedFamilyEpoch)||input.expectedFamilyEpoch<0)fail('SSO_FAMILY_REQUEST_INVALID');
    return this.#transaction((state,now)=>{
      this.#authenticateBackend(state,now,'/v2/browser-sessions/renew',input,proof);const family=state.families.find(f=>f.id===input.familyId&&f.clientId===input.clientId);const session=this.#activeFamily(state,family,now),digest=backendBodyDigest(input),handleHash=hash(input.refreshHandle);
      if(family.retry&&family.retry.oldHandleHash===handleHash&&family.retry.epoch===input.expectedFamilyEpoch){if(family.retry.requestId!==input.requestId||family.retry.digest!==digest)fail('SSO_FAMILY_CONFLICT');if(family.retry.resultEpoch!==family.epoch)fail('SSO_FAMILY_REPLAY');return this.#familySeal.open(family.retry.result,family.id+':'+family.epoch);}
      if(family.spentHandles.some(h=>h.hash===handleHash))fail('SSO_FAMILY_REPLAY');
      if(input.expectedFamilyEpoch!==family.epoch||!equal(handleHash,family.handleHash))fail('SSO_FAMILY_CONFLICT');
      if(family.epoch>=64)fail('SSO_FAMILY_CAPACITY');if(family.grantExpiresAt>now+60000)fail('SSO_RENEW_NOT_DUE');
      const handle=this.#token(),grantToken=this.#token(),expiresAt=Math.min(now+GRANT_LIFETIME,session.expiresAt,family.lastUserActivityAt+SESSION_IDLE);const grant={familyId:family.id,tokenHash:hash(grantToken),sessionId:session.id,generation:session.generation,clientId:family.clientId,origin:family.origin,audience:family.audience,scopes:[...family.scopes],expiresAt,revoked:false};state.grants.push(grant);family.spentHandles.push({hash:family.handleHash,epoch:family.epoch});family.epoch++;family.grantExpiresAt=expiresAt;
      const out={grantToken,expiresAt:iso(expiresAt),identity:this.#identity(session),approvedProfile:session.approvedProfile,approvedClientsDigest:hash(canonicalJSON(session.approvedClients)),audience:family.audience,scopes:[...family.scopes],familyId:family.id,familyEpoch:family.epoch,refreshHandle:handle,absoluteExpiresAt:iso(family.absoluteExpiresAt),idleExpiresAt:iso(Math.min(session.expiresAt,family.lastUserActivityAt+SESSION_IDLE))};
      family.retry={oldHandleHash:family.handleHash,epoch:input.expectedFamilyEpoch,resultEpoch:family.epoch,requestId:input.requestId,digest,result:this.#familySeal.seal(out,family.id+':'+family.epoch)};family.handleHash=hash(handle);return out;
    });
  }
  recordFamilyActivity(input,proof){
    exactFields(input,['clientId','familyId','eventId','observedAt'],'Trusted host user activity');const observed=Date.parse(input.observedAt);if(!token(input.familyId)||!token(input.eventId)||!Number.isFinite(observed)||new Date(observed).toISOString()!==input.observedAt)fail('SSO_ACTIVITY_INVALID');
    return this.#transaction((state,now)=>{this.#authenticateBackend(state,now,'/v2/browser-sessions/activity',input,proof);if(observed>now||now-observed>30000)fail('SSO_ACTIVITY_INVALID');const family=state.families.find(f=>f.id===input.familyId&&f.clientId===input.clientId),session=this.#activeFamily(state,family,now);family.activityIds=family.activityIds.filter(e=>e.observedAt+30000>=now);const prior=family.activityIds.find(e=>e.id===input.eventId);if(prior&&prior.observedAt!==observed)fail('SSO_ACTIVITY_REPLAY');if(!prior){if(family.activityIds.length>=128)fail('SSO_ACTIVITY_CAPACITY');family.activityIds.push({id:input.eventId,observedAt:observed});family.lastUserActivityAt=Math.max(family.lastUserActivityAt,observed);session.lastSeenAt=Math.max(session.lastSeenAt,observed);}return{absoluteExpiresAt:iso(session.expiresAt),idleExpiresAt:iso(Math.min(session.expiresAt,family.lastUserActivityAt+SESSION_IDLE)),identity:this.#identity(session)};});
  }
  revokeFamily(input,proof){
    exactFields(input,['clientId','familyId','requestId'],'Confidential family revocation');if(!token(input.familyId)||!token(input.requestId))fail('SSO_FAMILY_REQUEST_INVALID');
    return this.#transaction((state,now)=>{this.#authenticateBackend(state,now,'/v2/browser-sessions/revoke-family',input,proof);const family=state.families.find(f=>f.id===input.familyId&&f.clientId===input.clientId);if(!family)fail('SSO_FAMILY_INVALID');if(family.revoked)return{revoked:true};for(const linked of state.families)if(linked.sessionId===family.sessionId&&linked.generation===family.generation&&linked.clientId===family.clientId)linked.revoked=true;for(const grant of state.grants)if(grant.sessionId===family.sessionId&&grant.generation===family.generation&&grant.clientId===family.clientId)grant.revoked=true;for(const code of state.codes)if(code.sessionId===family.sessionId&&code.generation===family.generation&&code.clientId===family.clientId)code.consumed=true;return{revoked:true};});
  }
  #authenticateBackend(state,now,path,input,proof){
    if(!this.#familySeal)fail('SSO_BACKEND_NOT_CONFIGURED');const auth=this.#backendVerify(path,input,proof,now);state.families??=[];state.backendNonces??=[];state.schemaVersion=2;const prior=state.backendNonces.find(n=>n.hash===auth.nonceHash&&n.clientId===auth.clientId);if(prior&&prior.digest!==auth.digest)fail('SSO_BACKEND_AUTH_REPLAY');if(!prior)state.backendNonces.push({hash:auth.nonceHash,clientId:auth.clientId,digest:auth.digest,expiresAt:auth.expiresAt});return auth;
  }
  #activeFamily(state,family,now){
    if(!family||family.revoked)fail('SSO_FAMILY_INVALID');if(!Number.isSafeInteger(family.lastUserActivityAt)||family.lastUserActivityAt+SESSION_IDLE<=now)fail('SSO_LOGIN_REQUIRED');const session=state.sessions.find(v=>v.id===family.sessionId);this.#assertActive(session,now);if(session.generation!==family.generation||family.absoluteExpiresAt!==session.expiresAt)fail('SSO_GENERATION_REVOKED');const approved=this.#approved(state,session,family.clientId);if(approved.origin!==family.origin||approved.audience!==family.audience||canonicalJSON(approved.scopes)!==canonicalJSON(family.scopes))fail('SSO_FAMILY_INVALID');return session;
  }
  introspect(grantToken,clientId){
    if(!token(grantToken))fail('SSO_GRANT_INVALID');
    return this.#transaction((state,now)=>{
      const grant=state.grants.find(value=>equal(value.tokenHash,hash(grantToken)));
      if(!grant||grant.protocol!==undefined||grant.revoked||grant.expiresAt<=now||grant.clientId!==clientId)fail('SSO_GRANT_INVALID');
      const session=state.sessions.find(value=>value.id===grant.sessionId);this.#assertActive(session,now);
      if(session.generation!==grant.generation)fail('SSO_GENERATION_REVOKED');const approved=this.#approved(state,session,clientId);if(grant.origin!==approved.origin||grant.audience!==approved.audience||canonicalJSON(grant.scopes)!==canonicalJSON(approved.scopes))fail('SSO_GRANT_INVALID');
      if(grant.familyId){const family=state.families?.find(f=>f.id===grant.familyId);this.#activeFamily(state,family,now);}else session.lastSeenAt=now; // Legacy behavior retained until this client adopts finite families.
      return {identity:this.#identity(session),audience:grant.audience,scopes:[...grant.scopes],expiresAt:iso(grant.expiresAt)};
    });
  }
  logout(sessionToken){return this.#transaction((state,now)=>{const session=this.#active(state,sessionToken,now);session.revoked=true;session.generation++;return {revoked:true};});}
  logoutGrant(grantToken,clientId){
    if(!token(grantToken))fail('SSO_GRANT_INVALID');
    return this.#transaction((state,now)=>{
      const grant=state.grants.find(value=>equal(value.tokenHash,hash(grantToken)));
      if(!grant||grant.protocol!==undefined||grant.clientId!==clientId||grant.expiresAt<=now)fail('SSO_GRANT_INVALID');
      if(grant.revoked)return {revoked:true};
      const session=state.sessions.find(value=>value.id===grant.sessionId);
      if(!session||session.generation!==grant.generation||session.revoked)return {revoked:true};
      this.#assertActive(session,now);
      // Product-only logout cannot revoke the central browser identity or
      // another registered product. Revoke this product's linked grants.
      for(const linked of state.grants)if(linked.sessionId===grant.sessionId&&linked.generation===grant.generation&&linked.clientId===clientId)linked.revoked=true;
      for(const code of state.codes)if(code.sessionId===grant.sessionId&&code.generation===grant.generation&&code.clientId===clientId)code.consumed=true;
      for(const family of state.families??[])if(family.sessionId===grant.sessionId&&family.generation===grant.generation&&family.clientId===clientId)family.revoked=true;
      return {revoked:true};
    });
  }
  get oidcEnabled(){return this.#oidc!==null;}
  oidcMetadata(){this.#requireOIDC();return this.#oidc.metadata();}
  oidcJwks(){this.#requireOIDC();return this.#oidc.jwks();}
  oidcRequest(input){this.#requireOIDC();return this.#oidc.request(input);}
  oidcErrorRedirect(input,error){const request=this.oidcRequest(input),redirect=new URL(request.redirect_uri);if(!['login_required','access_denied'].includes(error))fail('OIDC_REQUEST_INVALID');redirect.searchParams.set('state',request.state);redirect.searchParams.set('error',error);return redirect.href;}
  oidcLoginPage(input,browserToken){const request=this.oidcRequest(input),client=this.#registry.find(c=>c.clientId===this.#socialConsentClient);return this.loginPage({clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:this.#oidc.loginState(request),codeChallenge:request.code_challenge,codeChallengeMethod:'S256'},browserToken);}
  oidcAuthorize(input,sessionToken){
    const request=this.oidcRequest(input);
    return this.#transaction((state,now)=>{
      const session=this.#active(state,sessionToken,now);this.#approved(state,session,this.#socialConsentClient);
      const recent=state.challenges.some(r=>r.consumed&&r.createdSessionId===session.id&&r.challenge.initiator.clientId===this.#socialConsentClient&&r.challenge.initiator.state===this.#oidc.loginState(request)&&Date.parse(r.challenge.expiresAt)>now);
      const force=request.prompt==='login'||request.max_age!==undefined&&(Number(request.max_age)===0||Math.floor(now/1000)-Math.floor(session.createdAt/1000)>Number(request.max_age));
      if(force&&!recent)fail('SSO_LOGIN_REQUIRED');
      if(state.codes.some(c=>c.protocol===CENTRAL_OIDC_PROTOCOL&&c.sessionId===session.id&&c.clientId===request.client_id&&c.state===request.state))fail('OIDC_TRANSACTION_REPLAY');
      const code=this.#token();state.codes.push({protocol:CENTRAL_OIDC_PROTOCOL,codeHash:hash(code),sessionId:session.id,generation:session.generation,clientId:request.client_id,redirectUri:request.redirect_uri,scopes:request.scope.split(' '),state:request.state,nonce:request.nonce,codeChallenge:request.code_challenge,expiresAt:Math.min(now+60000,session.expiresAt,session.lastSeenAt+SESSION_IDLE),consumed:false});
      const redirect=new URL(request.redirect_uri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',request.state);return {redirectUri:redirect.href};
    });
  }
  oidcRedeem(input,headers){
    this.#requireOIDC();this.#oidc.authenticate(headers);input=this.#oidc.codeInput(input);
    return this.#transaction((state,now)=>{
      const code=state.codes.find(c=>equal(c.codeHash,hash(input.code)));
      if(!code||code.protocol!==CENTRAL_OIDC_PROTOCOL||code.consumed||code.expiresAt<=now||code.clientId!==this.#oidc.clientId||code.redirectUri!==input.redirect_uri)fail('OIDC_CODE_INVALID');
      if(!equal(code.codeChallenge,createHash('sha256').update(input.code_verifier).digest('base64url')))fail('OIDC_PKCE_MISMATCH');
      const session=state.sessions.find(s=>s.id===code.sessionId);this.#assertActive(session,now);if(session.generation!==code.generation)fail('SSO_GENERATION_REVOKED');this.#approved(state,session,this.#socialConsentClient);
      const expiresAt=Math.min(now+GRANT_LIFETIME,session.expiresAt,session.lastSeenAt+SESSION_IDLE),iat=Math.floor(now/1000),exp=Math.floor(expiresAt/1000);if(exp<=iat)fail('OIDC_CODE_INVALID');
      const identityToken=this.#oidc.signIdentity({iss:CENTRAL_BROWSER_ISSUER,sub:session.account,aud:this.#oidc.clientId,iat,exp,auth_time:Math.floor(session.createdAt/1000),nonce:code.nonce,sid:session.id,ynx_account:session.account,ynx_generation:session.generation});
      const accessToken=this.#token();state.grants.push({protocol:CENTRAL_OIDC_PROTOCOL,tokenHash:hash(accessToken),sessionId:session.id,generation:session.generation,clientId:this.#oidc.clientId,scopes:[...code.scopes],expiresAt:exp*1000,revoked:false});code.consumed=true;
      return {access_token:accessToken,token_type:'Bearer',expires_in:exp-iat,id_token:identityToken,scope:code.scopes.join(' ')};
    });
  }
  oidcUserInfo(accessToken){
    this.#requireOIDC();if(!token(accessToken))fail('OIDC_TOKEN_INVALID');
    return this.#transaction((state,now)=>{const grant=state.grants.find(g=>equal(g.tokenHash,hash(accessToken)));if(!grant||grant.protocol!==CENTRAL_OIDC_PROTOCOL||grant.clientId!==this.#oidc.clientId||grant.revoked||grant.expiresAt<=now)fail('OIDC_TOKEN_INVALID');const session=state.sessions.find(s=>s.id===grant.sessionId);this.#assertActive(session,now);if(session.generation!==grant.generation)fail('SSO_GENERATION_REVOKED');this.#approved(state,session,this.#socialConsentClient);return {sub:session.account,ynx_account:session.account,ynx_generation:session.generation};});
  }
  #requireOIDC(){if(!this.#oidc)fail('OIDC_NOT_CONFIGURED');}
  #approved(state,session,clientId){
    const proof=state.challenges.find(r=>r.consumed&&r.createdSessionId===session.id);
    if(!session.approvedClients){
      if(!proof)fail('SSO_LOGIN_REQUIRED');
      const profile=centralBrowserApprovedProfile(this.#registry,proof.challenge.clients,proof.challenge.initiator.clientId);
      session.approvedClients=structuredClone(profile.clients);session.approvedProfile=profile.id;
    }
    const profile=centralBrowserProfiles(this.#registry).find(p=>p.id===session.approvedProfile&&canonicalJSON(p.clients)===canonicalJSON(session.approvedClients));
    if(!profile)fail('SSO_LOGIN_REQUIRED');
    const client=profile.clients.find(c=>c.clientId===clientId);
    if(!client)fail('SSO_LOGIN_REQUIRED');
    return client;
  }
  #initiator(input){
    exactFields(input,['clientId','origin','redirectUri','state','codeChallenge','codeChallengeMethod'],'Central browser initiator');
    const client=centralBrowserClient(this.#registry,{clientId:input.clientId,origin:input.origin,redirectUri:input.redirectUri});
    if(!token(input.state)||!token(input.codeChallenge)||input.codeChallengeMethod!=='S256')fail('SSO_TRANSACTION_INVALID');return client;
  }
  #token(){const value=this.#random();if(!token(value))fail('SSO_TOKEN_FACTORY_INVALID');return value;}
  #transaction(action){return this.#store.transaction(state=>{
    const now=this.#now();if(!Number.isSafeInteger(now)||now<state.clockHighWaterMs)fail('SSO_CLOCK_ROLLBACK');state.clockHighWaterMs=now;
    // Bounded tombstone retention: removing already expired identifiers still
    // rejects their replay; never remove a live session or linked live grant.
    state.challenges=state.challenges.filter(value=>Date.parse(value.challenge.expiresAt)+300000>now||value.createdSessionId&&state.sessions.some(s=>s.id===value.createdSessionId&&!s.revoked&&s.expiresAt+GRANT_LIFETIME+300000>now));
    state.codes=state.codes.filter(value=>value.expiresAt+300000>now);
    state.grants=state.grants.filter(value=>value.expiresAt+300000>now);
    state.sessions=state.sessions.filter(value=>value.expiresAt+GRANT_LIFETIME+300000>now);
    if(state.schemaVersion===2){state.families=state.families.filter(f=>f.absoluteExpiresAt+300000>now);state.backendNonces=state.backendNonces.filter(n=>n.expiresAt+30000>now);}
    return action(state,now);
  });}
  #active(state,value,now){if(!token(value))fail('SSO_LOGIN_REQUIRED');const session=state.sessions.find(record=>equal(record.tokenHash,hash(value)));this.#assertActive(session,now);session.lastSeenAt=now;return session;}
  #assertActive(session,now){if(!session||session.revoked||session.expiresAt<=now||session.lastSeenAt+SESSION_IDLE<=now)fail('SSO_LOGIN_REQUIRED');}
  #identity(session){return {subject:session.account,account:session.account,generation:session.generation,expiresAt:iso(session.expiresAt)};}
}
function fail(code){throw new WalletAuthError(code,'Central browser authorization failed closed');}

export const CENTRAL_BROWSER_ROUTES=Object.freeze([
  '/sso/browser.js','/sso/session',
  '/v2/browser-sessions/bootstrap','/v2/browser-sessions/challenge','/v2/browser-sessions/complete',
  '/v2/browser-sessions/cancel','/v2/browser-sessions/profile','/v2/browser-sessions/status','/v2/browser-sessions/authorize',
  '/v2/browser-sessions/token','/v2/browser-sessions/token-family','/v2/browser-sessions/renew','/v2/browser-sessions/revoke-family','/v2/browser-sessions/activity','/v2/browser-sessions/introspect','/v2/browser-sessions/logout','/v2/browser-sessions/logout-grant',
]);
export class CentralBrowserSessionNodeRoutes {
  #authority;
  constructor(authority){this.#authority=authority;}
  handles(path){return CENTRAL_BROWSER_ROUTES.includes(path)||this.#authority.oidcEnabled&&CENTRAL_OIDC_ROUTES.includes(path);}
  handle({method,url,headers,body=''}){
    const parsedUrl=new URL(url,CENTRAL_BROWSER_ISSUER),path=parsedUrl.pathname;
    try{
      if(!this.handles(path))fail('SSO_ROUTE_NOT_FOUND');
      if(CENTRAL_OIDC_ROUTES.includes(path))return this.#handleOIDC({method,parsedUrl,headers,body});
      if(path==='/sso/browser.js'){
        if(method!=='GET'||parsedUrl.search||parsedUrl.hash)fail('SSO_METHOD_NOT_ALLOWED');
        return {status:200,headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},body:readFileSync(new URL('./central-browser-session-browser.bundle.js',import.meta.url),'utf8')};
      }
      if(path==='/sso/session'){
        if(method!=='GET'||parsedUrl.search||parsedUrl.hash)fail('SSO_METHOD_NOT_ALLOWED');
        return {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"},body:centralUIPage('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YNX · Browser session</title><style>body{background:#fff;color:#122247;font:17px/1.6 system-ui;margin:0}main{max-width:560px;margin:8vh auto;padding:24px}button{min-height:44px;padding:12px 18px;border:0;border-radius:12px;background:#002FA7;color:#fff;font:inherit}button:disabled{opacity:.65}</style><main><h1>YNX browser session</h1><p id="status" role="status" aria-live="polite">Checking your server session…</p><p>Signing out here ends browser identity access across all linked YNX products. It does not revoke unrelated Wallet connection permissions.</p><button id="global-logout" type="button" disabled>Sign out of all YNX products</button><script id="context" type="application/json">{"mode":"session"}</script><script src="/sso/browser.js" defer></script></main></html>',headers['accept-language'])};
      }
      if(parsedUrl.hash||parsedUrl.search&&path!=='/v2/browser-sessions/authorize')fail('SSO_TRANSACTION_INVALID');
      const backend=['/v2/browser-sessions/token','/v2/browser-sessions/token-family','/v2/browser-sessions/renew','/v2/browser-sessions/revoke-family','/v2/browser-sessions/activity','/v2/browser-sessions/introspect','/v2/browser-sessions/logout-grant'].includes(path);
      if(backend){
        // Credential responses are server-to-server ONLY. No product CORS, no
        // browser same-origin fetch, and no cookie auth to these two endpoints.
        if(headers.origin!==undefined||headers['sec-fetch-site']!==undefined||headers.cookie!==undefined)fail('SSO_BACKEND_ONLY');
      }else if(headers.origin!==undefined&&headers.origin!==CENTRAL_BROWSER_ISSUER)fail('SSO_ORIGIN_MISMATCH');
      const session=centralBrowserCookieToken(headers.cookie),transaction=centralBrowserCookieToken(headers.cookie,CENTRAL_BROWSER_TRANSACTION_COOKIE);
      const json=()=>{
        if(method!=='POST')fail('SSO_METHOD_NOT_ALLOWED');
        if(headers['content-type']!=='application/json'||typeof body!=='string'||Buffer.byteLength(body)>16384)fail('SSO_BODY_INVALID');
        let input;try{input=JSON.parse(body)}catch{fail('SSO_BODY_INVALID')}
        if(canonicalJSON(input)!==body)fail('SSO_BODY_INVALID');return input;
      };
      const csrf=()=>{
        if(headers.origin!==CENTRAL_BROWSER_ISSUER)fail('SSO_ORIGIN_MISMATCH');
        const bound=path==='/v2/browser-sessions/logout'?session:transaction;
        if(!bound||!equal(headers['x-ynx-browser-csrf'],hash(bound)))fail('SSO_CSRF_MISMATCH');
      };
      if(path==='/v2/browser-sessions/bootstrap'){
        if(method!=='GET')fail('SSO_METHOD_NOT_ALLOWED');
        const selected=transaction??random();
        return this.#reply(200,{csrfToken:hash(selected),sessionCsrfToken:session?hash(session):null}, {'set-cookie':centralBrowserCookie(selected,{transaction:true})});
      }
      if(path==='/v2/browser-sessions/status'){
        if(method!=='GET')fail('SSO_METHOD_NOT_ALLOWED');return this.#reply(200,this.#authority.status(session));
      }
      if(path==='/v2/browser-sessions/authorize'){
        if(method!=='GET')fail('SSO_METHOD_NOT_ALLOWED');
        const parsed=new URL(url,CENTRAL_BROWSER_ISSUER),query=Object.fromEntries(parsed.searchParams);
        if([...parsed.searchParams].length!==Object.keys(query).length)fail('SSO_TRANSACTION_INVALID');
        const {prompt,...input}=query;if(prompt!==undefined&&prompt!=='none')fail('SSO_TRANSACTION_INVALID');
        try{const result=this.#authority.authorize(input,session);return this.#reply(303,{redirect:true},{location:result.redirectUri});}
        catch(error){if(error?.code!=='SSO_LOGIN_REQUIRED')throw error;
          if(prompt==='none'){const result=this.#authority.loginRequired(input);return this.#reply(303,{redirect:true},{location:result.redirectUri});}
          const bound=transaction??random(),page=this.#authority.loginPage(input,bound);
          return this.#loginResponse(page,bound,headers);
        }
      }
      const input=json();if(!backend)csrf();
      if(path==='/v2/browser-sessions/challenge')return this.#reply(200,this.#authority.challenge(input,transaction));
      if(path==='/v2/browser-sessions/profile'){exactFields(input,['challengeId','profile'],'Central profile replacement');return this.#reply(200,this.#authority.replaceProfile(input.challengeId,input.profile,transaction));}
      if(path==='/v2/browser-sessions/complete'){
        const result=this.#authority.complete(input,transaction,session);
        // Central long-lived cookie is never returned in a JSON token field.
        return this.#reply(200,{identity:result.identity,initiator:result.initiator},{'set-cookie':centralBrowserCookie(result.sessionToken)});
      }
      if(path==='/v2/browser-sessions/cancel'){exactFields(input,['challengeId'],'Central browser cancellation');return this.#reply(200,this.#authority.cancel(input.challengeId,transaction));}
      if(['/v2/browser-sessions/token-family','/v2/browser-sessions/renew','/v2/browser-sessions/revoke-family','/v2/browser-sessions/activity'].includes(path)){
        const raw=headers['x-ynx-backend-proof'];if(typeof raw!=='string'||raw.length>4096||!/^[A-Za-z0-9_-]+$/.test(raw))fail('SSO_BACKEND_AUTH_REQUIRED');let proof;try{proof=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'))}catch{fail('SSO_BACKEND_AUTH_INVALID')}
        const method=path.endsWith('/token-family')?'redeemWithFamily':path.endsWith('/renew')?'renewFamily':path.endsWith('/activity')?'recordFamilyActivity':'revokeFamily';return this.#reply(200,this.#authority[method](input,proof));
      }
      if(path==='/v2/browser-sessions/token')return this.#reply(200,this.#authority.redeem(input));
      if(path==='/v2/browser-sessions/introspect'){exactFields(input,['grantToken','clientId'],'Central grant introspection');return this.#reply(200,this.#authority.introspect(input.grantToken,input.clientId));}
      if(path==='/v2/browser-sessions/logout-grant'){exactFields(input,['grantToken','clientId'],'Central grant logout');return this.#reply(200,this.#authority.logoutGrant(input.grantToken,input.clientId));}
      if(path==='/v2/browser-sessions/logout'){exactFields(input,[],'Central browser logout');const result=this.#authority.logout(session);return this.#reply(200,result,{'set-cookie':centralBrowserCookie('',{clear:true})});}
      fail('SSO_ROUTE_NOT_FOUND');
    }catch(error){
      const code=error instanceof WalletAuthError?error.code:'SSO_INTERNAL';
      const status=['SSO_LOGIN_REQUIRED','SSO_GRANT_INVALID','SSO_GENERATION_REVOKED'].includes(code)?401:code==='SSO_STATE_BUSY'?503:['SSO_CSRF_MISMATCH','SSO_ORIGIN_MISMATCH','SSO_BACKEND_ONLY'].includes(code)?403:code==='SSO_METHOD_NOT_ALLOWED'?405:code.startsWith('SSO_STATE')||code==='SSO_INTERNAL'?500:400;
      return this.#reply(status,{error:{code},ok:false});
    }
  }
  #loginResponse(page,bound,headers,extra={}){
    const data=canonicalJSON({...page,...extra,csrfToken:hash(bound)}).replaceAll('<','\\u003c');
          return {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' wss://relay.walletconnect.org https://pulse.walletconnect.org https://verify.walletconnect.org https://verify.walletconnect.com; frame-src https://verify.walletconnect.org; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'set-cookie':centralBrowserCookie(bound,{transaction:true})},body:centralUIPage(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YNX · Sign in</title><style>body{margin:0;background:#fff;color:#122247;font:17px/1.6 system-ui}main{max-width:560px;margin:8vh auto;padding:24px}button,a{min-height:44px;padding:12px 18px;border-radius:12px}button{background:#002FA7;color:#fff;border:0;margin:8px 8px 8px 0;cursor:pointer}button:disabled{opacity:.65}select{width:100%;min-height:48px;font:inherit}a{color:#002FA7}#status{min-height:3em}</style><main><h1>Sign in with YNX Wallet</h1><p>Allow browser sign-in for registered YNX products. Private product permissions require separate approval.</p><label for="wallet">YNX Wallet</label><select id="wallet"></select><p id="status" role="status" aria-live="polite">Choose a wallet to continue.</p><button id="approve">Continue with YNX Wallet</button><button id="cancel">Cancel</button><p><a href="https://wallet.ynxweb4.com" target="_blank" rel="noopener noreferrer">Get YNX Wallet</a></p><p><small>Portions © 2025 Reown, Inc. All Rights Reserved. WalletConnect connection uses the official Reown network.</small></p><script id="context" type="application/json">${data}</script><script src="/sso/browser.js" defer></script></main></html>`,headers['accept-language'])};
  }
  #handleOIDC({method,parsedUrl,headers,body}){
    const path=parsedUrl.pathname;
    try{
      if(parsedUrl.hash||(path!=='/oidc/authorize'||method==='POST')&&parsedUrl.search)fail('OIDC_REQUEST_INVALID');
      if(['/.well-known/openid-configuration','/oidc/jwks'].includes(path)){
        if(method!=='GET')fail('OIDC_METHOD_INVALID');return this.#reply(200,path.endsWith('/jwks')?this.#authority.oidcJwks():this.#authority.oidcMetadata());
      }
      if(path==='/oidc/authorize'){
        if(!['GET','POST'].includes(method)||headers['sec-fetch-dest']!==undefined&&headers['sec-fetch-dest']!=='document')fail('OIDC_REQUEST_INVALID');
        if(method==='POST'&&(typeof body!=='string'||Buffer.byteLength(body)>16384||typeof headers['content-type']!=='string'||!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(headers['content-type'])))fail('OIDC_REQUEST_INVALID');
        if(method==='GET'&&body!=='')fail('OIDC_REQUEST_INVALID');
        const params=method==='POST'?new URLSearchParams(body):parsedUrl.searchParams,input=Object.fromEntries(params);if([...params].length!==Object.keys(input).length)fail('OIDC_REQUEST_INVALID');const request=this.#authority.oidcRequest(input);
        if(headers.origin!==undefined&&headers.origin!==CENTRAL_BROWSER_ISSUER&&(method!=='POST'||headers.origin!==new URL(request.redirect_uri).origin))fail('OIDC_REQUEST_INVALID');
        // Canonical top-level GET retains the exact normalized request for the
        // original Wallet page reload/complete path after form serialization.
        if(method==='POST')return this.#reply(303,{redirect:true},{location:CENTRAL_BROWSER_ISSUER+'/oidc/authorize?'+new URLSearchParams(request)});
        try{const result=this.#authority.oidcAuthorize(request,centralBrowserCookieToken(headers.cookie));return this.#reply(303,{redirect:true},{location:result.redirectUri});}
        catch(error){if(error?.code!=='SSO_LOGIN_REQUIRED')throw error;
          if(request.prompt==='none')return this.#reply(303,{redirect:true},{location:this.#authority.oidcErrorRedirect(request,'login_required')});
          const bound=centralBrowserCookieToken(headers.cookie,CENTRAL_BROWSER_TRANSACTION_COOKIE)??random(),page=this.#authority.oidcLoginPage(request,bound);
          return this.#loginResponse(page,bound,headers,{mode:'oidc',oidcCancelRedirect:this.#authority.oidcErrorRedirect(request,'access_denied')});
        }
      }
      if(path==='/oidc/token'){
        if(method!=='POST')fail('OIDC_METHOD_INVALID');if(typeof body!=='string'||Buffer.byteLength(body)>16384||typeof headers['content-type']!=='string'||!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(headers['content-type']))fail('OIDC_REQUEST_INVALID');
        const params=new URLSearchParams(body),input=Object.fromEntries(params);if([...params].length!==Object.keys(input).length)fail('OIDC_REQUEST_INVALID');return this.#reply(200,this.#authority.oidcRedeem(input,headers));
      }
      if(path==='/oidc/userinfo'){
        if(!['GET','POST'].includes(method))fail('OIDC_METHOD_INVALID');if(body!=='')fail('OIDC_REQUEST_INVALID');if(headers.origin!==undefined||headers.cookie!==undefined||headers['sec-fetch-site']!==undefined)fail('OIDC_BACKEND_ONLY');
        if(typeof headers.authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(headers.authorization))fail('OIDC_TOKEN_INVALID');return this.#reply(200,this.#authority.oidcUserInfo(headers.authorization.slice(7)));
      }
      fail('OIDC_REQUEST_INVALID');
    }catch(error){
      const code=error instanceof WalletAuthError?error.code:'OIDC_INTERNAL',client=code==='OIDC_CLIENT_AUTH_INVALID',token=path==='/oidc/userinfo',busy=code==='SSO_STATE_BUSY',infrastructure=code==='OIDC_INTERNAL'||code.startsWith('SSO_STATE'),status=code==='OIDC_METHOD_INVALID'?405:busy?503:infrastructure?500:client||token&&code!=='OIDC_REQUEST_INVALID'?401:400;
      return this.#reply(status,{error:busy?'temporarily_unavailable':infrastructure?'server_error':client?'invalid_client':token&&status===401?'invalid_token':path==='/oidc/token'?'invalid_grant':'invalid_request'},client?{'www-authenticate':'Basic realm="YNX Central OpenID"'}:token&&status===401?{'www-authenticate':'Bearer error="invalid_token"'}:{});
    }
  }
  #reply(status,payload,headers={}){return {status,headers:{'cache-control':'no-store','content-type':'application/json; charset=utf-8','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers},body:canonicalJSON(payload)};}
}
