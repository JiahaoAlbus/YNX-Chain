import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createWalletReadinessService} from '../src/service.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const instant=Date.parse('2026-10-31T12:00:00.000Z');
function response(){const value={name:'Hello',source:'contract Hello {}',deployedBytecode:'0x6000',constructorArgs:[],idempotencyKey:'qa-deployment-time-001'};
 const payload={...value,requestHash:sha(JSON.stringify({domain:'YNX_IDE_REQUEST_V1',action:'ide_contract_deploy',value}))};
 const signedTransaction={version:1,chainId:6423,type:'application_action',signer:`0x${'3'.repeat(40)}`,nonce:1,action:'ide_contract_deploy',payload,payloadHash:sha(JSON.stringify(payload)),fee:1,aiUnits:0,payUnits:0,publicKey:`02${'6'.repeat(64)}`,signature:`30${'7'.repeat(134)}`};
 const raw=Buffer.from(JSON.stringify(signedTransaction));
 return {version:'1',requestDigest:'8'.repeat(64),productClientId:'ynx-developer-v1',bundleId:'com.ynxweb4.developer.testnetpreview',callback:'ynxdeveloper://deployment/callback',sessionBinding:'1'.repeat(64),account:'ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmcn030',action:'ide_contract_deploy',artifactDigest:sha(`YNX_DEVELOPER_ARTIFACT_V1\n${canonical(value)}`),signedTransaction,canonicalPayloadHex:`0x${raw.toString('hex')}`,transactionHash:`0x${sha(raw)}`,issuedAt:'2026-10-31T11:59:00.000Z',expiresAt:'2026-10-31T12:01:00.000Z'};
}
async function fixture(t,{now=()=>instant,onIntrospection=()=>{}}={}){
 let effects=0;const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
 const fetcher=async url=>{if(String(url).endsWith('/health'))return json({ok:true,remoteDeployed:true});if(String(url).endsWith('/ready'))return json({ok:true,runtimeReady:true,publicDeploymentReady:true});if(String(url).endsWith('/version'))return json({ok:true,build:{sourceCommit:'a'.repeat(40),release:'wallet-auth-testnet-preview',buildTime:'2026-10-31T00:00:00.000Z'},registrySha256:'b'.repeat(64),enabledProductClientIds:['ynx-developer-v1']});onIntrospection();return json({ok:true,result:{active:true,session:{sessionBinding:'1'.repeat(64),account:response().account,scopes:['account:read','developer:deploy']}}});};
 const service=createWalletReadinessService({ownerForRequest:()=> 'qa-owner',fetcher,now,ideActionPublicReady:true,chainFetcher:async url=>{if(String(url).endsWith('/ide/deploy')){effects++;return json({accepted:true},201);}return json({result:{transactionHash:response().transactionHash,status:'0x1',blockNumber:'0x1'}});}});
 const server=createServer((req,res)=>service.handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 return {effects:()=>effects,send:async value=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/runtime/wallet/deployments/broadcast`,{method:'POST',headers:{'content-type':'application/json'},body:canonical({proof:{version:'1'},response:value})});return {status:res.status,body:await res.json()};}};
}
test('server refuses expired, future, inverted and noncanonical callback times before Chain effects',async t=>{
 const f=await fixture(t);
 for(const change of [{expiresAt:'2026-10-31T12:00:00.000Z'},{issuedAt:'2026-10-31T12:00:30.000Z'},{expiresAt:'2026-10-31T11:58:00.000Z'},{expiresAt:'garbage'},{issuedAt:'2026-10-31T11:59:00Z'}]){
  const r=await f.send({...response(),...change});assert.equal(r.status,403,JSON.stringify(r.body));assert.equal(r.body.code,'deployment_approval_expired');
 }
 assert.equal(f.effects(),0);
});
test('expiry during original session introspection does not dispatch a deployment',async t=>{
 let clock=instant;const f=await fixture(t,{now:()=>clock,onIntrospection:()=>{clock+=120000;}});
 assert.equal((await f.send(response())).body.code,'deployment_approval_expired');assert.equal(f.effects(),0);
});
test('valid legacy response keeps its original bytes and existing receipt flow',async t=>{
 const f=await fixture(t);const r=await f.send(response());assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.deployment.confirmed,true);assert.equal(f.effects(),1);
});
