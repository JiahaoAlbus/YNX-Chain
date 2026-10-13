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
const issuer='https://wallet-auth.ynxweb4.com',path='/v2/browser-sessions/product-revalidate',clientId='ynx-mail-v1-sso-v1',token=()=>randomBytes(32).toString('base64url'),device=new Uint8Array(32).fill(3),secret=Buffer.from(device).toString('base64url');
async function fixture(platform='web',businessRevalidation=true){
 const directory=mkdtempSync(join(tmpdir(),'ynx-product-read-'));let now=new Date();const key=generateKeyPairSync('ed25519');
 const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'state'),now:()=>now,tokenFactory:token,centralBrowser:true,centralBrowserEcosystem:true,businessRevalidation,centralBackend:{backendClients:[{clientId,keyId:'qa',publicKey:key.publicKey.export({format:'pem',type:'spki'})}],familySealKey:randomBytes(32)}});
 const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 async function call(route,body,headers={}) {const response=await fetch(url+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:canonicalJSON(body),signal:AbortSignal.timeout(5000)});return {status:response.status,body:await response.json()};}
 function deviceHeaders(session,route,body){return {'x-request-id':'req_'+token(),...(platform==='web'?{origin:'https://mail.ynxweb4.com'}:{}),'x-ynx-product-session-proof-v2':encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session,{method:'POST',path:route,bodyDigest:httpBodyDigest(canonicalJSON(body)),nonce:token(),issuedAt:now.toISOString(),expiresAt:new Date(Math.min(+now+30000,Date.parse(session.expiresAt))).toISOString()},secret))};}
 const request=createProductSessionRequest(registry,{productId:'mail',platform,deviceId:token(),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['mail:account'],purpose:'Read isolated Social account',nonce:token(),state:token()},now);
 const approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},now);
 const headers={'x-request-id':'req_'+token(),...(platform==='web'?{origin:'https://mail.ynxweb4.com'}:{})};
 const challenge=await call('/v2/product-sessions/challenge',{request,approval},headers);assert.equal(challenge.status,200);
 const complete=await call('/v2/product-sessions/complete',{request,approval,completion:signProductSessionChallenge(challenge.body.result,secret)}, {...headers,'x-request-id':'req_'+token()});assert.equal(complete.status,200);const session=complete.body.result;
 const input={clientId,session,requiredScopes:['mail:account']};
 function backend(input,patch={}){const payload={version:1,issuer,audience:issuer+'/v2/browser-sessions',clientId,keyId:'qa',method:'POST',path,bodySha256:backendBodyDigest(input),issuedAt:now.toISOString(),nonce:token(),...patch};return {'x-ynx-backend-proof':Buffer.from(canonicalJSON({...payload,signature:sign(null,Buffer.from(canonicalJSON(payload)),key.privateKey).toString('base64url')})).toString('base64url')};}
 return {host,input,session,backend,call,deviceHeaders,advance(ms){now=new Date(+now+ms)},close:async()=>{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true})}};
}

for(const platform of ['web','android'])test(`actual registered Mail ${platform} backend afterawait uses original tuple and live revoke`,async()=>{const f=await fixture(platform);try{
 const before=canonicalJSON(f.host.snapshot());assert.equal((await f.call(path,f.input,f.backend(f.input))).status,200);assert.equal(canonicalJSON(f.host.snapshot()),before);
 const headers=f.backend(f.input);assert.equal((await f.call(path,f.input,headers)).status,200);assert.equal((await f.call(path,f.input,headers)).body.error.code,'SSO_BACKEND_AUTH_REPLAY');
 const altered={...f.input,session:{...f.session,origin:'https://finance.ynxweb4.com'}};assert.notEqual((await f.call(path,altered,f.backend(altered))).status,200);
 const widened={...f.input,requiredScopes:['mail:recover']};assert.equal((await f.call(path,widened,f.backend(widened))).body.error.code,'SCOPE_WIDENING');
 const wrong={...f.input,clientId:'ynx-finance-v1-sso-v1'};assert.notEqual((await f.call(path,wrong,f.backend(wrong))).status,200);
 const route='/v2/product-sessions/revoke';assert.equal((await f.call(route,{},f.deviceHeaders(f.session,route,{}))).status,200);assert.equal((await f.call(path,f.input,f.backend(f.input))).body.error.code,'SESSION_REVOKED');
}finally{await f.close()}});
test('generic backend adoption is explicit; legacy mode rejects Mail without granting or changing authority',async()=>{const f=await fixture('web',false);try{const before=canonicalJSON(f.host.snapshot());assert.equal((await f.call(path,f.input,f.backend(f.input))).body.error.code,'SSO_CLIENT_MISMATCH');assert.equal(canonicalJSON(f.host.snapshot()),before)}finally{await f.close()}});
