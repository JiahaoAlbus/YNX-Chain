import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ynxAddressFromEVM} from '@ynx-chain/wallet-auth';
import {NativeWalletService} from '../src/native-wallet-service.mjs';
import {fixtureEVMCapabilities} from './fixture-evm-capabilities.mjs';
import {validateNetwork,multiError} from '../src/multichain-config.mjs';
import {CctpFlow,CctpStore} from '../src/features/cross-chain/cctp-flow.mjs';
import {ROUTE} from '../src/features/cross-chain/cctp-wire.mjs';

// Actual product classes under the normal SDK49 package, with controlled
// network/wallet effect ports. No secret material, signing, send or live RPC.
const account='0x'+'11'.repeat(20),recipient='0x'+'22'.repeat(20),hash='0x'+'ab'.repeat(32),now=1800000000000;
test('SDK49 native address/18-decimal preview and cancel never enter keys or sender',async()=>{
 let keys=0,sends=0;
 const service=new NativeWalletService({vault:{status:async()=>({initialized:true,account}),authorization:{current:()=>({assert(){}})},withSecret(){keys++;throw Error('PUBLIC_KEY_ENTRY_FORBIDDEN');}},network:{capabilities:async()=>fixtureEVMCapabilities,balance:async()=> '0x8ac7230489e80000'},sender:{prepare:async(from,tx)=>Object.freeze({...tx,from,gasLimit:'0x5208',gasPrice:'0x1'}),send(){sends++;throw Error('PUBLIC_SEND_FORBIDDEN');}},clock:()=>now});
 const review=await service.prepareTransfer({to:ynxAddressFromEVM(recipient),amount:'1.000000000000000001'});
 assert.equal(review.to,recipient);assert.equal(review.amount,'1.000000000000000001');assert.equal(review.transaction.value,'0xde0b6b3a7640001');
 assert.deepEqual(await service.transferAction(review.id,'reject'),{rejected:true,transactionCreated:false});
 await assert.rejects(service.transferAction(review.id,'approve'),e=>e.data?.code==='UNKNOWN_OR_EXPIRED_REQUEST');assert.equal(keys,0);assert.equal(sends,0);
});
async function cross(t){
 const directory=await mkdtemp(path.join(tmpdir(),'ynx-sdk49-cross-'));t.after(()=>rm(directory,{recursive:true,force:true}));const filePath=path.join(directory,'cross.json');
 const context={account,revision:1,epoch:0,locked:false},calls={prepare:0,send:0,check:[],cancel:0},originals=new Map();
 const networks=[ROUTE.source,ROUTE.destination].map((r,i)=>validateNetwork({name:r.name,chainId:String(r.chainId),rpcUrl:`https://sdk49-public-${i}.example.org/`,symbol:'ETH',decimals:18,genesis:'0x'+String(i+1).repeat(64)}));
 const wallet={context:async()=>structuredClone(context),snapshot:async()=>({revision:1,account,networks:structuredClone(networks)}),assert:async(c,r)=>{assert.deepEqual(c,context);if(r!==undefined)assert.equal(r,1);},prepareCctpStep:async input=>{calls.prepare++;const review={id:randomUUID(),intentId:input.intentId,step:input.step,expiresAt:now+120000};originals.set(review.id,{...review,hash:null,state:'prepared'});return review;},send:async id=>{calls.send++;Object.assign(originals.get(id),{hash,state:'unknown'});throw multiError('RPC_TIMEOUT_AFTER_SEND','PUBLIC controlled lost acknowledgement');},checkCctpStep:async input=>{calls.check.push(structuredClone(input));const original=originals.get(input.id);assert.ok(original);return {id:original.id,hash:original.hash,state:original.state};},cancel:async id=>{calls.cancel++;return {cancelled:originals.delete(id),reason:'review-only'};}};
 const reader={quote:async()=>({requiredFeeUnits:'75',allowanceUnits:'1000000',sourceBalanceUnits:'10000000',destinationBalanceUnits:'0',httpStatus:200})};
 const store=new CctpStore({filePath}),create=(s=store)=>new CctpFlow({wallet,reader,store:s,now:()=>now});
 const input={routeId:ROUTE.id,asset:'USDC',amount:'1',recipient,maxProtocolFee:'0.0001',maxSourceGasFeeWei:'1000000000000000',maxDestinationGasFeeWei:'2000000000000000'};
 return {filePath,store,create,calls,input,guard:{assert(){}},originals};
}
test('SDK49 CCTP normal consumer previews and cancels unsigned review, and refuses unsupported YNX route',async t=>{
 const h=await cross(t),flow=h.create();const quote=await flow.quote(h.input),record=await flow.start(quote.quoteId),review=await flow.prepareStep(record.id);
 assert.equal(review.step,'burn');assert.equal((await flow.cancel(record.id)).cancelled,true);assert.equal(h.calls.send,0);assert.equal(h.calls.cancel,1);
 assert.equal((await new CctpStore({filePath:h.filePath}).get(record.id)).state,'cancelled');
 await assert.rejects(flow.quote({...h.input,routeId:'ynx-to-base'}),e=>e.code==='CCTP_UNSUPPORTED_ROUTE');assert.equal(h.calls.send,0);
});
test('SDK49 CCTP controlled confirmation timeout persists UNKNOWN; fresh consumer queries only original ID/hash',async t=>{
 const h=await cross(t),flow=h.create(),record=await flow.start((await flow.quote(h.input)).quoteId),review=await flow.prepareStep(record.id);
 const result=await flow.confirmStep({id:record.id,reviewId:review.id},h.guard);assert.equal(result.state,'burn-pending');assert.equal(result.operations[0].state,'unknown');
 const fresh=h.create(new CctpStore({filePath:h.filePath}));
 await assert.rejects(fresh.prepareStep(record.id),e=>e.code==='CCTP_CHECK_ORIGINAL');
 await assert.rejects(fresh.confirmStep({id:record.id,reviewId:review.id},h.guard),e=>e.code==='CCTP_CHECK_ORIGINAL');
 assert.equal((await fresh.cancel(record.id)).reason,'query-original');
 const retained=await fresh.check(record.id);assert.equal(retained.operations[0].id,review.id);assert.equal(retained.operations[0].hash,hash);assert.equal(retained.operations[0].state,'unknown');
 assert.equal(h.calls.check.length,1);assert.equal(h.calls.check[0].id,review.id);assert.equal(h.calls.prepare,1);assert.equal(h.calls.send,1);assert.equal(h.calls.cancel,0);
});
