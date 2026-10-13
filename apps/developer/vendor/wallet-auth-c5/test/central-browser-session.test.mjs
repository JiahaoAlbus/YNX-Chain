import {backendBodyDigest} from '../src/central-browser-backend-auth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {chmod,mkdtemp,readFile,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {walletIdentity} from '../src/crypto.js';
import {canonicalJSON} from '../src/canonical.js';
import {CentralBrowserSessionStore} from '../src/central-browser-session-store.js';
import {createCentralBrowserSessionRegistry} from '../src/central-browser-session-registry.js';
import {CentralBrowserSessionAuthority,centralBrowserConsentSignBytes,centralBrowserCookie,centralBrowserCookieToken} from '../src/central-browser-session.js';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
const products=JSON.parse(await readFile(new URL('../product-session-registry.json',import.meta.url)));
const registry=createCentralBrowserSessionRegistry(products),token=()=>randomBytes(32).toString('base64url');
const secret='1'.padStart(64,'0'); // existing isolated deterministic QA key, never a user account
const identity=walletIdentity(secret),digest=value=>createHash('sha256').update(value).digest('hex');
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'ynx-central-browser-'));await chmod(directory,0o700);
  const path=join(directory,'state.json');let now=Date.now();
  const store=new CentralBrowserSessionStore(path),authority=new CentralBrowserSessionAuthority(registry,store,{now:()=>now});
  return {directory,path,store,authority,advance:milliseconds=>now+=milliseconds,close:()=>rm(directory,{recursive:true,force:true})};
}
function intent(product='finance'){
  const client=registry.find(value=>value.productId===product),codeVerifier=token();
  return {input:{clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:token(),codeChallenge:createHash('sha256').update(codeVerifier).digest('base64url'),codeChallengeMethod:'S256'},codeVerifier};
}
function approve(challenge,key=secret){
  const selected=walletIdentity(key),walletSignature=bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,selected.account,selected.accountPublicKey))),hexToBytes(key),{prehash:false,format:'compact',lowS:true}));
  return {challengeId:challenge.challengeId,...selected,walletSignature};
}
function login(authority,key=secret,previous=null){
  const request=intent(),binding=token(),{challenge}=authority.challenge(request.input,binding);
  return {...authority.complete(approve(challenge,key),binding,previous),request,binding,challenge};
}
function grant(authority,sessionToken,product='finance'){
  const request=intent(product),redirect=authority.authorize(request.input,sessionToken);
  const input={clientId:request.input.clientId,origin:request.input.origin,redirectUri:request.input.redirectUri,state:request.input.state,codeVerifier:request.codeVerifier,code:new URL(redirect.redirectUri).searchParams.get('code')};
  return {input,result:authority.redeem(input)};
}

