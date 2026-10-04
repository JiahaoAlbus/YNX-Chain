import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPublicRuntime} from '../scripts/verify-public-runtime.mjs';
import {QUANT_RUNTIME_WEB_ASSETS} from '../scripts/verify-versioned-assets.mjs';

const commit='a'.repeat(40),release=`ynx-quant-lab-${commit.slice(0,12)}`;
function fixture() {
  const entries=QUANT_RUNTIME_WEB_ASSETS.map(name=>({path:`${release}/apps/quant-lab/web/${name}`,bytes:Buffer.byteLength(name),sha256:createHash('sha256').update(name).digest('hex')}));
  const manifest={schemaVersion:1,productId:'ynx-quant-lab',sourceCommit:commit,sourceTree:'b'.repeat(40),release,entries};
  const calls=[];
  const request=async(url,options)=>{
    calls.push({url,options});
    const route=new URL(url).pathname;
    if(route.startsWith('/api/'))return Response.json({productId:manifest.productId,commit,status:'ok',liveFundsEnabled:false,ready:false,storage:{multiInstance:false}});
    return new Response(route==='/'?'index.html':route.slice(1));
  };
  return {manifest,request,calls};
}
test('exact version, health and every web byte; GET only; no approval promotion',async()=>{
  const f=fixture();const result=await verifyPublicRuntime(f.manifest,f.request);
  assert.equal(result.publicBytesMatch,true);assert.equal(result.walletApprovalVerified,false);
  assert.equal(f.calls.length,2+QUANT_RUNTIME_WEB_ASSETS.length);
  assert.ok(f.calls.every(c=>c.options.method==='GET'&&c.options.redirect==='manual'));
});
test('old healthy runtime fails source binding before assets',async()=>{
  const f=fixture();await assert.rejects(verifyPublicRuntime(f.manifest,async()=>Response.json({productId:'ynx-quant-lab',commit:'c'.repeat(40)})),/PUBLIC_SOURCE_MISMATCH/);
});
test('HTML fallback, redirects and wrong asset bytes fail closed',async()=>{
  for(const response of [new Response('fallback',{headers:{'content-type':'text/html'}}),new Response('',{status:302})]) {
    const f=fixture();await assert.rejects(verifyPublicRuntime(f.manifest,async()=>response.clone()),/PUBLIC_(MIME|HTTP)_MISMATCH/);
  }
  const f=fixture();await assert.rejects(verifyPublicRuntime(f.manifest,async(url,opts)=>new URL(url).pathname.startsWith('/api/')?f.request(url,opts):new Response('wrong')),/PUBLIC_ASSET_MISMATCH/);
});
test('duplicate/missing/traversal inventories rejected before any HTTP',async()=>{
  for(const mutate of [m=>m.entries.pop(),m=>m.entries.push(m.entries[0]),m=>m.entries[0].path=`${release}/apps/quant-lab/web/../secret`]){
    const f=fixture();mutate(f.manifest);await assert.rejects(verifyPublicRuntime(f.manifest,f.request),/INVALID_ASSET_INVENTORY/);assert.equal(f.calls.length,0);
  }
});
test('filesystem ready=true is not multi-instance readiness proof',async()=>{
  const f=fixture();await assert.rejects(verifyPublicRuntime(f.manifest,async(url,opts)=>new URL(url).pathname==='/api/health'?Response.json({productId:'ynx-quant-lab',commit,status:'ok',liveFundsEnabled:false,ready:true,storage:{multiInstance:false}}):f.request(url,opts)),/PUBLIC_HEALTH_CONTRACT_MISMATCH/);
});
