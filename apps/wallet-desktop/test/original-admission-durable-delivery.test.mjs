import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

// New affected PUBLIC controls: execute EXACT changed production function
// bodies with explicit PUBLIC parser/catalog/hash stand-ins. No product
// module, crypto graph, signing, private store or channel is executed here.
const source=readFileSync(new URL('../../../packages/wallet-auth/src/original-wallet-service-admission-publication-state.js',import.meta.url),'utf8');
const names=['enterOriginalWalletServiceAdmissionDelivery','markOriginalWalletServiceAdmissionDeliveryUnknown','acknowledgeOriginalWalletServiceAdmissionDelivery','assertOriginalWalletServiceAdmissionPublicationRetention','readOriginalWalletServiceAdmissionPublication'];
function extract(name){const marker=`export function ${name}(`,start=source.indexOf(marker);assert(start>=0);const next=source.indexOf('\nexport function ',start+marker.length);let text=source.slice(start,next<0?source.length:next);const end=text.lastIndexOf('}');return text.slice(7,end+1);}
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 const c=vm.createContext({parseOriginalWalletServiceAdmissionPublicationState:clone,capture:clone,bytes:x=>{if(typeof x!=='string')fail('bytes');},sha:x=>`PUBLIC_HASH:${x}`,parseRequest:JSON.parse,exact:(x,k)=>{assert.deepEqual(Object.keys(x).sort(),[...k].sort());},canonical:x=>JSON.stringify(x),fail});
 vm.runInContext(names.map(extract).join('\n')+'\nthis.api={'+names.join(',')+'}',c);
 const record={requestNonce:'PUBLIC_NONCE',requestRaw:JSON.stringify({consumerManifestDigest:'PUBLIC_CONSUMER'}),runtimeRaw:JSON.stringify({observation:{sequence:7}}),state:'signed',signedRaw:'PUBLIC_SIGNED_STANDIN'};
 return {api:c.api,state:{version:1,records:[record]}};
}
test('PUBLIC exact entered body binds immutable installed epoch before external write',()=>{
 const {api,state}=fixture(),r=api.enterOriginalWalletServiceAdmissionDelivery(state,'PUBLIC_NONCE');
 assert.equal(state.records[0].delivery,undefined);assert.equal(r.record.delivery.state,'entered');
 assert.equal(r.record.delivery.sequence,7);assert.equal(r.record.delivery.receiptDigest,'PUBLIC_HASH:PUBLIC_SIGNED_STANDIN');
 assert.throws(()=>api.enterOriginalWalletServiceAdmissionDelivery(r.state,'PUBLIC_NONCE'),/ALREADY_ENTERED/);
});
test('PUBLIC cold entered and UNKNOWN readback never authorizes retry; first cause retained',()=>{
 const {api,state}=fixture(),entered=api.enterOriginalWalletServiceAdmissionDelivery(state,'PUBLIC_NONCE');
 const cold=api.readOriginalWalletServiceAdmissionPublication(entered.state,'PUBLIC_NONCE');assert.equal(cold.readOnly,true);
 const unknown=api.markOriginalWalletServiceAdmissionDeliveryUnknown(entered.state,'PUBLIC_NONCE','ACK_LOST');
 const again=api.markOriginalWalletServiceAdmissionDeliveryUnknown(unknown.state,'PUBLIC_NONCE','OTHER_FAILURE');
 assert.equal(again.record.delivery.firstCause,'ACK_LOST');assert.equal(again.readOnly,true);
 assert.throws(()=>api.enterOriginalWalletServiceAdmissionDelivery(unknown.state,'PUBLIC_NONCE'),/ALREADY_ENTERED/);
});
test('PUBLIC exact ACK accepts once and rejects mismatches or UNKNOWN revival',()=>{
 const {api,state}=fixture(),entered=api.enterOriginalWalletServiceAdmissionDelivery(state,'PUBLIC_NONCE');
 const ack={type:'ack',requestNonce:'PUBLIC_NONCE',receiptDigest:entered.record.delivery.receiptDigest,sequence:7,consumerManifestDigest:'PUBLIC_CONSUMER'};
 for(const key of ['receiptDigest','sequence','consumerManifestDigest'])assert.throws(()=>api.acknowledgeOriginalWalletServiceAdmissionDelivery(entered.state,{...ack,[key]:'WRONG'}),/ACK_MISMATCH/);
 const committed=api.acknowledgeOriginalWalletServiceAdmissionDelivery(entered.state,ack);assert.equal(committed.record.delivery.state,'acknowledged');
 assert.throws(()=>api.acknowledgeOriginalWalletServiceAdmissionDelivery(committed.state,ack),/UNRESOLVED/);
 const u=api.markOriginalWalletServiceAdmissionDeliveryUnknown(entered.state,'PUBLIC_NONCE','ACK_LOST');
 assert.throws(()=>api.acknowledgeOriginalWalletServiceAdmissionDelivery(u.state,ack),/UNRESOLVED/);
});
test('PUBLIC actual retention body refuses erasure/epoch mutation/UNKNOWN recovery and allows one ACK',()=>{
 const {api,state}=fixture(),entered=api.enterOriginalWalletServiceAdmissionDelivery(state,'PUBLIC_NONCE');
 api.assertOriginalWalletServiceAdmissionPublicationRetention(state,entered.state);
 const u=api.markOriginalWalletServiceAdmissionDeliveryUnknown(entered.state,'PUBLIC_NONCE','ACK_LOST');
 api.assertOriginalWalletServiceAdmissionPublicationRetention(entered.state,u.state);
 assert.throws(()=>api.assertOriginalWalletServiceAdmissionPublicationRetention(u.state,entered.state),/RETENTION/);
 const removed=clone(u.state);delete removed.records[0].delivery;
 assert.throws(()=>api.assertOriginalWalletServiceAdmissionPublicationRetention(u.state,removed),/RETENTION/);
 const replaced=clone(u.state);replaced.records[0].delivery.receiptDigest='OTHER';
 assert.throws(()=>api.assertOriginalWalletServiceAdmissionPublicationRetention(u.state,replaced),/RETENTION/);
 const next=clone(u.state);next.records.push({state:'pending',signedRaw:null});
 assert.throws(()=>api.assertOriginalWalletServiceAdmissionPublicationRetention(u.state,next),/UNRESOLVED/);
});