test('explicit canonical native consent creates one durable browser identity and exact separate identity-only audiences',async()=>{
  const f=await fixture();try{
    const signed=login(f.authority),finance=grant(f.authority,signed.sessionToken),quant=grant(f.authority,signed.sessionToken,'quant');
    assert.equal(finance.result.identity.subject,identity.account);assert.equal(quant.result.identity.subject,identity.account);
    assert.deepEqual(finance.result.scopes,['identity:read']);assert.notEqual(finance.result.audience,quant.result.audience);
    assert.throws(()=>f.authority.introspect(finance.result.grantToken,quant.input.clientId),/failed closed/);
    const restarted=new CentralBrowserSessionAuthority(registry,new CentralBrowserSessionStore(f.path));
    assert.equal(restarted.status(signed.sessionToken).account,identity.account);
    assert.equal(restarted.introspect(finance.result.grantToken,finance.input.clientId).identity.account,identity.account);
    assert.equal(centralBrowserCookieToken(centralBrowserCookie(signed.sessionToken)),signed.sessionToken);
    assert.match(centralBrowserCookie(signed.sessionToken),/^__Host-.*; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=7200$/);
    assert.equal(centralBrowserCookieToken(`__Host-ynx-browser-session=${signed.sessionToken}; __Host-ynx-browser-session=${token()}`),null);
    const pendingFinance=intent(),pendingQuant=intent('quant');
    const financeCode=new URL(restarted.authorize(pendingFinance.input,signed.sessionToken).redirectUri).searchParams.get('code');
    const quantCode=new URL(restarted.authorize(pendingQuant.input,signed.sessionToken).redirectUri).searchParams.get('code');
    restarted.logoutGrant(finance.result.grantToken,finance.input.clientId);
    const redeemPending=(request,code)=>restarted.redeem({clientId:request.input.clientId,origin:request.input.origin,redirectUri:request.input.redirectUri,state:request.input.state,codeVerifier:request.codeVerifier,code});
    assert.throws(()=>redeemPending(pendingFinance,financeCode),error=>error.code==='SSO_CODE_REPLAY','old product callback cannot resurrect a signed-out session');
    assert.equal(redeemPending(pendingQuant,quantCode).identity.account,identity.account,'another product outstanding code stays valid');
    assert.throws(()=>restarted.introspect(finance.result.grantToken,finance.input.clientId),error=>error.code==='SSO_GRANT_INVALID');
    assert.equal(restarted.status(signed.sessionToken).account,identity.account,'product logout preserves central identity');
    assert.equal(restarted.introspect(quant.result.grantToken,quant.input.clientId).identity.account,identity.account,'product logout preserves another product grant');
    const explicitAgain=grant(restarted,signed.sessionToken);
    assert.equal(explicitAgain.result.identity.account,identity.account,'explicit sign-in may reuse the still valid central identity');
    const newPending=intent(),newCode=new URL(restarted.authorize(newPending.input,signed.sessionToken).redirectUri).searchParams.get('code');
    restarted.logoutGrant(finance.result.grantToken,finance.input.clientId);
    assert.equal(restarted.introspect(explicitAgain.result.grantToken,explicitAgain.input.clientId).identity.account,identity.account,'replayed old logout cannot revoke a new explicit sign-in');
    assert.equal(redeemPending(newPending,newCode).identity.account,identity.account,'replayed old logout cannot cancel new explicit code');
    restarted.logout(signed.sessionToken);
    assert.throws(()=>restarted.introspect(quant.result.grantToken,quant.input.clientId),error=>error.code==='SSO_LOGIN_REQUIRED');
    assert.throws(()=>restarted.introspect(explicitAgain.result.grantToken,explicitAgain.input.clientId),error=>error.code==='SSO_LOGIN_REQUIRED');
  }finally{await f.close()}
});

test('challenge browser binding, signature contents, expiry and replay are atomic and failed consent stays recoverable',async()=>{
  const f=await fixture();try{
    const request=intent(),binding=token(),{challenge}=f.authority.challenge(request.input,binding),approval=approve(challenge);
    assert.throws(()=>f.authority.complete(approval,token()),error=>error.code==='SSO_BROWSER_MISMATCH');
    const changed=structuredClone(challenge);changed.initiator.origin='https://unknown.ynxweb4.com';
    assert.throws(()=>f.authority.complete(approve(changed),binding),error=>error.code==='SSO_SIGNATURE_INVALID');
    const completed=f.authority.complete(approval,binding);
    assert.equal(completed.identity.account,identity.account);
    assert.throws(()=>f.authority.complete(approval,binding),error=>error.code==='SSO_CHALLENGE_REPLAY');
    const expired=f.authority.challenge(intent().input,binding).challenge;f.advance(120000);
    assert.throws(()=>f.authority.complete(approve(expired),binding),error=>error.code==='SSO_CHALLENGE_EXPIRED');
    assert.throws(()=>f.authority.challenge({...request.input,redirectUri:'https://finance.ynxweb4.com/sso/callback?next=https://attacker.invalid'},binding),error=>error.code==='SSO_CLIENT_NOT_REGISTERED');
  }finally{await f.close()}
});

