import {p256} from '@noble/curves/nist.js';import {createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge} from '../src/product-session-v2.js';import {createProductSessionProofV2} from '../src/product-session-proof-v2.js';import {encodeProductSessionGatewayProofHeaderV2} from '../src/product-session-gateway-client.js';import {canonicalJSON} from '../src/canonical.js';import {httpBodyDigest} from '../src/session-proof.js';import {backendBodyDigest} from '../src/central-browser-backend-auth.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {ProductSessionGatewayKernel} from '../src/product-session-gateway.js';import {migrateProductSessionControlSnapshotV2} from '../src/product-session-control-intent.js';import {initializeProductSessionControlState} from '../src/product-session-control-node-store.js';
import {spawn} from 'node:child_process';import {createServer} from 'node:net';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';
async function run(extra={},mode='start'){
 const dir=mkdtempSync(join(tmpdir(),'ynx-private-config-'));const allocator=createServer();await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
 const key=generateKeyPairSync('ed25519');writeFileSync(join(dir,'seal'),randomBytes(32),{mode:0o600});writeFileSync(join(dir,'backends.json'),JSON.stringify({schemaVersion:'ynx-central-backend-clients/v1',familySealKeyFile:join(dir,'seal'),clients:[{clientId:'ynx-music-v1-business-android-v1',keyId:'qa',publicKey:key.publicKey.export({format:'pem',type:'spki'})}]}),{mode:0o600});
 const registration={schemaVersion:'ynx-private-business-registrations/v1',registrations:[{productId:'music',platform:'android',keyId:'qa',allowedScopes:['music.library']}]};
 writeFileSync(join(dir,'registrations.json'),JSON.stringify(registration),{mode:mode==='unprotected'?0o644:0o600});symlinkSync(join(dir,'registrations.json'),join(dir,'linked.json'));
 const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('YNX_'))delete env[name];Object.assign(env,{YNX_WALLET_GATEWAY_HTTP_PORT:String(port),YNX_WALLET_GATEWAY_STATE_PATH:join(dir,'legacy'),YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH:join(dir,'product'),...extra});
 for(const [name,value]of Object.entries(env))if(typeof value==='string'&&value.startsWith('$DIR/'))env[name]=join(dir,value.slice(5));
 if(mode==='v3'||mode==='v3-http'){const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url)));initializeProductSessionControlState(join(dir,'product'),migrateProductSessionControlSnapshotV2(new ProductSessionGatewayKernel(registry,()=>randomBytes(32).toString('base64url')).snapshot()));}
 const child=spawn(process.execPath,['scripts/ynx-wallet-gatewayd.mjs'],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 try{
  const outcome=await Promise.race([new Promise(resolve=>child.once('exit',code=>resolve({code}))),new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(stdout.includes('"event":"listening"')){clearInterval(timer);resolve({started:true})}else if(Date.now()-started>5000){clearInterval(timer);reject(Error('daemon startup deadline'))}},20);child.once('exit',()=>clearInterval(timer))})]);
  if(outcome.started){
   if(mode==='v3-http'){
    const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url))),token=()=>randomBytes(32).toString('base64url'),device=new Uint8Array(32).fill(3),secret=Buffer.from(device).toString('base64url'),base=`http://127.0.0.1:${port}`;
    const call=async(path,body,headers={})=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-request-id':'req_'+token(),...headers},body:canonicalJSON(body)});return{status:response.status,value:await response.json()}};
    const request=createProductSessionRequest(registry,{productId:'music',platform:'android',deviceId:token(),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['music.library'],purpose:'Explicit local daemon QA',nonce:token(),state:token()}),approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt});
    const challenge=await call('/v2/product-sessions/challenge',{request,approval});assert.equal(challenge.status,200);const complete=await call('/v2/product-sessions/complete',{request,approval,completion:signProductSessionChallenge(challenge.value.result,secret)});assert.equal(complete.status,200);const session=complete.value.result,path='/v2/browser-sessions/product-revalidate',input={clientId:'ynx-music-v1-business-android-v1',session,requiredScopes:['music.library']};
    function backend(body,patch={}){const unsigned={version:1,issuer:'https://wallet-auth.ynxweb4.com',audience:'https://wallet-auth.ynxweb4.com/v2/browser-sessions',clientId:input.clientId,keyId:'qa',method:'POST',path,bodySha256:backendBodyDigest(body),issuedAt:new Date().toISOString(),nonce:token(),...patch};return{'x-ynx-backend-proof':Buffer.from(canonicalJSON({...unsigned,signature:sign(null,Buffer.from(canonicalJSON(unsigned)),key.privateKey).toString('base64url')})).toString('base64url')};}
    const active=await call(path,input,backend(input));assert.equal(active.status,200);assert.deepEqual(active.value.session,session);
    for(const changed of [{...input,requiredScopes:['music.creator']},{...input,session:{...session,platform:'ios',origin:'app://ios/com.ynxweb4.music'}},{...input,session:{...session,account:'other'}}])assert.notEqual((await call(path,changed,backend(changed))).status,200);
    const proof=backend(input);assert.equal((await call(path,input,proof)).status,200);assert.notEqual((await call(path,input,proof)).status,200);assert.notEqual((await call(path,input,backend(input,{keyId:'wrong'}))).status,200);
    const route='/v2/product-sessions/revoke',now=new Date(),header=encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session,{method:'POST',path:route,bodyDigest:httpBodyDigest('{}'),nonce:token(),issuedAt:now.toISOString(),expiresAt:new Date(+now+30000).toISOString()},secret));assert.equal((await call(route,{}, {'x-ynx-product-session-proof-v2':header})).status,200);assert.equal((await call(path,input,backend(input))).value.error.code,'SESSION_REVOKED');
    return{...outcome,realPrivateHttp:'PASS',stdout,stderr};
   }
   const response=await fetch(`http://127.0.0.1:${port}/v2/browser-sessions/product-revalidate`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return{...outcome,status:response.status,stdout,stderr}}
  return{...outcome,stdout,stderr};
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}rmSync(dir,{recursive:true,force:true})}
}
test('daemon default leaves private authority off and explicit protected registration starts V2 and migrated V3',async()=>{
 const off=await run();assert.equal(off.started,true);assert.notEqual(off.status,200);
 const on=await run({YNX_CENTRAL_BROWSER_SSO:'true',YNX_PRIVATE_BUSINESS_REVALIDATION:'true',YNX_PRIVATE_BUSINESS_REGISTRATION_FILE:'$DIR/registrations.json',YNX_CENTRAL_BROWSER_BACKEND_CONFIG_FILE:'$DIR/backends.json'});assert.equal(on.started,true);assert.notEqual(on.status,200);
 const v3=await run({YNX_CENTRAL_BROWSER_SSO:'true',YNX_PRIVATE_BUSINESS_REVALIDATION:'true',YNX_PRIVATE_BUSINESS_REGISTRATION_FILE:'$DIR/registrations.json',YNX_CENTRAL_BROWSER_BACKEND_CONFIG_FILE:'$DIR/backends.json',YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION:'3'},'v3');assert.equal(v3.started,true);assert.notEqual(v3.status,200);
});
test('daemon registration is explicit, protected and cannot bypass control-host capability',async()=>{
 const cases=[{YNX_PRIVATE_BUSINESS_REVALIDATION:'true'},{YNX_CENTRAL_BROWSER_SSO:'true',YNX_PRIVATE_BUSINESS_REGISTRATION_FILE:'$DIR/registrations.json'},{YNX_CENTRAL_BROWSER_SSO:'true',YNX_PRIVATE_BUSINESS_REVALIDATION:'true',YNX_PRIVATE_BUSINESS_REGISTRATION_FILE:'$DIR/registrations.json',YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION:'3'}];
 for(const env of cases){const result=await run(env);assert.notEqual(result.code,0);assert.equal(result.started,undefined)}
 const env={YNX_CENTRAL_BROWSER_SSO:'true',YNX_PRIVATE_BUSINESS_REVALIDATION:'true',YNX_PRIVATE_BUSINESS_REGISTRATION_FILE:'$DIR/registrations.json',YNX_CENTRAL_BROWSER_BACKEND_CONFIG_FILE:'$DIR/backends.json'};
 for(const [extra,mode]of [[{},'unprotected'],[{YNX_PRIVATE_BUSINESS_REGISTRATION_FILE:'$DIR/linked.json'},'start']]){const result=await run({...env,...extra},mode);assert.notEqual(result.code,0);assert.equal(result.started,undefined)}
});

test('actual daemon V3 uses protected private registration/key files and retains revoke/tuple/scope/replay gates',async()=>{
 const result=await run({YNX_CENTRAL_BROWSER_SSO:'true',YNX_PRIVATE_BUSINESS_REVALIDATION:'true',YNX_PRIVATE_BUSINESS_REGISTRATION_FILE:'$DIR/registrations.json',YNX_CENTRAL_BROWSER_BACKEND_CONFIG_FILE:'$DIR/backends.json',YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION:'3'},'v3-http');assert.equal(result.realPrivateHttp,'PASS');
});
