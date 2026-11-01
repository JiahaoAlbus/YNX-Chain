import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {YNXCloudClient,CloudDeploymentV2Client,manifestFixtureURL,openPublicCloudConsumer} from './product-source-cloud-runtime.mjs';

test('actual Cloud import reads only original locator; invalidated or mismatched reads cannot replace retained evidence',{timeout:10_000},async()=>{
 const fixture=JSON.parse(await readFile(manifestFixtureURL,'utf8'));
 let op,envelope,mode='good',live=true,release,reads=0,posts=0;
 const server=createServer(async(req,res)=>{
  if(req.method!=='GET'){posts++;res.writeHead(405).end();return;}reads++;
  assert.equal(req.headers['x-p06-public'],'NOT_SOURCE_ADMISSION');
  const value=structuredClone(req.url.endsWith('/native-intent')?envelope:op);
  if(req.url.endsWith('/native-intent')){
   if(mode==='wrong-reference')value.request.sourceOrder='cloud_usage_'+'0'.repeat(64);
   if(mode==='late')await new Promise(resolve=>release=resolve);
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 let source;
 try{
  const sdk=new YNXCloudClient({endpoint:`http://127.0.0.1:${server.address().port}/api/v1`,product:'cloud',getDeploymentRequestHeaders:async()=>({'X-P06-Public':'NOT_SOURCE_ADMISSION'})});
  const client=new CloudDeploymentV2Client(sdk),prepared=client.prepare(fixture.manifest,Buffer.from(fixture.actualHex,'hex'),{requestId:'req_p06_original_cloud_consumer_001',expectedSlotRevision:'0'}),selection=prepared.selection;
  op={requestId:selection.requestId,manifestVersion:'2',manifestV2:structuredClone(selection.manifest),manifestBinding:selection.manifestBinding,contentBinding:selection.contentBinding,expectedSlotRevision:'0',slotRevision:'1',state:'completed',exitCode:0,deploymentId:'PUBLIC_INSTANCE',resourceId:'PUBLIC_RESOURCE',catalogProjectId:'PUBLIC_CATALOG',runtimeUrl:'https://public.invalid/runtime',manifestSHA256:'a'.repeat(64),artifactSHA256:'b'.repeat(64)};
  const ref={productId:'cloud.ide-usage',sourceOrder:'cloud_usage_'+'c'.repeat(64)},period='2026-10-28',merchant='0x'+'a'.repeat(40);
  const billRequest={billId:ref.sourceOrder,requestId:selection.requestId,period,instanceId:op.deploymentId,merchant,recipient:merchant,asset:{genesis:'d'.repeat(64),nativeChainId:'71',assetId:'YNXT',unitVersion:'1'},atoms:'6',sampleBinding:selection.contentBinding};
  envelope={request:{...ref,merchant,recipient:merchant,...billRequest.asset,amountAtoms:'6',domainData:billRequest},original:{manifestVersion:'2',projectId:op.catalogProjectId,projectRef:selection.manifest.project,resourceId:op.resourceId,manifestSHA256:op.manifestSHA256,artifactSHA256:op.artifactSHA256,bill:{request:billRequest,aggregate:{sampleBinding:selection.contentBinding},state:'PREPARED',settlement:'NOT_VERIFIED'}},originalSHA256:'e'.repeat(64)};
  source=await openPublicCloudConsumer({client,selection,period,ref,current(){if(!live)throw Error('ORIGINAL_RETIRED');}});
  const first=await source.readOriginalInvoiceIntent(ref,()=>{});assert.equal(first.amountAtoms,'6');
  const saved=await source.readOriginalProductEvidence(ref,()=>{});assert.deepEqual(saved,envelope);saved.original.projectRef.id='MUTATED';
  mode='wrong-reference';await assert.rejects(source.readOriginalInvoiceIntent(ref,()=>{}));assert.deepEqual(await source.readOriginalProductEvidence(ref,()=>{}),envelope);
  mode='late';const pending=source.readOriginalInvoiceIntent(ref,()=>{});
  while(!release)await new Promise(resolve=>setImmediate(resolve));live=false;release();await assert.rejects(pending,/ORIGINAL_RETIRED/);
  assert.equal(posts,0);assert.equal(reads,6);assert.equal(client.originalNativeTransportStatus().acquisitionEntered,false);
 }finally{if(source){source.retire();await source.join();await source.close();}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