test('code requires original client/state/PKCE and logout/account rotation immediately deny old grants and unused codes',async()=>{
  const f=await fixture();try{
    const signed=login(f.authority),request=intent(),url=f.authority.authorize(request.input,signed.sessionToken).redirectUri;
    const input={clientId:request.input.clientId,origin:request.input.origin,redirectUri:request.input.redirectUri,state:request.input.state,codeVerifier:request.codeVerifier,code:new URL(url).searchParams.get('code')};
    assert.throws(()=>f.authority.redeem({...input,codeVerifier:token()}),error=>error.code==='SSO_PKCE_MISMATCH');
    assert.throws(()=>f.authority.redeem({...input,state:token()}),error=>error.code==='SSO_CODE_BINDING_MISMATCH');
    const result=f.authority.redeem(input);assert.throws(()=>f.authority.redeem(input),error=>error.code==='SSO_CODE_REPLAY');
    const next=login(f.authority,'2'.padStart(64,'0'),signed.sessionToken);
    assert.notEqual(next.identity.account,signed.identity.account);
    assert.throws(()=>f.authority.status(signed.sessionToken),error=>error.code==='SSO_LOGIN_REQUIRED');
    assert.throws(()=>f.authority.introspect(result.grantToken,input.clientId),error=>error.code==='SSO_LOGIN_REQUIRED');
    const currentGrant=grant(f.authority,next.sessionToken),pending=intent('exchange'),pendingUrl=f.authority.authorize(pending.input,next.sessionToken).redirectUri;
    f.authority.logout(next.sessionToken);
    assert.throws(()=>f.authority.introspect(currentGrant.result.grantToken,currentGrant.input.clientId),error=>error.code==='SSO_LOGIN_REQUIRED');
    assert.throws(()=>f.authority.redeem({clientId:pending.input.clientId,origin:pending.input.origin,redirectUri:pending.input.redirectUri,state:pending.input.state,codeVerifier:pending.codeVerifier,code:new URL(pendingUrl).searchParams.get('code')}),error=>error.code==='SSO_LOGIN_REQUIRED');
  }finally{await f.close()}
});

test('cancel after complete atomically revokes exactly the challenge-created identity and every linked grant',async()=>{
  const f=await fixture();try{
    const signed=login(f.authority),linked=grant(f.authority,signed.sessionToken);
    const cancelled=f.authority.cancel(signed.challenge.challengeId,signed.binding);
    assert.equal(new URL(cancelled.redirectUri).searchParams.get('state'),signed.request.input.state);
    assert.equal(new URL(cancelled.redirectUri).searchParams.get('error'),'access_denied');
    assert.throws(()=>f.authority.status(signed.sessionToken),error=>error.code==='SSO_LOGIN_REQUIRED');
    assert.throws(()=>f.authority.introspect(linked.result.grantToken,linked.input.clientId),error=>error.code==='SSO_LOGIN_REQUIRED');
    assert.throws(()=>f.authority.complete(approve(signed.challenge),signed.binding),error=>error.code==='SSO_CHALLENGE_REPLAY');
    assert.deepEqual(f.authority.cancel(signed.challenge.challengeId,signed.binding),cancelled);
  }finally{await f.close();}
});

test('independent processes cannot consume the same durable code twice',async()=>{
  const f=await fixture();try{
    const signed=login(f.authority),request=intent(),url=f.authority.authorize(request.input,signed.sessionToken).redirectUri;
    const input={clientId:request.input.clientId,origin:request.input.origin,redirectUri:request.input.redirectUri,state:request.input.state,codeVerifier:request.codeVerifier,code:new URL(url).searchParams.get('code')};
    const worker=`import{CentralBrowserSessionStore}from${JSON.stringify(new URL('../src/central-browser-session-store.js',import.meta.url).href)};import{CentralBrowserSessionAuthority}from${JSON.stringify(new URL('../src/central-browser-session.js',import.meta.url).href)};const config=JSON.parse(process.env.YNX_CENTRAL_ISOLATED_QA);let outcome;for(let i=0;i<50;i++){try{const a=new CentralBrowserSessionAuthority(config.registry,new CentralBrowserSessionStore(config.path));a.redeem(config.input);outcome='consumed';break}catch(e){if(e.code!=='SSO_STATE_BUSY'){outcome=e.code;break}await new Promise(r=>setTimeout(r,5))}}process.stdout.write(outcome||'busy');`;
    const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',worker],{env:{...process.env,YNX_CENTRAL_ISOLATED_QA:JSON.stringify({registry,path:f.path,input})},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',bytes=>output+=bytes);child.on('error',reject);child.on('close',status=>status===0?resolve(output):reject(new Error('isolated worker failed')))});
    const outcomes=await Promise.all([run(),run()]);assert.deepEqual(outcomes.sort(),['SSO_CODE_REPLAY','consumed']);
    assert.equal(f.store.snapshot().grants.length,1);
  }finally{await f.close()}
});

