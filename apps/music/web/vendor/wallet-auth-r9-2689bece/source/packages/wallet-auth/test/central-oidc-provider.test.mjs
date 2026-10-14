import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,generateKeyPairSync,createPublicKey,verify} from 'node:crypto';
import {mkdtemp,chmod,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {utf8ToBytes,hexToBytes,bytesToHex} from '@noble/hashes/utils.js';
import {canonicalJSON,WalletAuthError} from '../src/canonical.js';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {walletIdentity} from '../src/crypto.js';
import {CENTRAL_BROWSER_ISSUER,createCentralBrowserSessionRegistry} from '../src/central-browser-session-registry.js';
import {CentralBrowserSessionAuthority,CentralBrowserSessionNodeRoutes,centralBrowserConsentSignBytes,centralBrowserCookie,CENTRAL_BROWSER_TRANSACTION_COOKIE} from '../src/central-browser-session.js';
import {CentralBrowserSessionStore} from '../src/central-browser-session-store.js';
import {createCentralOIDCProvider,loadCentralOIDCConfiguration} from '../src/central-oidc-provider.js';
const products=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url))),registry=createCentralBrowserSessionRegistry(products),token=()=>randomBytes(32).toString('base64url');
const accountSecret='1'.padStart(64,'0'),identity=walletIdentity(accountSecret);
const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const config={clientId:'qa-synapse-rp',redirectUri:'https://qa-hs.ynx-matrix.test/_synapse/client/oidc/callback',clientSecret:'dedicated-qa-credential-not-production-0001',signingKey:keys.privateKey,keyId:'qa-op-rsa-1'};
const basic=()=>({authorization:'Basic '+Buffer.from(encodeURIComponent(config.clientId)+':'+encodeURIComponent(config.clientSecret)).toString('base64')});
function approve(challenge){return {challengeId:challenge.challengeId,...identity,walletSignature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(accountSecret),{prehash:false,format:'compact',lowS:true}))};}
function query(){const verifier=token();return {request:{client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'openid profile',state:token(),nonce:token(),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'},verifier};}
async function fixture({enabled=true}={}){
 const directory=await mkdtemp(join(tmpdir(),'ynx-op-source-'));await chmod(directory,0o700);const path=join(directory,'state');let now=Date.parse('2026-10-02T10:00:00.000Z');const store=new CentralBrowserSessionStore(path);
 const options={now:()=>now,...(enabled?{oidc:config}:{})},authority=new CentralBrowserSessionAuthority(registry,store,options),routes=new CentralBrowserSessionNodeRoutes(authority);
 const login=()=>{const client=registry.find(c=>c.productId==='social'),v=token(),initiator={clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:token(),codeChallenge:createHash('sha256').update(v).digest('base64url'),codeChallengeMethod:'S256'},bound=token(),{challenge}=authority.challenge(initiator,bound);return authority.complete(approve(challenge),bound);};
 const issue=session=>{const r=query(),redirect=authority.oidcAuthorize(r.request,session.sessionToken);return {...r,code:new URL(redirect.redirectUri).searchParams.get('code')};};
 const redeem=r=>authority.oidcRedeem({grant_type:'authorization_code',code:r.code,redirect_uri:config.redirectUri,code_verifier:r.verifier},basic());
 return {directory,path,store,authority,routes,options,login,issue,redeem,now:()=>now,advance:n=>now+=n,close:()=>rm(directory,{recursive:true,force:true})};
}
function claims(value,jwks){const parts=value.id_token.split('.');assert.equal(parts.length,3);const header=JSON.parse(Buffer.from(parts[0],'base64url')),body=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(header.alg,'RS256');assert.equal(header.kid,jwks.keys[0].kid);assert(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwks.keys[0],format:'jwk'}),Buffer.from(parts[2],'base64url')));return body;}

