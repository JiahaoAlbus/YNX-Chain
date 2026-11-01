// New P06 consumer -> actual frozen Cloud client -> normal Cloud HTTP/Store.
// Go owns PUBLIC original Source/pricing/runtime fixtures; no funds/admission.
import assert from 'node:assert/strict';
import {YNXCloudClient,CloudDeploymentV2Client,openPublicCloudConsumer} from './product-source-cloud-runtime.mjs';
let input='';for await(const part of process.stdin)input+=part;
const {base,selection,period,denied,sourceOrder}=JSON.parse(input);
const sdk=new YNXCloudClient({endpoint:base,product:'cloud',getDeploymentRequestHeaders:async()=>({'X-P04-Public-Read':'PUBLIC_V2_ORIGINAL_READER'})});
const client=new CloudDeploymentV2Client(sdk),ref={productId:'cloud.ide-usage',sourceOrder};
const source=await openPublicCloudConsumer({client,selection,period,ref});
try{
 if(denied){
  await assert.rejects(source.readOriginalInvoiceIntent(ref,()=>{}),error=>error.status===403);
  await assert.rejects(source.readOriginalProductEvidence(ref,()=>{}),{code:'NATIVE_PAY_PRODUCT_EVIDENCE_UNAVAILABLE'});
  process.stdout.write(JSON.stringify({revokedReadDenied:true}));
 }else{
  const request=await source.readOriginalInvoiceIntent(ref,()=>{}),evidence=await source.readOriginalProductEvidence(ref,()=>{});
  assert.equal(request.sourceOrder,sourceOrder);assert.equal(request.amountAtoms,'6');assert.equal(request.storeId,undefined);
  assert.equal(JSON.stringify(request.domainData),JSON.stringify(evidence.original.bill.request));
  assert.deepEqual(evidence.original.projectRef,selection.manifest.project);assert.equal(evidence.original.manifestVersion,'2');
  evidence.original.projectRef.tenant='MUTATED';assert.deepEqual((await source.readOriginalProductEvidence(ref,()=>{})).original.projectRef,selection.manifest.project);
  assert.equal(client.originalNativeTransportStatus().acquisitionEntered,false);
  process.stdout.write(JSON.stringify({request,evidence:await source.readOriginalProductEvidence(ref,()=>{}),SourceAdmission:false}));
 }
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();}
