import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'ethers';
import {validateNetwork} from '../src/multichain-config.mjs';
import {validateJournal,MultiJournal} from '../src/multichain-journal.mjs';
import {MultichainService} from '../src/multichain-service.mjs';
import {CctpEVMAdapter,describeCctpAction} from '../src/features/cross-chain/cctp-action.mjs';
import {ROUTE} from '../src/features/cross-chain/cctp-wire.mjs';
const secret='0x'+'0'.repeat(63)+'1',account=new Wallet(secret).address.toLowerCase();
const network=chain=>validateNetwork({name:'PUBLIC fixture',chainId:String(chain),rpcUrl:'https://example.com',symbol:'ETH',decimals:18,genesis:'0x'+'aa'.repeat(32)});
function original(step='burn'){
 const binding={routeId:ROUTE.id,account,recipient:'0x'+'22'.repeat(20),amountUnits:'1000000',maxFeeUnits:'0',maxSourceGasFeeWei:'100000000000000',maxDestinationGasFeeWei:'100000000000000',sourceNetwork:network(11155111),destinationNetwork:network(84532),context:{account,revision:1,epoch:1,locked:false},configRevision:1,expiresAt:100000,quoteId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'};
 const cctp={version:1,intentId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',step,binding,proof:null},a=describeCctpAction(cctp);
 return{id:'cccccccc-cccc-4ccc-cccc-cccccccccccc',network:a.network,account,nonce:'1',asset:a.asset,to:a.to,amount:a.amount,transaction:{chainId:a.network.chainId,nonce:'1',to:a.to,value:'0',data:a.data,gasLimit:'100000',gasPrice:'1000000000',type:0},cctp,state:'prepared',raw:null,hash:null,createdAt:1,updatedAt:1,receipt:null};
}
test('original journal accepts only the exact closed CCTP action, not a disguised token transfer',async()=>{
 for(const step of ['approve','burn']){
  const r=original(step);assert.equal(validateJournal({version:1,records:[r]}).records[0],r);
  const signed=await new CctpEVMAdapter().sign(secret,r),stored={...r,state:'signed',raw:signed.raw,hash:signed.hash};
  validateJournal({version:1,records:[stored]});
  for(const mutate of [v=>delete v.cctp,v=>v.transaction.data='0x1234',v=>v.cctp.binding.amountUnits='2',v=>v.cctp.step='arbitrary',v=>v.transaction.value='1']){
   const bad=structuredClone(stored);mutate(bad);assert.throws(()=>validateJournal({version:1,records:[bad]}));
  }
 }
});
async function serviceFixture(t){
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'PUBLIC-cctp-integration-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const marker=original().cctp,config={revision:1,selected:marker.binding.destinationNetwork.id,networks:[marker.binding.sourceNetwork,marker.binding.destinationNetwork]};
 const context={account,revision:1,locked:false},journal=new MultiJournal({filePath:path.join(dir,'journal.json')});let signs=0,posts=0,readNetwork;
 const adapter=new CctpEVMAdapter();
 adapter.verify=async()=>{}; // Explicit PUBLIC transport seam; never use a live RPC in this control.
 adapter.prepareCctp=async(_n,_a,cctp)=>{const r=original();return{amount:r.amount,fee:'100000000000000',transaction:r.transaction};};
 adapter.validateSend=async()=>{};
 adapter.broadcast=async()=>{posts++;throw Error('PUBLIC unknown network result');};
 adapter.reconcile=async(n)=>{readNetwork=n.id;return{state:'unknown',receipt:null};};
 const service=new MultichainService({config:{read:async()=>structuredClone(config)},journal,adapter,getContext:async()=>context,now:()=>1000,id:()=>original().id,withSecret:async fn=>{signs++;return fn(secret,{account},{assert(){}});}});
 marker.binding.context=await service.context();
 const guard={account,assert(){if(context.locked)throw Error('locked');},submit:fn=>fn()};
 return{service,marker,journal,guard,config,context,effects:()=>({signs,posts,readNetwork})};
}
test('CCTP main service retains original marker before single outward effect; recovery uses original not selected network',async t=>{
 const f=await serviceFixture(t);assert.equal(typeof f.service.prepareCctpStep,'function');
 const {version,...input}=f.marker,review=await f.service.prepareCctpStep(input);
 assert.equal(review.network.id,f.marker.binding.sourceNetwork.id);
 await assert.rejects(()=>f.service.send(review.id,f.guard),{code:'CCTP_ORIGINAL_COORDINATOR_REQUIRED'});
 const result=await f.service.sendCctpStep(review.id,f.guard);assert.equal(result.state,'unknown');
 const record=(await f.journal.list(review.network.id,account))[0];assert.deepEqual(record.cctp,f.marker);assert.ok(record.raw);
 const checked=await f.service.checkCctpStep({id:review.id,network:review.network,account});assert.equal(checked.state,'unknown');
 assert.deepEqual(f.effects(),{signs:1,posts:1,readNetwork:review.network.id});
 await assert.rejects(()=>f.service.send(review.id,f.guard));
});
test('CCTP original account/config binding cannot be supplied by a changed review',async t=>{
 const f=await serviceFixture(t);assert.equal(typeof f.service.prepareCctpStep,'function');
 f.marker.binding.configRevision=2;
 const {version,...input}=f.marker;
 await assert.rejects(()=>f.service.prepareCctpStep(input));assert.equal(f.effects().signs,0);
});
