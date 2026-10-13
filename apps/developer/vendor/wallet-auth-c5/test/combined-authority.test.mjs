import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {createInterface} from 'node:readline';
import * as filesystem from 'node:fs';
import {ProductSessionControlNodeHost} from '../src/product-session-control-node-host.js';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalJSON} from '../src/canonical.js';import {backendBodyDigest} from '../src/central-browser-backend-auth.js';
const source=fileURLToPath(new URL('../../../',import.meta.url)),path='/v2/browser-sessions/product-browser-revalidate',issuer='https://wallet-auth.ynxweb4.com',token=()=>randomBytes(32).toString('base64url');
async function fixture(off=false){
 const directory=mkdtempSync(join(tmpdir(),'ynx-combined-authority-')),key=generateKeyPairSync('ed25519');
 const child=spawn(process.execPath,[join(source,'internal/productsessionv2/testdata/combined-authority-node.mjs')],{env:{...process.env,YNX_QA_CENTRAL_SOURCE:source,YNX_QA_PRODUCT_ID:'ai',YNX_QA_PLATFORM:'web',YNX_QA_PUBLIC_KEY:key.publicKey.export({format:'pem',type:'spki'}),YNX_QA_STATE_PATH:join(directory,'authority'),YNX_QA_COMBINED_OFF:off?'1':'0'},stdio:['ignore','pipe','pipe']});
 let diagnostic='';child.stderr.on('data',c=>diagnostic+=c);const lines=createInterface({input:child.stdout});const [line]=await Promise.race([once(lines,'line'),once(child,'exit').then(()=>{throw Error('fixture failed: '+diagnostic)})]);const ready=JSON.parse(line);lines.close();
 const input={clientId:'ynx-ai-v1-business-web-v1',session:ready.session,requiredScopes:['ai:conversations'],browser:{clientId:'ynx-ai-v1-sso-v1',origin:'https://assistant.ynxweb4.com',grant:ready.browserGrant}};
 function proof(body,patch={}){const unsigned={version:1,issuer,audience:issuer+'/v2/browser-sessions',clientId:body.clientId,keyId:'qa',method:'POST',path,bodySha256:backendBodyDigest(body),issuedAt:new Date().toISOString(),nonce:token(),...patch};return {'x-ynx-backend-proof':Buffer.from(canonicalJSON({...unsigned,signature:sign(null,Buffer.from(canonicalJSON(unsigned)),key.privateKey).toString('base64url')})).toString('base64url')};}
 async function call(body=input,headers=proof(body)){const r=await fetch(ready.url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:canonicalJSON(body),signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};}
 const snapshot=()=>JSON.parse(readFileSync(join(directory,'authority.browser'))).snapshot;
 return {input,proof,call,snapshot,directory,async close(){const exit=once(child,'exit');child.kill();await exit;rmSync(directory,{recursive:true,force:true})}};
}
test('combined route requires original backend role, body/path signature and server-only transport',async()=>{const f=await fixture();try{
 const before=f.snapshot();const ok=await f.call();assert.equal(ok.status,200);assert.deepEqual(ok.body,{active:true,session:f.input.session,browser:f.input.browser});const after=f.snapshot();for(const field of ['sessions','grants','families'])assert.deepEqual(after[field]??[],before[field]??[],'read must not renew '+field);
 const reuse=f.proof(f.input);assert.equal((await f.call(f.input,reuse)).status,200);assert.equal((await f.call(f.input,reuse)).body.error.code,'SSO_BACKEND_AUTH_REPLAY');
 for(const headers of [{origin:f.input.browser.origin},{cookie:'x=y'},{'sec-fetch-site':'same-origin'}])assert.equal((await f.call(f.input,{...f.proof(f.input),...headers})).status,403);
 for(const patch of [{keyId:'foreign'},{path:'/v2/browser-sessions/product-revalidate'},{method:'GET'},{clientId:'ynx-mail-v1-business-web-v1'},{bodySha256:'0'.repeat(64)}])assert.notEqual((await f.call(f.input,f.proof(f.input,patch))).status,200);
 assert.notEqual((await f.call(f.input,{})).status,200);
 for(const patch of [{clientId:'ynx-mail-v1-sso-v1'},{origin:'https://mail.ynxweb4.com'},{grant:{...f.input.browser.grant,audience:'ynx:mail:identity'}},{grant:{...f.input.browser.grant,scopes:['ai:generate']}},{grant:{...f.input.browser.grant,csrf:''}},{grant:{...f.input.browser.grant,expiresAt:new Date(Date.parse(f.input.browser.grant.expiresAt)+1000).toISOString()}},{grant:{...f.input.browser.grant,identity:{...f.input.browser.grant.identity,generation:2}}}]){const input={...f.input,browser:{...f.input.browser,...patch}};assert.notEqual((await f.call(input)).status,200);}
 for(const scopes of [[],['ai:generate'],['identity:read'],['ai:conversations','ai:conversations']])assert.notEqual((await f.call({...f.input,requiredScopes:scopes})).status,200);
}finally{await f.close()}});
test('combined route remains closed with default adoption flags',async()=>{const f=await fixture(true);try{assert.equal((await f.call()).body.error.code,'SSO_BACKEND_NOT_CONFIGURED')}finally{await f.close()}});

test('V3 reader rereads protected state after its synchronous kernel decision',async()=>{const f=await fixture();try{
 const statePath=join(f.directory,'authority'),registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url)));
 let reads=0,armed=false;const io={...filesystem,openSync(path,...args){if(path===statePath&&armed&&++reads===2)throw Error('controlled second protected read unavailable');return filesystem.openSync(path,...args)}};
 const host=new ProductSessionControlNodeHost(registry,{statePath,now:()=>new Date(),tokenFactory:token,io});
 armed=true;assert.throws(()=>host.revalidate(f.input.session,f.input.requiredScopes,'ai',new Date(),true),error=>error.code==='STATE_READ_FAILED');assert.equal(reads,2);
 armed=false;const before=readFileSync(statePath);assert.equal(host.revalidate(f.input.session,f.input.requiredScopes,'ai',new Date(),true).active,true);assert.deepEqual(readFileSync(statePath),before);
}finally{await f.close()}});
