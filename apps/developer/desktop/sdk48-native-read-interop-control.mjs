import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('./',import.meta.url));
const sdkRoot=process.env.YNX_IDE_PUBLIC_READ_INTEROP_SDK_ROOT;
assert.equal(typeof sdkRoot,'string');
const metadata=JSON.parse(await readFile(join(sdkRoot,'package.json'),'utf8'));assert.equal(metadata.version,'1.3.0-pq.3.32-auth.48');
const {createProductWalletBusinessReadClient}=await import(pathToFileURL(join(sdkRoot,'src/product-wallet-connection.js')));
const {canonicalJSON}=await import(pathToFileURL(join(sdkRoot,'src/canonical.js')));
const {verifyProductSessionProofV2}=await import(pathToFileURL(join(sdkRoot,'src/product-session-proof-v2.js')));
const registry=JSON.parse(await readFile(join(sdkRoot,'product-session-registry.json'),'utf8'));
const child=spawn(process.env.YNX_IDE_PUBLIC_READ_INTEROP_BINARY,[],{stdio:['pipe','pipe','pipe']});
const pending=new Map();let firstResolve,firstReject,seq=0,signs=0,reads=0,writes=0,networkCalls=0;
const fixture=new Promise((resolve,reject)=>{firstResolve=resolve;firstReject=reject;});
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{let value;try{value=JSON.parse(line);}catch(error){firstReject(error);return;}
 if(firstResolve){const resolve=firstResolve;firstResolve=null;resolve(value);return;}
 const row=pending.get(value.id);if(!row)return;pending.delete(value.id);clearTimeout(row.timer);value.ok?row.resolve(value.value):row.reject(Error('PUBLIC native read rejected'));
});
let diagnostics='';child.stderr.on('data',chunk=>diagnostics+=String(chunk).slice(0,2048));
child.once('error',error=>firstReject(error));
const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{firstReject(Error('PUBLIC child exited before fixture'));for(const row of pending.values()){clearTimeout(row.timer);row.reject(Error('PUBLIC child exited'));}pending.clear();resolve({code,signal});}));
const rpc=input=>new Promise((resolve,reject)=>{const id=String(++seq),timer=setTimeout(()=>{pending.delete(id);reject(Error('PUBLIC interop timeout'));},5000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,input})+'\n');});
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 networkCalls++;
 assert.equal(String(url),'https://wallet-auth.ynxweb4.com/v2/product-sessions/time');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
 const requestId=new Headers(options.headers).get('x-request-id');
 return new Response(canonicalJSON({ok:true,requestId,result:{serverTime:new Date().toISOString()},schemaVersion:2}),{status:200,headers:{'content-type':'application/json','x-request-id':requestId,'cache-control':'no-store'}});
};
try{
 const f=await fixture;assert.equal(f.device.id,'ynx-developer-macos-device-v2');
 const storage={securityLevel:'os-protected',get:async key=>{reads++;return rpc({operation:'get',key});},set:async()=>{writes++;throw Error('PUBLIC no writes allowed');},remove:async()=>{writes++;throw Error('PUBLIC no removals allowed');}};
 const device={...f.device,sign:async input=>{signs++;return rpc({operation:'sign',input});}};
 const client=await createProductWalletBusinessReadClient({registry,productId:'developer',platform:'macos',storage,device,gatewayTimeoutMs:1000});
 assert.equal(networkCalls,0);assert.equal(signs,0);assert.equal(writes,0);assert.ok(reads>0);assert.equal(client.capabilities.newSession,false);
 const path='/api/v1/ide/deployments/'+f.requestId;
 await assert.rejects(client.createBusinessProof({method:'POST',path,body:'',requiredScopes:['account:read']}),{code:'HTTP_BINDING_MISMATCH'});
 assert.equal(networkCalls,0);assert.equal(signs,0);
 const actual=await client.createBusinessProof({method:'GET',path,body:'',requiredScopes:['account:read']});
 assert.equal(networkCalls,2);assert.equal(signs,1);assert.equal(writes,0);
 const session=JSON.parse(f.sessionRaw);const verified=verifyProductSessionProofV2(actual.proof,session,{method:'GET',path,bodyDigest:actual.proof.bodyDigest});
 assert.equal(verified.sessionBinding,session.sessionBinding);assert.equal(actual.body,'');assert.equal(typeof actual.proofHeader,'string');
 client.close();await assert.rejects(client.createBusinessProof({method:'GET',path,body:'',requiredScopes:['account:read']}));
 assert.equal(networkCalls,2);assert.equal(signs,1);
 console.log(JSON.stringify({actualPackagedSDK:metadata.version,actualNativeP256SignatureVerified:true,readOnlyOpening:true,openingNetworkCalls:0,openingSignCalls:0,controlledTimeResponses:networkCalls,nativeSignCalls:signs,storageWrites:writes,POSTRejected:true,closedReadRejected:true,publicFakeSource:true,authorityTimeMocked:true,actualNetworkCalls:0,SourceAdmitted:false,installedApp:false}));
}finally{
 globalThis.fetch=originalFetch;child.stdin.end();
 const timer=setTimeout(()=>child.kill('SIGTERM'),2000);const ended=await exit;clearTimeout(timer);lines.close();
 if(ended.code!==0)throw Error('PUBLIC native child exit '+JSON.stringify(ended)+' '+diagnostics);
}
