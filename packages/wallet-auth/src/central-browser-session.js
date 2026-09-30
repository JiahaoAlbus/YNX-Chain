import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {walletIdentityFromPublicKey} from './crypto.js';
import {CENTRAL_BROWSER_ISSUER,centralBrowserClient} from './central-browser-session-registry.js';
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
  return `${transaction?CENTRAL_BROWSER_TRANSACTION_COOKIE:CENTRAL_BROWSER_COOKIE}=${clear?'':value}; Path=/; Secure; HttpOnly; SameSite=Lax${clear?'; Max-Age=0':transaction?'; Max-Age=120':''}`;
}
export function centralBrowserCookieToken(header,name=CENTRAL_BROWSER_COOKIE){
  if(typeof header!=='string'||header.length>8192)return null;
  const matches=header.split(';').map(value=>value.trim()).filter(value=>value.startsWith(`${name}=`));
  if(matches.length!==1)return null;const value=matches[0].slice(name.length+1);return token(value)?value:null;
}

// Identity-only grants are separate from existing Wallet ProductSession proofs.
// No caller may use this grant to bypass a native/sensitive product scope.
export class CentralBrowserSessionAuthority {
  #store;#registry;#now;#random;
  constructor(registry,store,{now=()=>Date.now(),tokenFactory=random}={}){
    if(!Array.isArray(registry)||!store?.transaction||typeof now!=='function'||typeof tokenFactory!=='function')fail('SSO_AUTHORITY_INVALID');
    this.#registry=registry;this.#store=store;this.#now=now;this.#random=tokenFactory;
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
        accountPublicKey:approval.accountPublicKey,generation:1,createdAt:now,lastSeenAt:now,expiresAt:now+SESSION_ABSOLUTE,revoked:false};
      state.sessions.push(session);record.consumed=true;record.createdSessionId=session.id;
      return {sessionToken,identity:this.#identity(session),initiator:challenge.initiator};
    });
  }
  cancel(challengeId,transactionToken){
    if(!token(transactionToken)||!token(challengeId))fail('SSO_BROWSER_BINDING_REQUIRED');
    return this.#transaction(state=>{const record=state.challenges.find(value=>value.challenge.challengeId===challengeId);
      if(!record||!equal(record.challenge.browserBinding,hash(transactionToken)))fail('SSO_BROWSER_MISMATCH');
      const created=record.createdSessionId?state.sessions.find(value=>value.id===record.createdSessionId):null;
      if(created&&!created.revoked){created.revoked=true;created.generation++;}
      record.consumed=true;
      const redirect=new URL(record.challenge.initiator.redirectUri);redirect.searchParams.set('error','access_denied');redirect.searchParams.set('state',record.challenge.initiator.state);
      return {cancelled:true,redirectUri:redirect.href};});
  }
  loginPage(input,transactionToken){this.#initiator(input);return {registry:this.#registry,...this.challenge(input,transactionToken)};}
  status(sessionToken){return this.#transaction((state,now)=>this.#identity(this.#active(state,sessionToken,now)));}
  authorize(initiator,sessionToken){
    const client=this.#initiator(initiator);
    return this.#transaction((state,now)=>{
      const session=this.#active(state,sessionToken,now);
      if(state.codes.some(value=>value.sessionId===session.id&&value.clientId===client.clientId&&value.state===initiator.state))fail('SSO_TRANSACTION_REPLAY');
      const code=this.#token();
      state.codes.push({codeHash:hash(code),sessionId:session.id,generation:session.generation,clientId:client.clientId,
        origin:client.origin,redirectUri:client.redirectUri,audience:client.audience,scopes:[...client.scopes],
        state:initiator.state,codeChallenge:initiator.codeChallenge,expiresAt:now+60000,consumed:false});
      const redirect=new URL(client.redirectUri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',initiator.state);
      return {redirectUri:redirect.href};
    });
  }
  redeem(input){
    exactFields(input,['clientId','origin','redirectUri','code','state','codeVerifier'],'Central browser code redemption');
    const client=centralBrowserClient(this.#registry,{clientId:input.clientId,origin:input.origin,redirectUri:input.redirectUri});
    if(!token(input.code)||!token(input.state)||typeof input.codeVerifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier))fail('SSO_CODE_INVALID');
    return this.#transaction((state,now)=>{
      const code=state.codes.find(value=>equal(value.codeHash,hash(input.code)));
      if(!code||code.consumed)fail('SSO_CODE_REPLAY');
      if(code.expiresAt<=now)fail('SSO_CODE_EXPIRED');
      if(code.clientId!==client.clientId||code.origin!==client.origin||code.redirectUri!==client.redirectUri||code.state!==input.state)fail('SSO_CODE_BINDING_MISMATCH');
      if(!equal(code.codeChallenge,createHash('sha256').update(input.codeVerifier).digest('base64url')))fail('SSO_PKCE_MISMATCH');
      const session=state.sessions.find(value=>value.id===code.sessionId);this.#assertActive(session,now);
      if(session.generation!==code.generation)fail('SSO_GENERATION_REVOKED');
      const grantToken=this.#token(),grant={tokenHash:hash(grantToken),sessionId:session.id,generation:session.generation,
        clientId:client.clientId,origin:client.origin,audience:client.audience,scopes:[...client.scopes],expiresAt:Math.min(now+GRANT_LIFETIME,session.expiresAt),revoked:false};
      state.grants.push(grant);code.consumed=true;
      return {grantToken,expiresAt:iso(grant.expiresAt),identity:this.#identity(session),audience:grant.audience,scopes:[...grant.scopes]};
    });
  }
  introspect(grantToken,clientId){
    if(!token(grantToken))fail('SSO_GRANT_INVALID');
    return this.#transaction((state,now)=>{
      const grant=state.grants.find(value=>equal(value.tokenHash,hash(grantToken)));
      if(!grant||grant.revoked||grant.expiresAt<=now||grant.clientId!==clientId)fail('SSO_GRANT_INVALID');
      const session=state.sessions.find(value=>value.id===grant.sessionId);this.#assertActive(session,now);
      if(session.generation!==grant.generation)fail('SSO_GENERATION_REVOKED');
      session.lastSeenAt=now;
      return {identity:this.#identity(session),audience:grant.audience,scopes:[...grant.scopes],expiresAt:iso(grant.expiresAt)};
    });
  }
  logout(sessionToken){return this.#transaction((state,now)=>{const session=this.#active(state,sessionToken,now);session.revoked=true;session.generation++;return {revoked:true};});}
  logoutGrant(grantToken,clientId){
    if(!token(grantToken))fail('SSO_GRANT_INVALID');
    return this.#transaction((state,now)=>{
      const grant=state.grants.find(value=>equal(value.tokenHash,hash(grantToken)));
      if(!grant||grant.clientId!==clientId||grant.expiresAt<=now)fail('SSO_GRANT_INVALID');
      const session=state.sessions.find(value=>value.id===grant.sessionId);
      if(!session||session.generation!==grant.generation||session.revoked)return {revoked:true};
      this.#assertActive(session,now);
      // Product-only logout cannot revoke the central browser identity or
      // another registered product. Revoke this product's linked grants.
      for(const linked of state.grants)if(linked.sessionId===grant.sessionId&&linked.generation===grant.generation&&linked.clientId===clientId)linked.revoked=true;
      return {revoked:true};
    });
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
    state.challenges=state.challenges.filter(value=>Date.parse(value.challenge.expiresAt)+300000>now);
    state.codes=state.codes.filter(value=>value.expiresAt+300000>now);
    state.grants=state.grants.filter(value=>value.expiresAt+300000>now);
    state.sessions=state.sessions.filter(value=>value.expiresAt+GRANT_LIFETIME+300000>now);
    return action(state,now);
  });}
  #active(state,value,now){if(!token(value))fail('SSO_LOGIN_REQUIRED');const session=state.sessions.find(record=>equal(record.tokenHash,hash(value)));this.#assertActive(session,now);session.lastSeenAt=now;return session;}
  #assertActive(session,now){if(!session||session.revoked||session.expiresAt<=now||session.lastSeenAt+SESSION_IDLE<=now)fail('SSO_LOGIN_REQUIRED');}
  #identity(session){return {subject:session.account,account:session.account,generation:session.generation,expiresAt:iso(session.expiresAt)};}
}
function fail(code){throw new WalletAuthError(code,'Central browser authorization failed closed');}

