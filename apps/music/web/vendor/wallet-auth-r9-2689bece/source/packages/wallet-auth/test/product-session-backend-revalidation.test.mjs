import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {p256} from '@noble/curves/nist.js';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge} from '../src/product-session-v2.js';
import {createProductSessionProofV2} from '../src/product-session-proof-v2.js';
import {encodeProductSessionGatewayProofHeaderV2} from '../src/product-session-gateway-client.js';
import {canonicalJSON} from '../src/canonical.js';
import {httpBodyDigest} from '../src/session-proof.js';
import {backendBodyDigest} from '../src/central-browser-backend-auth.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url)));
const issuer='https://wallet-auth.ynxweb4.com',path='/v2/browser-sessions/product-revalidate',clientId='ynx-social-v1-sso-v1',token=()=>randomBytes(32).toString('base64url'),device=new Uint8Array(32).fill(3),secret=Buffer.from(device).toString('base64url');
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'ynx-product-read-'));let now=new Date();const key=generateKeyPairSync('ed25519');
 const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'state'),now:()=>now,tokenFactory:token,centralBrowser:true,centralBackend:{backendClients:[{clientId,keyId:'qa',publicKey:key.publicKey.export({format:'pem',type:'spki'})}],familySealKey:randomBytes(32)}});
 const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 async function call(route,body,headers={}) {const response=await fetch(url+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:canonicalJSON(body),signal:AbortSignal.timeout(5000)});return {status:response.status,body:await response.json()};}
 function deviceHeaders(session,route,body){return {'x-request-id':'req_'+token(),origin:'https://social.ynxweb4.com','x-ynx-product-session-proof-v2':encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session,{method:'POST',path:route,bodyDigest:httpBodyDigest(canonicalJSON(body)),nonce:token(),issuedAt:now.toISOString(),expiresAt:new Date(Math.min(+now+30000,Date.parse(session.expiresAt))).toISOString()},secret))};}
 const request=createProductSessionRequest(registry,{productId:'social',platform:'web',deviceId:token(),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['social.contacts','social.feed','social.messaging','social.profile'],purpose:'Read isolated Social account',nonce:token(),state:token()},now);
 const approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},now);
 const headers={'x-request-id':'req_'+token(),origin:'https://social.ynxweb4.com'};
 const challenge=await call('/v2/product-sessions/challenge',{request,approval},headers);assert.equal(challenge.status,200);
 const complete=await call('/v2/product-sessions/complete',{request,approval,completion:signProductSessionChallenge(challenge.body.result,secret)}, {...headers,'x-request-id':'req_'+token()});assert.equal(complete.status,200);const session=complete.body.result;
 const input={clientId,session,requiredScopes:['social.feed']};
 function backend(input,patch={}){const payload={version:1,issuer,audience:issuer+'/v2/browser-sessions',clientId,keyId:'qa',method:'POST',path,bodySha256:backendBodyDigest(input),issuedAt:now.toISOString(),nonce:token(),...patch};return {'x-ynx-backend-proof':Buffer.from(canonicalJSON({...payload,signature:sign(null,Buffer.from(canonicalJSON(payload)),key.privateKey).toString('base64url')})).toString('base64url')};}
 return {host,input,session,backend,call,deviceHeaders,advance(ms){now=new Date(+now+ms)},close:async()=>{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true})}};
}
test('real mounted HTTP backend read retains session, consumes fresh server nonce, never consumes device proof or changes private state',async()=>{const f=await fixture();try{
 const before=canonicalJSON(f.host.snapshot());const headers=f.backend(f.input);
 assert.deepEqual(await f.call(path,f.input,headers),{status:200,body:{active:true,session:f.session}});
 assert.equal(canonicalJSON(f.host.snapshot()),before);
 const replay=await f.call(path,f.input,headers);assert.equal(replay.body.error.code,'SSO_BACKEND_AUTH_REPLAY');
 assert.equal((await f.call(path,f.input,f.backend(f.input))).status,200);
 const route='/v2/product-sessions/introspect',body={requiredScopes:['social.feed']},proof=f.deviceHeaders(f.session,route,body);
 assert.equal((await f.call(route,body,proof)).status,200);
 assert.equal((await f.call(route,body,{...proof,'x-request-id':'req_'+token()})).body.error.code,'REPLAY');
 assert.equal((await f.call(path,f.input,f.backend(f.input))).status,200);
}finally{await f.close()}});
test('real backend route rejects browser credentials, other tuple, widening scopes, forged body and key before live read',async()=>{const f=await fixture();try{
 assert.equal((await f.call(path,f.input,{...f.backend(f.input),origin:issuer})).body.error.code,'SSO_BACKEND_ONLY');
 for(const patch of [{path:'/v2/browser-sessions/renew'},{keyId:'other'},{bodySha256:'0'.repeat(64)}])assert.equal((await f.call(path,f.input,f.backend(f.input,patch))).body.error.code,'SSO_BACKEND_AUTH_INVALID');
 const altered={...f.input,session:{...f.session,account:'ynx1'+'q'.repeat(38)}};assert.notEqual((await f.call(path,altered,f.backend(altered))).status,200);
 const widened={...f.input,requiredScopes:['social.ai']};assert.equal((await f.call(path,widened,f.backend(widened))).body.error.code,'SCOPE_WIDENING');
}finally{await f.close()}});
for(const route of ['/v2/product-sessions/revoke','/v2/product-sessions/devices/revoke'])test(`original live HTTP ${route} during await rejects old backend read without granting or renewing`,async()=>{const f=await fixture();try{
 assert.equal((await f.call(path,f.input,f.backend(f.input))).status,200);
 const revoked=await f.call(route,{},f.deviceHeaders(f.session,route,{}));assert.equal(revoked.status,200);
 assert.equal((await f.call(path,f.input,f.backend(f.input))).body.error.code,'SESSION_REVOKED');
}finally{await f.close()}});
test('original expiry remains binding and backend unavailable never succeeds',async()=>{const f=await fixture();try{f.advance(241000);assert.equal((await f.call(path,f.input,f.backend(f.input))).body.error.code,'SESSION_EXPIRED');}finally{await f.close()}});
