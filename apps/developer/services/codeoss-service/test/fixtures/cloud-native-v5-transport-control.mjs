// TEST ONLY: arbitrary multipart outbox/transport control. This replaces the
// fixed public factory in an isolated Node test process. It does NOT exercise
// Native Source, cryptographic proof verification, sockets or real deployment.
// The SDK golden-member test cannot sign this fixture's different body.
import {mock} from 'node:test';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
let installed, selected;
export function selectPublicTransportControl(cloud, callbacks) {
  selected=callbacks;
  const require=createRequire(pathToFileURL(cloud+'/client/deployment-v2-client.mjs'));
  const moduleURL=pathToFileURL(require.resolve('@ynx-chain/wallet-auth/original-http-binary-v5-client')).href;
  if(installed){assert.equal(installed,moduleURL);return;}
  installed=moduleURL;
  mock.module(moduleURL,{namedExports:{openOriginalHTTPBinaryClientV5:async(...args)=>{
    assert.equal(args.length,0);
    const control=selected, packets=new WeakMap();let closed=false;
    const row=packet=>{assert.equal(closed,false);const value=packets.get(packet);assert.ok(value,'original TEST packet only');return value;};
    const copy=value=>({...value.data,bodyOriginal:Buffer.from(value.data.bodyOriginal)});
    return {
      prepareOriginalRequest(input){
        assert.equal(closed,false);const packet=Object.freeze({}),data={requestId:input.requestId,method:'POST',path:'/api/v1/ide/deployments',url:'https://public-protocol.invalid/api/v1/ide/deployments',expectedSlotRevision:input.expectedSlotRevision,rollbackTarget:input.rollbackTarget,contentType:input.bodySnapshot.contentType,bodyOriginal:Buffer.from(input.bodySnapshot.bodyOriginal),dataOnly:true,SourceAdmission:false,NativeAdmission:false};
        packets.set(packet,{data,context:input.abortContext,entered:false});return packet;
      },
      readOriginalRequestDATA(packet){return copy(row(packet));},
      async produceOriginalProof(packet){
        const value=row(packet);value.headers=await control.headers({...copy(value),operationRequestId:value.data.requestId});
        return {...copy(value),proofHeaderName:'x-ynx-product-session-proof-v5',proofHeader:'PUBLIC_STANDIN_NOT_A_CRYPTOGRAPHIC_PROOF',unknown:false};
      },
      async submitPrepared(packet,context){
        const value=row(packet);assert.equal(context,value.context);assert.equal(value.entered,false);value.entered=true;
        const headers=new Headers(value.headers);headers.set('content-type',value.data.contentType);headers.set('idempotency-key',value.data.requestId);headers.set('x-deployment-manifest-version','2');headers.set('x-expected-deployment-revision',value.data.expectedSlotRevision);headers.set('x-rollback-to',value.data.rollbackTarget);
        const response=await control.fetch(value.data.url,{method:'POST',headers,body:Buffer.from(value.data.bodyOriginal),signal:context.signal,redirect:'error'});
        return {...copy(value),unknown:false,httpEntered:true,responseOriginal:{complete:true,status:response.status,bodyOriginal:Buffer.from(await response.arrayBuffer())}};
      },
      close(){closed=true;},drainOriginal(){closed=true;},status(){return {closed,physicalSourceClosed:closed,cleanupDebt:false,firstCausePresent:false};},
    };
  }}});
}