test('foreign/tampered markers and lock symlinks fail before mutation; initialized state loss never resets revocation',async()=>{
  const f=await fixture();try{
    const original=await readFile(f.path),marker=await readFile(`${f.path}.initialized`);
    await writeFile(`${f.path}.initialized`,canonicalJSON({host:'foreign-qa-host',schemaVersion:1}),{mode:0o600});
    assert.throws(()=>f.store.transaction(state=>state.clockHighWaterMs++),error=>error.code==='SSO_STATE_FOREIGN_HOST');
    assert.deepEqual(await readFile(f.path),original);
    await writeFile(`${f.path}.initialized`,marker,{mode:0o600});
    await writeFile(`${f.path}.lock`,canonicalJSON({host:'foreign-qa-host',pid:2147483647,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),{mode:0o600});
    assert.throws(()=>f.store.snapshot(),error=>error.code==='SSO_STATE_FOREIGN_HOST');await unlink(`${f.path}.lock`);
    await symlink(`${f.path}.initialized`,`${f.path}.lock`);
    assert.throws(()=>f.store.snapshot());await unlink(`${f.path}.lock`);
    assert.deepEqual(await readFile(f.path),original);
    await unlink(f.path);assert.throws(()=>new CentralBrowserSessionStore(f.path),error=>error.code==='SSO_STATE_LOST');
  }finally{await f.close()}
});

test('actual NodeHost SSO endpoints enforce central CSRF, backend-only code exchange and linked logout',async()=>{
  const f=await fixture(),host=new ProductSessionGatewayNodeHost(products,{statePath:join(f.directory,'gateway.json'),now:()=>new Date(),tokenFactory:token,centralBrowser:true});
  const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,issuer='https://wallet-auth.ynxweb4.com';
  const send=(path,{body,origin,cookie,csrf}={})=>fetch(`${base}/v2/browser-sessions/${path}`,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(origin?{origin}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-ynx-browser-csrf':csrf}:{})},body:body===undefined?undefined:canonicalJSON(body)});
  try{
    const boot=await send('bootstrap'),bootstrap=await boot.json(),transactionCookie=boot.headers.getSetCookie()[0].split(';')[0],request=intent();
    const quietGuest=await send(`authorize?${new URLSearchParams({...request.input,prompt:'none'})}`);assert.equal(quietGuest.status,303);
    const denied=new URL(quietGuest.headers.get('location'));assert.equal(denied.origin,request.input.origin);assert.equal(denied.pathname,'/sso/callback');assert.equal(denied.searchParams.get('state'),request.input.state);assert.equal(denied.searchParams.get('error'),'login_required');assert.equal(denied.searchParams.has('code'),false);assert.equal(quietGuest.headers.has('set-cookie'),false);
    assert.equal((await send(`authorize?${new URLSearchParams({...request.input,prompt:'unsupported'})}`)).status,400);
    assert.equal((await send(`authorize?${new URLSearchParams({...request.input,origin:'https://unknown.ynxweb4.com',prompt:'none'})}`)).status,400);
    const guest=await send(`authorize?${new URLSearchParams(request.input)}`),policy=guest.headers.get('content-security-policy');assert.equal(guest.status,200);
    assert.ok(policy.includes("frame-src https://verify.walletconnect.org;"));assert.ok(policy.includes("frame-ancestors 'none'"));assert.ok(!policy.includes('*')&&!policy.includes('ynx:')&&!policy.includes('walletconnect:'));
    assert.ok(policy.includes("connect-src 'self' wss://relay.walletconnect.org https://pulse.walletconnect.org https://verify.walletconnect.org https://verify.walletconnect.com;"));
    let response=await send('challenge',{body:request.input,origin:issuer,cookie:transactionCookie,csrf:'incorrect'});assert.equal(response.status,403);
    response=await send('challenge',{body:request.input,origin:'https://unknown.ynxweb4.com',cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal(response.status,403);
    const challenged=await send('challenge',{body:request.input,origin:issuer,cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal(challenged.status,200);assert.equal(challenged.headers.has('access-control-allow-origin'),false);
    const {challenge}=await challenged.json();
    const again=await send('challenge',{body:request.input,origin:issuer,cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal((await again.json()).challenge.challengeId,challenge.challengeId);
    const otherBrowser=await send('complete',{body:approve(challenge),origin:issuer,cookie:`__Host-ynx-browser-transaction=${token()}`,csrf:bootstrap.csrfToken});assert.equal(otherBrowser.status,403);
    const completed=await send('complete',{body:approve(challenge),origin:issuer,cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal(completed.status,200);
    const completedBody=await completed.json();assert.equal(completedBody.sessionToken,undefined);assert.equal(completedBody.identity.subject,identity.account);
    const centralCookie=completed.headers.getSetCookie()[0].split(';')[0];
    const silentRequest=intent('quant');const quiet=await send(`authorize?${new URLSearchParams({...silentRequest.input,prompt:'none'})}`,{cookie:centralCookie});assert.equal(quiet.status,303);
    const silentCode=new URL(quiet.headers.get('location')).searchParams.get('code');assert.ok(silentCode);assert.equal(new URL(quiet.headers.get('location')).searchParams.get('state'),silentRequest.input.state);
    const silentInput={clientId:silentRequest.input.clientId,origin:silentRequest.input.origin,redirectUri:silentRequest.input.redirectUri,state:silentRequest.input.state,codeVerifier:silentRequest.codeVerifier,code:silentCode};
    const quietGrantResponse=await send('token',{body:silentInput});assert.equal(quietGrantResponse.status,200);const quietGrant=await quietGrantResponse.json();assert.deepEqual(quietGrant.scopes,['identity:read']);assert.equal(quietGrant.identity.account,identity.account);assert.equal((await send('token',{body:silentInput})).status,400);
    const authorize=await send(`authorize?${new URLSearchParams(request.input)}`,{cookie:centralCookie});assert.equal(authorize.status,303);
    const input={clientId:request.input.clientId,origin:request.input.origin,redirectUri:request.input.redirectUri,state:request.input.state,codeVerifier:request.codeVerifier,code:new URL(authorize.headers.get('location')).searchParams.get('code')};
    const browserExchange=await send('token',{body:input,origin:issuer});assert.equal(browserExchange.status,403);assert.equal(browserExchange.headers.has('access-control-allow-origin'),false);
    const exchange=await send('token',{body:input});assert.equal(exchange.status,200);const grant=await exchange.json();
    const check={grantToken:grant.grantToken,clientId:input.clientId};assert.equal((await send('introspect',{body:check})).status,200);
    const csrfBoot=await send('bootstrap',{cookie:centralCookie}),sessionCsrf=(await csrfBoot.json()).sessionCsrfToken;
    assert.equal((await send('logout',{body:{},origin:issuer,cookie:centralCookie,csrf:sessionCsrf})).status,200);
    assert.equal((await send('introspect',{body:check})).status,401);
    assert.equal((await send('status',{cookie:centralCookie})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));await f.close()}
});

for(const terminal of ['idle','absolute','revoke'])test(`actual browser new-tab and new-process recovery preserve bounded central identity without new consent: ${terminal}`,{skip:process.env.YNX_CENTRAL_BROWSER_COLD_QA!=='1'&&'Opt-in ecosystem Chromium QA runtime is not requested'},async()=>{
  // Explicit ecosystem QA, not a published SDK runtime dependency. Normal
  // isolated SDK installs do not import another product's development tooling.
  const {chromium}=createRequire(new URL('../../../apps/quant-lab/package.json',import.meta.url))('playwright');
  const f=await fixture(),issuer='https://wallet-auth.ynxweb4.com';let now=Date.now(),context;
  const backendKey=generateKeyPairSync('ed25519'),backendClient=registry.find(c=>c.productId==='finance');
  const host=new ProductSessionGatewayNodeHost(products,{statePath:join(f.directory,'cold-gateway.json'),now:()=>new Date(now),tokenFactory:token,centralBrowser:true,centralBackend:{backendClients:[{clientId:backendClient.clientId,keyId:'isolated-browser-qa',publicKey:backendKey.publicKey.export({type:'spki',format:'pem'})}],familySealKey:randomBytes(32)}});
  const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  let consentCount=0;const cookieIssueObservations=[];
  const open=async()=>{
    const selected=await chromium.launchPersistentContext(join(f.directory,'browser-profile'),{headless:true});
    await selected.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==issuer)return route.abort();
      if(url.pathname==='/isolated-browser-qa')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated real Gateway QA</title>'});
      if(!url.pathname.startsWith('/v2/browser-sessions/'))return route.abort();
      if(url.pathname==='/v2/browser-sessions/complete')consentCount++;
      const response=await fetch(base+url.pathname+url.search,{method:request.method(),headers:request.headers(),body:request.postData()??undefined,redirect:'manual',signal:AbortSignal.timeout(5000)});
      assert.ok(response.headers.getSetCookie().length<=1,'this exact QA response has one cookie; do not fold duplicate Set-Cookie');
      const attributes=response.headers.getSetCookie().map(header=>{const cookieName=/^(__Host-ynx-browser-(?:session|transaction))=/.exec(header)?.[1];if(!cookieName)return null;const maxAge=/;\s*Max-Age=(\d+)(?:;|$)/i.exec(header)?.[1];assert.ok(maxAge!==undefined,'issued browser cookies have explicit bounded Max-Age');const seconds=Number(maxAge);assert.equal(seconds,seconds===0?0:cookieName.endsWith('session')?7200:120,'exact issuance/clear bound');return {cookieName,maxAge:seconds};}).filter(Boolean);
      const beforeFulfillMs=Date.now();await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});const afterFulfillMs=Date.now();for(const attribute of attributes)cookieIssueObservations.push({...attribute,beforeFulfillMs,afterFulfillMs});
    });return selected;
  };
  const send=(page,path,body)=>page.evaluate(async({path,body})=>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};},{path:'/v2/browser-sessions/'+path,body});
  const assertIdentity=async page=>{const result=await send(page,'status');assert.equal(result.status,200);assert.equal(result.body.account,identity.account);};
  try{
    context=await open();let page=await context.newPage();await page.goto(issuer+'/isolated-browser-qa');
    const bootstrap=await send(page,'bootstrap'),request=intent();
    const challenged=await page.evaluate(async({body,csrf})=>{const r=await fetch('/v2/browser-sessions/challenge',{method:'POST',headers:{'content-type':'application/json','x-ynx-browser-csrf':csrf},body});return {status:r.status,body:await r.json()};},{body:canonicalJSON(request.input),csrf:bootstrap.body.csrfToken});
    assert.equal(challenged.status,200,challenged.body.error?.code);const challenge=challenged.body.challenge;
    const completed=await page.evaluate(async({body,csrf})=>{const r=await fetch('/v2/browser-sessions/complete',{method:'POST',headers:{'content-type':'application/json','x-ynx-browser-csrf':csrf},body});return {status:r.status,body:await r.json()};},{body:canonicalJSON(approve(challenge)),csrf:bootstrap.body.csrfToken});
    assert.equal(completed.status,200);assert.equal(completed.body.sessionToken,undefined);await assertIdentity(page);
    const cookies=await context.cookies(issuer),central=cookies.find(value=>value.name==='__Host-ynx-browser-session'),transaction=cookies.find(value=>value.name==='__Host-ynx-browser-transaction');
    assert.equal(central.domain,'wallet-auth.ynxweb4.com');assert.equal(central.httpOnly,true);assert.equal(central.secure,true);assert.equal(central.sameSite,'Lax');assert.equal(central.path,'/');
    const issued=name=>cookieIssueObservations.findLast(value=>value.cookieName===name&&value.maxAge>0);
    const withinIssueRange=(cookie,observation)=>{assert.ok(observation,'expected bounded issuance observed');assert.ok(cookie.expires>=observation.beforeFulfillMs/1000+observation.maxAge-1&&cookie.expires<=observation.afterFulfillMs/1000+observation.maxAge+1,'cookie expiry matches actual response issuance wall-time range');};
    assert.equal(issued('__Host-ynx-browser-transaction').maxAge,120);withinIssueRange(transaction,issued('__Host-ynx-browser-transaction'));
    const centralIssue=issued('__Host-ynx-browser-session');assert.equal(centralIssue.maxAge,7200);withinIssueRange(central,centralIssue);
    const next=await context.newPage();await next.goto(issuer+'/isolated-browser-qa');await page.close();await assertIdentity(next);assert.equal(consentCount,1);
    await context.close();context=await open();page=await context.newPage();await page.goto(issuer+'/isolated-browser-qa');await assertIdentity(page);assert.equal(consentCount,1,'new browser process reuses server identity, not a new Wallet approval');
    withinIssueRange(central,centralIssue);
    const afterRestart=(await context.cookies(issuer)).find(value=>value.name==='__Host-ynx-browser-session');assert.ok(afterRestart);assert.ok(Math.abs(afterRestart.expires-central.expires)<1,'status read must not renew browser lifetime');
    if(terminal==='idle')now+=30*60*1000;
    if(terminal==='absolute'){
      // Status/polling no longer counts as user activity. This isolated HTTP
      // fixture attests a real-user event through the reviewed confidential
      // boundary; public UI/host activity admission is a separate acceptance.
      const backendPost=async(path,input)=>{const signed={version:1,issuer,audience:issuer+'/v2/browser-sessions',clientId:backendClient.clientId,keyId:'isolated-browser-qa',method:'POST',path,bodySha256:backendBodyDigest(input),issuedAt:new Date(now).toISOString(),nonce:token()},proof={...signed,signature:sign(null,Buffer.from(canonicalJSON(signed)),backendKey.privateKey).toString('base64url')};const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-ynx-backend-proof':Buffer.from(JSON.stringify(proof)).toString('base64url')},body:canonicalJSON(input)});assert.equal(response.status,200);return response.json()};
      const familyRequest=intent(),authorization=await fetch(base+'/v2/browser-sessions/authorize?'+new URLSearchParams(familyRequest.input),{headers:{cookie:'__Host-ynx-browser-session='+central.value},redirect:'manual'});assert.equal(authorization.status,303);const family=await backendPost('/v2/browser-sessions/token-family',{clientId:familyRequest.input.clientId,origin:familyRequest.input.origin,redirectUri:familyRequest.input.redirectUri,code:new URL(authorization.headers.get('location')).searchParams.get('code'),state:familyRequest.input.state,codeVerifier:familyRequest.codeVerifier,requestId:token()});
      for(let index=0;index<4;index++){now+=29*60*1000;await backendPost('/v2/browser-sessions/activity',{clientId:backendClient.clientId,familyId:family.familyId,eventId:token(),observedAt:new Date(now).toISOString()});await assertIdentity(page);}
      now+=4*60*1000;
    }
    if(terminal==='revoke'){
      const csrf=(await send(page,'bootstrap')).body.sessionCsrfToken;
      const revoked=await page.evaluate(async csrf=>{const r=await fetch('/v2/browser-sessions/logout',{method:'POST',headers:{'content-type':'application/json','x-ynx-browser-csrf':csrf},body:'{}'});return {status:r.status,body:await r.json()};},csrf);
      assert.equal(revoked.status,200);assert.equal(revoked.body.revoked,true);assert.ok(cookieIssueObservations.some(value=>value.cookieName==='__Host-ynx-browser-session'&&value.maxAge===0),'logout clears the cookie with exact Max-Age zero');assert.equal((await context.cookies(issuer)).some(value=>value.name==='__Host-ynx-browser-session'),false);
      await context.close();context=await open();page=await context.newPage();await page.goto(issuer+'/isolated-browser-qa');
    }
    const denied=await send(page,'status');assert.equal(denied.status,401);assert.equal(denied.body.error.code,'SSO_LOGIN_REQUIRED');assert.equal(consentCount,1);
  }finally{await context?.close();await new Promise(resolve=>server.close(resolve));await f.close();}
});