test('actual Wallet-signed Central identity produces separate code/access/ID tokens with original subject and deadlines',async()=>{
 const f=await fixture();try{const session=f.login(),r=f.issue(session),value=f.redeem(r),c=claims(value,f.authority.oidcJwks());assert.equal(c.iss,CENTRAL_BROWSER_ISSUER);assert.equal(c.sub,identity.account);assert.equal(c.ynx_account,identity.account);assert.equal(c.aud,config.clientId);assert.equal(c.nonce,r.request.nonce);assert.equal(c.ynx_generation,1);assert.equal(c.exp-c.iat,300);assert.equal(value.token_type,'Bearer');assert(value.access_token!==r.code);assert.deepEqual(f.authority.oidcUserInfo(value.access_token),{sub:identity.account,ynx_account:identity.account,ynx_generation:1});
 const state=f.store.snapshot();assert.equal(state.schemaVersion,1);const seen=state.sessions[0].lastSeenAt;f.advance(1000);f.authority.oidcUserInfo(value.access_token);assert.equal(f.store.snapshot().sessions[0].lastSeenAt,seen);assert.throws(()=>f.redeem(r),{code:'OIDC_CODE_INVALID'});f.advance(300000);assert.throws(()=>f.authority.oidcUserInfo(value.access_token),{code:'OIDC_TOKEN_INVALID'});
 }finally{await f.close()}
});
test('strict confidential client and PKCE failures do not consume; code purposes cannot cross existing identity endpoints',async()=>{
 const f=await fixture();try{const session=f.login(),r=f.issue(session),input={grant_type:'authorization_code',code:r.code,redirect_uri:config.redirectUri,code_verifier:r.verifier};for(const h of [{},{...basic(),origin:CENTRAL_BROWSER_ISSUER},{...basic(),cookie:'any'},{authorization:'Basic '+Buffer.from(config.clientId+':wrong').toString('base64')}])assert.throws(()=>f.authority.oidcRedeem(input,h));assert.throws(()=>f.authority.oidcRedeem({...input,code_verifier:token()},basic()),{code:'OIDC_PKCE_MISMATCH'});assert.equal(f.store.snapshot().codes[0].consumed,false);
 const client=registry.find(c=>c.productId==='social');assert.throws(()=>f.authority.redeem({clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,code:r.code,state:r.request.state,codeVerifier:r.verifier}),{code:'SSO_CODE_REPLAY'});
 const v=token(),intent={clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:token(),codeChallenge:createHash('sha256').update(v).digest('base64url'),codeChallengeMethod:'S256'},redirect=f.authority.authorize(intent,session.sessionToken),originalCode=new URL(redirect.redirectUri).searchParams.get('code');assert.throws(()=>f.authority.oidcRedeem({...input,code:originalCode,code_verifier:v},basic()),{code:'OIDC_CODE_INVALID'});const original=f.authority.redeem({clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:intent.state,code:originalCode,codeVerifier:v});assert.throws(()=>f.authority.oidcUserInfo(original.grantToken),{code:'OIDC_TOKEN_INVALID'});const op=f.redeem(r);assert.throws(()=>f.authority.introspect(op.access_token,config.clientId),{code:'SSO_GRANT_INVALID'});
 }finally{await f.close()}
});
test('logout/generation revokes code and UserInfo without stopping another same-account browser session',async()=>{
 const f=await fixture();try{const a=f.login(),b=f.login(),ra=f.issue(a),rb=f.issue(b),va=f.redeem(ra),vb=f.redeem(rb),late=f.issue(a);f.authority.logout(a.sessionToken);assert.throws(()=>f.authority.oidcUserInfo(va.access_token),{code:'SSO_LOGIN_REQUIRED'});assert.throws(()=>f.redeem(late),{code:'SSO_LOGIN_REQUIRED'});assert.equal(f.authority.oidcUserInfo(vb.access_token).sub,identity.account);
 const r=f.issue(b),rotateBound=token(),client=registry.find(c=>c.productId==='social'),challenge=f.authority.challenge({clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:token(),codeChallenge:token(),codeChallengeMethod:'S256'},rotateBound).challenge;
 const rotated=f.authority.complete(approve(challenge),rotateBound,b.sessionToken);assert.throws(()=>f.redeem(r),{code:'SSO_LOGIN_REQUIRED'});assert.throws(()=>f.authority.oidcUserInfo(vb.access_token),{code:'SSO_LOGIN_REQUIRED'});assert.equal(f.redeem(f.issue(rotated)).token_type,'Bearer');
 }finally{await f.close()}
});
test('default-off discovery and strict route metadata/headers; interactive sign-in and cancellation retain original challenge lineage',async()=>{
 const disabled=await fixture({enabled:false}),f=await fixture();try{assert.equal(disabled.routes.handles('/.well-known/openid-configuration'),false);const discovery=f.routes.handle({method:'GET',url:'/.well-known/openid-configuration',headers:{}});assert.equal(discovery.status,200);assert.equal(discovery.headers['cache-control'],'no-store');const metadata=JSON.parse(discovery.body);assert.equal(metadata.token_endpoint_auth_methods_supported[0],'client_secret_basic');assert.equal(metadata.userinfo_endpoint,CENTRAL_BROWSER_ISSUER+'/oidc/userinfo');assert(!('end_session_endpoint'in metadata));
 const r=query(),url='/oidc/authorize?'+new URLSearchParams(r.request);const page=f.routes.handle({method:'GET',url,headers:{'sec-fetch-dest':'document'}});assert.equal(page.status,200);const context=JSON.parse(page.body.match(/<script id="context" type="application\/json">([^<]*)<\/script>/)[1]);assert.equal(context.mode,'oidc');assert.equal(new URL(context.oidcCancelRedirect).origin,new URL(config.redirectUri).origin);assert.equal(new URL(context.oidcCancelRedirect).searchParams.get('state'),r.request.state);const bound=page.headers['set-cookie'].split(';')[0].split('=')[1];assert.equal(f.authority.cancel(context.challenge.challengeId,bound).cancelled,true);assert.throws(()=>f.authority.complete(approve(context.challenge),bound),{code:'SSO_CHALLENGE_REPLAY'});
 const quiet=f.routes.handle({method:'GET',url:'/oidc/authorize?'+new URLSearchParams({...r.request,prompt:'none'}),headers:{}});assert.equal(quiet.status,303);assert.equal(new URL(quiet.headers.location).searchParams.get('error'),'login_required');assert.equal(f.routes.handle({method:'GET',url:url+'&state=duplicate',headers:{}}).status,400);assert.equal(f.routes.handle({method:'GET',url:'/oidc/jwks?other=1',headers:{}}).status,400);
 }finally{await disabled.close();await f.close()}
});
test('interactive OP page completes actual original Wallet challenge then reloads to fixed HS code; forced login cannot skip consent',async()=>{
 const f=await fixture();try{const prior=f.login(),r=query(),request={...r.request,prompt:'login'},url='/oidc/authorize?'+new URLSearchParams(request);const page=f.routes.handle({method:'GET',url,headers:{cookie:centralBrowserCookie(prior.sessionToken).split(';')[0]}});assert.equal(page.status,200);const context=JSON.parse(page.body.match(/<script id="context" type="application\/json">([^<]*)<\/script>/)[1]),bound=page.headers['set-cookie'].split(';')[0].split('=')[1];const completed=f.authority.complete(approve(context.challenge),bound,prior.sessionToken);const next=f.routes.handle({method:'GET',url,headers:{cookie:centralBrowserCookie(completed.sessionToken).split(';')[0]}});assert.equal(next.status,303);assert.equal(new URL(next.headers.location).origin,new URL(config.redirectUri).origin);assert.equal(new URL(next.headers.location).searchParams.get('state'),request.state);assert.throws(()=>f.authority.status(prior.sessionToken),{code:'SSO_LOGIN_REQUIRED'});
 }finally{await f.close()}
});
test('original signed profile without Social cannot receive OP identity; redirect, scope, nonce, method are strict',async()=>{
 const f=await fixture();try{const client=registry.find(c=>c.productId==='finance'),bound=token(),intent={clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:token(),codeChallenge:token(),codeChallengeMethod:'S256'},initial=f.authority.challenge(intent,bound),replacement=f.authority.replaceProfile(initial.challenge.challengeId,3,bound),session=f.authority.complete(approve(replacement.challenge),bound),r=query();assert.throws(()=>f.authority.oidcAuthorize(r.request,session.sessionToken),{code:'SSO_LOGIN_REQUIRED'});
 for(const patch of [{redirect_uri:'https://evil.test/_synapse/client/oidc/callback'},{client_id:'unregistered'},{scope:'openid social.feed'},{nonce:''},{code_challenge_method:'plain'},{response_type:'token'},{max_age:'7201'}])assert.throws(()=>f.authority.oidcRequest({...r.request,...patch}));
 }finally{await f.close()}
});
test('actual HTTP token/UserInfo flow, schema2 restart and uncertain delivery preserve code consumption',async()=>{
 const f=await fixture();let server;try{f.store.transaction(s=>{s.schemaVersion=2;s.families=[];s.backendNonces=[]});const login=f.login(),r=f.issue(login);server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const value=f.routes.handle({method:req.method,url:req.url,headers:req.headers,body});res.writeHead(value.status,value.headers);res.end(value.body)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const response=await fetch(origin+'/oidc/token',{method:'POST',headers:{...basic(),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:r.code,redirect_uri:config.redirectUri,code_verifier:r.verifier})});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const value=await response.json();claims(value,f.authority.oidcJwks());const user=await fetch(origin+'/oidc/userinfo',{headers:{authorization:'Bearer '+value.access_token}});assert.equal(user.status,200);assert.equal((await user.json()).sub,identity.account);
 const restarted=new CentralBrowserSessionAuthority(registry,new CentralBrowserSessionStore(f.path),f.options);assert.throws(()=>restarted.oidcRedeem({grant_type:'authorization_code',code:r.code,redirect_uri:config.redirectUri,code_verifier:r.verifier},basic()),{code:'OIDC_CODE_INVALID'});assert.equal(restarted.oidcUserInfo(value.access_token).sub,identity.account);assert.equal(f.store.snapshot().schemaVersion,2);
 const old=f.issue(login),failureStore={transaction:action=>{const result=f.store.transaction(action);throw new Error('controlled lost response after durable commit')}},failed=new CentralBrowserSessionAuthority(registry,failureStore,f.options);assert.throws(()=>failed.oidcRedeem({grant_type:'authorization_code',code:old.code,redirect_uri:config.redirectUri,code_verifier:old.verifier},basic()));assert.throws(()=>restarted.oidcRedeem({grant_type:'authorization_code',code:old.code,redirect_uri:config.redirectUri,code_verifier:old.verifier},basic()),{code:'OIDC_CODE_INVALID'});
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close()}
});
test('operator credential loader is explicit/default-off and rejects exposed files, symlinks and weak keys',async()=>{
 // Home's already protected ancestors avoid treating world-writable /tmp as a
 // deployable credentials root. This is a dedicated temporary QA directory.
 const directory=await mkdtemp(join(homedir(),'.ynx-oidc-source-qa-'));await chmod(directory,0o700);try{const path=join(directory,'config.json'),key=join(directory,'signing.pem'),credential=join(directory,'credential');await writeFile(key,config.signingKey,{mode:0o600});await writeFile(credential,config.clientSecret,{mode:0o600});await writeFile(path,JSON.stringify({schemaVersion:'ynx-central-oidc-rp/v1',clientId:config.clientId,redirectUri:config.redirectUri,clientSecretFile:credential,signingKeyFile:key,keyId:config.keyId}),{mode:0o600});assert.equal(loadCentralOIDCConfiguration(null),null);const weak=generateKeyPairSync('rsa',{modulusLength:1024,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});assert.throws(()=>createCentralOIDCProvider({...config,signingKey:weak.privateKey}),{code:'OIDC_CONFIG_INVALID'});assert.equal(loadCentralOIDCConfiguration(path).clientId,config.clientId);await chmod(credential,0o644);assert.throws(()=>loadCentralOIDCConfiguration(path),{code:'OIDC_CONFIG_INVALID'});await chmod(credential,0o600);await symlink(path,join(directory,'link'));assert.throws(()=>loadCentralOIDCConfiguration(join(directory,'link')),{code:'OIDC_CONFIG_INVALID'});
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('actual gateway HTTP mount completes original Wallet consent, fixed RP code and separate token/UserInfo',async()=>{
 const f=await fixture();let server;try{
  const host=new ProductSessionGatewayNodeHost(products,{now:()=>new Date(f.now()),statePath:join(f.directory,'product-state'),tokenFactory:token,centralBrowser:true,centralOIDC:config});server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,r=query(),url=origin+'/oidc/authorize?'+new URLSearchParams(r.request);
  const discovery=await fetch(origin+'/.well-known/openid-configuration');assert.equal(discovery.status,200);assert.equal((await discovery.json()).issuer,CENTRAL_BROWSER_ISSUER);
  const start=await fetch(url,{redirect:'manual'});assert.equal(start.status,200);const text=await start.text(),context=JSON.parse(text.match(/<script id="context" type="application\/json">([^<]*)<\/script>/)[1]),boundCookie=start.headers.get('set-cookie').split(';')[0];
  const complete=await fetch(origin+'/v2/browser-sessions/complete',{method:'POST',headers:{cookie:boundCookie,origin:CENTRAL_BROWSER_ISSUER,'content-type':'application/json','x-ynx-browser-csrf':context.csrfToken},body:canonicalJSON(approve(context.challenge))});assert.equal(complete.status,200);const signedCookie=complete.headers.get('set-cookie').split(';')[0];
  const authorized=await fetch(url,{headers:{cookie:signedCookie},redirect:'manual'});assert.equal(authorized.status,303);const callback=new URL(authorized.headers.get('location'));assert.equal(callback.origin,new URL(config.redirectUri).origin);assert.equal(callback.searchParams.get('state'),r.request.state);
  const exchange=await fetch(origin+'/oidc/token',{method:'POST',headers:{...basic(),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:callback.searchParams.get('code'),redirect_uri:config.redirectUri,code_verifier:r.verifier})});assert.equal(exchange.status,200);const value=await exchange.json();const info=await fetch(origin+'/oidc/userinfo',{headers:{authorization:'Bearer '+value.access_token}});assert.equal(info.status,200);assert.equal((await info.json()).sub,identity.account);
  const jwks=await (await fetch(origin+'/oidc/jwks')).json();claims(value,jwks);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close()}
});
test('standard POST authorization canonicalizes the same intent and POST UserInfo only accepts header Bearer',async()=>{
 const f=await fixture();let server;try{
  const login=f.login(),r=query(),cookie=centralBrowserCookie(login.sessionToken).split(';')[0];
  server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const value=f.routes.handle({method:req.method,url:req.url,headers:req.headers,body});res.writeHead(value.status,value.headers);res.end(value.body)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const form=new URLSearchParams(r.request).toString(),headers={'content-type':'application/x-www-form-urlencoded',origin:new URL(config.redirectUri).origin,cookie};
  const posted=await fetch(origin+'/oidc/authorize',{method:'POST',headers,body:form,redirect:'manual'});assert.equal(posted.status,303);assert.equal(posted.headers.get('cache-control'),'no-store');const canonical=new URL(posted.headers.get('location'));assert.equal(canonical.origin,CENTRAL_BROWSER_ISSUER);assert.equal(canonical.pathname,'/oidc/authorize');assert.deepEqual(Object.fromEntries(canonical.searchParams),f.authority.oidcRequest(r.request));
  const result=await fetch(origin+canonical.pathname+canonical.search,{headers:{cookie},redirect:'manual'});assert.equal(result.status,303);const code=new URL(result.headers.get('location')).searchParams.get('code');const value=f.redeem({...r,code});
  const user=await fetch(origin+'/oidc/userinfo',{method:'POST',headers:{authorization:'Bearer '+value.access_token}});assert.equal(user.status,200);assert.equal((await user.json()).sub,identity.account);
  for(const [suffix,input,override] of [['?client_id=x',form,{}],['',form+'&state=duplicate',{}],['',form,{origin:'https://evil.test'}],['',form,{'content-type':'application/json'}],['',form,{'sec-fetch-dest':'iframe'}]])assert.equal((await fetch(origin+'/oidc/authorize'+suffix,{method:'POST',headers:{...headers,...override},body:input,redirect:'manual'})).status,400);
  assert.equal((await fetch(origin+'/oidc/userinfo',{method:'POST',headers:{authorization:'Bearer '+value.access_token,'content-type':'application/x-www-form-urlencoded'},body:'access_token='+value.access_token})).status,400);
  assert.equal((await fetch(origin+'/oidc/userinfo',{method:'POST',headers:{authorization:'Bearer '+value.access_token,cookie}})).status,401);
  assert.equal((await fetch(origin+'/oidc/userinfo',{method:'PUT',headers:{authorization:'Bearer '+value.access_token}})).status,405);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close()}
});

test('temporary UserInfo store failures are recoverable service errors, never false token revocation',()=>{
 for(const [code,status,error] of [['SSO_STATE_BUSY',503,'temporarily_unavailable'],['SSO_STATE_LOST',500,'server_error']]){
  const authority=new CentralBrowserSessionAuthority(registry,{transaction(){throw new WalletAuthError(code,'QA')}} ,{oidc:config}),routes=new CentralBrowserSessionNodeRoutes(authority);
  const result=routes.handle({method:'POST',url:'/oidc/userinfo',headers:{authorization:'Bearer '+token()},body:''});assert.equal(result.status,status);assert.equal(JSON.parse(result.body).error,error);assert.equal(result.headers['www-authenticate'],undefined);assert.equal(result.headers['cache-control'],'no-store');
 }
});

test('max_age zero requires exact new Wallet intent even within the original session creation second',async()=>{
 const f=await fixture();try{
  const prior=f.login(),r=query(),request={...r.request,max_age:'0'},url='/oidc/authorize?'+new URLSearchParams(request),cookie=centralBrowserCookie(prior.sessionToken).split(';')[0];
  assert.throws(()=>f.authority.oidcAuthorize(request,prior.sessionToken),{code:'SSO_LOGIN_REQUIRED'});
  const quiet=f.routes.handle({method:'GET',url:'/oidc/authorize?'+new URLSearchParams({...request,prompt:'none'}),headers:{cookie}});assert.equal(quiet.status,303);assert.equal(new URL(quiet.headers.location).searchParams.get('error'),'login_required');assert.equal(new URL(quiet.headers.location).searchParams.has('code'),false);
  const page=f.routes.handle({method:'GET',url,headers:{cookie}});assert.equal(page.status,200);const context=JSON.parse(page.body.match(/<script id="context" type="application\/json">([^<]*)<\/script>/)[1]),bound=page.headers['set-cookie'].split(';')[0].split('=')[1];
  const next=f.authority.complete(approve(context.challenge),bound,prior.sessionToken),result=f.routes.handle({method:'GET',url,headers:{cookie:centralBrowserCookie(next.sessionToken).split(';')[0]}});assert.equal(result.status,303);assert(new URL(result.headers.location).searchParams.get('code'));assert.throws(()=>f.authority.status(prior.sessionToken),{code:'SSO_LOGIN_REQUIRED'});
  assert.throws(()=>f.authority.oidcAuthorize({...request,state:token()},next.sessionToken),{code:'SSO_LOGIN_REQUIRED'});
 }finally{await f.close()}
});