export const CENTRAL_BROWSER_ROUTES=Object.freeze([
  '/sso/browser.js',
  '/v2/browser-sessions/bootstrap','/v2/browser-sessions/challenge','/v2/browser-sessions/complete',
  '/v2/browser-sessions/cancel','/v2/browser-sessions/status','/v2/browser-sessions/authorize',
  '/v2/browser-sessions/token','/v2/browser-sessions/introspect','/v2/browser-sessions/logout','/v2/browser-sessions/logout-grant',
]);
export class CentralBrowserSessionNodeRoutes {
  #authority;
  constructor(authority){this.#authority=authority;}
  handles(path){return CENTRAL_BROWSER_ROUTES.includes(path);}
  handle({method,url,headers,body=''}){
    const parsedUrl=new URL(url,CENTRAL_BROWSER_ISSUER),path=parsedUrl.pathname;
    try{
      if(!this.handles(path))fail('SSO_ROUTE_NOT_FOUND');
      if(path==='/sso/browser.js'){
        if(method!=='GET'||parsedUrl.search||parsedUrl.hash)fail('SSO_METHOD_NOT_ALLOWED');
        return {status:200,headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},body:readFileSync(new URL('./central-browser-session-browser.bundle.js',import.meta.url),'utf8')};
      }
      if(parsedUrl.hash||parsedUrl.search&&path!=='/v2/browser-sessions/authorize')fail('SSO_TRANSACTION_INVALID');
      const backend=['/v2/browser-sessions/token','/v2/browser-sessions/introspect','/v2/browser-sessions/logout-grant'].includes(path);
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
        const parsed=new URL(url,CENTRAL_BROWSER_ISSUER),input=Object.fromEntries(parsed.searchParams);
        if([...parsed.searchParams].length!==Object.keys(input).length)fail('SSO_TRANSACTION_INVALID');
        try{const result=this.#authority.authorize(input,session);return this.#reply(303,{redirect:true},{location:result.redirectUri});}
        catch(error){if(error?.code!=='SSO_LOGIN_REQUIRED')throw error;
          const bound=transaction??random(),page=this.#authority.loginPage(input,bound);
          const data=canonicalJSON({...page,csrfToken:hash(bound)}).replaceAll('<','\\u003c');
          return {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'set-cookie':centralBrowserCookie(bound,{transaction:true})},body:`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YNX · Sign in</title><style>body{margin:0;background:#fff;color:#122247;font:17px/1.6 system-ui}main{max-width:560px;margin:8vh auto;padding:24px}button,a{min-height:44px;padding:12px 18px;border-radius:12px}button{background:#002FA7;color:#fff;border:0;margin:8px 8px 8px 0;cursor:pointer}button:disabled{opacity:.65}select{width:100%;min-height:48px;font:inherit}a{color:#002FA7}#status{min-height:3em}</style><main><h1>Sign in with YNX Wallet</h1><p>Allow browser sign-in for registered YNX products. Private product permissions require separate approval.</p><label for="wallet">YNX Wallet</label><select id="wallet"></select><p id="status" role="status" aria-live="polite">Choose a wallet to continue.</p><button id="approve">Continue with YNX Wallet</button><button id="cancel">Cancel</button><p><a href="https://wallet.ynxweb4.com" target="_blank" rel="noopener noreferrer">Get YNX Wallet</a></p><script id="context" type="application/json">${data}</script><script src="/sso/browser.js" defer></script></main></html>`};
        }
      }
      const input=json();if(!backend)csrf();
      if(path==='/v2/browser-sessions/challenge')return this.#reply(200,this.#authority.challenge(input,transaction));
      if(path==='/v2/browser-sessions/complete'){
        const result=this.#authority.complete(input,transaction,session);
        // Central long-lived cookie is never returned in a JSON token field.
        return this.#reply(200,{identity:result.identity,initiator:result.initiator},{'set-cookie':centralBrowserCookie(result.sessionToken)});
      }
      if(path==='/v2/browser-sessions/cancel'){exactFields(input,['challengeId'],'Central browser cancellation');return this.#reply(200,this.#authority.cancel(input.challengeId,transaction));}
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
  #reply(status,payload,headers={}){return {status,headers:{'cache-control':'no-store','content-type':'application/json; charset=utf-8','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers},body:canonicalJSON(payload)};}
}
