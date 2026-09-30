import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {chmod,mkdtemp,readFile,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
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
    assert.match(centralBrowserCookie(signed.sessionToken),/^__Host-.*; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
    assert.equal(centralBrowserCookieToken(`__Host-ynx-browser-session=${signed.sessionToken}; __Host-ynx-browser-session=${token()}`),null);
    restarted.logoutGrant(finance.result.grantToken,finance.input.clientId);
    assert.throws(()=>restarted.introspect(finance.result.grantToken,finance.input.clientId),error=>error.code==='SSO_GRANT_INVALID');
    assert.equal(restarted.status(signed.sessionToken).account,identity.account,'product logout preserves central identity');
    assert.equal(restarted.introspect(quant.result.grantToken,quant.input.clientId).identity.account,identity.account,'product logout preserves another product grant');
    const explicitAgain=grant(restarted,signed.sessionToken);
    assert.equal(explicitAgain.result.identity.account,identity.account,'explicit sign-in may reuse the still valid central identity');
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
    let response=await send('challenge',{body:request.input,origin:issuer,cookie:transactionCookie,csrf:'incorrect'});assert.equal(response.status,403);
    response=await send('challenge',{body:request.input,origin:'https://unknown.ynxweb4.com',cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal(response.status,403);
    const challenged=await send('challenge',{body:request.input,origin:issuer,cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal(challenged.status,200);assert.equal(challenged.headers.has('access-control-allow-origin'),false);
    const {challenge}=await challenged.json();
    const again=await send('challenge',{body:request.input,origin:issuer,cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal((await again.json()).challenge.challengeId,challenge.challengeId);
    const otherBrowser=await send('complete',{body:approve(challenge),origin:issuer,cookie:`__Host-ynx-browser-transaction=${token()}`,csrf:bootstrap.csrfToken});assert.equal(otherBrowser.status,403);
    const completed=await send('complete',{body:approve(challenge),origin:issuer,cookie:transactionCookie,csrf:bootstrap.csrfToken});assert.equal(completed.status,200);
    const completedBody=await completed.json();assert.equal(completedBody.sessionToken,undefined);assert.equal(completedBody.identity.subject,identity.account);
    const centralCookie=completed.headers.getSetCookie()[0].split(';')[0];
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
