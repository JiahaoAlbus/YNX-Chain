import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,Wallet,zeroPadValue} from 'ethers';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateNetwork} from '../../multichain-config.mjs';
import {MultiJournal} from '../../multichain-journal.mjs';
import {MultichainService} from '../../multichain-service.mjs';
import {EVMAdapter} from '../../multichain-evm.mjs';
import {CctpFlow,CctpStore} from './cctp-flow.mjs';
import {CctpEVMAdapter,describeCctpAction,validateCctpRecord,verifyCctpSignedRecord} from './cctp-action.mjs';
import {ROUTE} from './cctp-wire.mjs';

// Public deterministic TEST fixture, never loaded into Wallet or sent to a chain.
const secret='0x'+'0'.repeat(63)+'1',account=new Wallet(secret).address.toLowerCase();
const network=chain=>validateNetwork({name:'Controlled test network',chainId:String(chain),rpcUrl:'https://example.com',symbol:'ETH',decimals:18,genesis:'0x'+'aa'.repeat(32)});
const binding=()=>({routeId:ROUTE.id,account,recipient:'0x'+'22'.repeat(20),amountUnits:'1000000',maxFeeUnits:'0',maxSourceGasFeeWei:'100000000000000',maxDestinationGasFeeWei:'100000000000000',sourceNetwork:network(11155111),destinationNetwork:network(84532),context:{account,revision:1,epoch:1,locked:false},configRevision:1,expiresAt:100000,quoteId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'});
const marker=step=>({version:1,intentId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',step,binding:binding(),proof:null});
const record=step=>{const cctp=marker(step),a=describeCctpAction(cctp);return {id:'cccccccc-cccc-4ccc-cccc-cccccccccccc',network:a.network,account,nonce:'1',asset:a.asset,to:a.to,amount:a.amount,transaction:{chainId:a.network.chainId,nonce:'1',to:a.to,value:'0',data:a.data,gasLimit:'100000',gasPrice:'1000000000',type:0},cctp,hash:null}};

const h=byte=>'0x'+byte.repeat(32);
const tokenEvents=new Interface(['event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const messageEvents=new Interface(['event MessageSent(bytes message)','event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)']);
function controlledMessage(b,source=false){
 const bytes=Buffer.alloc(376),word=(offset,value,size=32)=>Buffer.from(BigInt(value).toString(16).padStart(size*2,'0'),'hex').copy(bytes,offset);
 word(0,1,4);word(4,0,4);word(8,6,4);word(12,source?0:h('91'));word(44,ROUTE.source.tokenMessenger);word(76,ROUTE.destination.tokenMessenger);word(108,b.account);
 word(140,2000,4);word(144,source?0:2000,4);word(148,1,4);word(152,ROUTE.source.usdc);word(184,b.recipient);word(216,b.amountUnits);word(248,b.account);word(280,b.maxFeeUnits);
 return '0x'+bytes.toString('hex');
}
async function reconcileFixture(step){
 const r=record('burn'),b=r.cctp.binding;
 r.cctp.step=step;
 if(step==='mint')r.cctp.proof={message:controlledMessage(b),attestation:'0x'+'12'.repeat(65),nonce:h('91'),sourceTxHash:h('92'),feeExecuted:'0',amountReceived:b.amountUnits};
 const a=describeCctpAction(r.cctp);Object.assign(r,{network:a.network,asset:a.asset,to:a.to,transaction:{...r.transaction,chainId:a.network.chainId,to:a.to,data:a.data}});
 // Reuse the existing public deterministic fixture key. This creates only
 // synthetic original bytes; no Wallet account, real key or send is accessed.
 Object.assign(r,await new CctpEVMAdapter().sign(secret,r));
 const receipt={transactionHash:r.hash,blockHash:h('42'),blockNumber:'0x64',transactionIndex:'0x1',from:account,to:r.to,status:'0x1',logs:[]};
 const add=(contract,abi,name,args)=>receipt.logs.push({address:contract,...abi.encodeEventLog(abi.getEvent(name),args),transactionHash:r.hash,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,transactionIndex:'0x1',logIndex:'0x'+(42+receipt.logs.length).toString(16),removed:false});
 if(step==='approve')add(ROUTE.source.usdc,tokenEvents,'Approval',[account,ROUTE.source.tokenMessenger,b.amountUnits]);
 if(step==='burn'){
  add(ROUTE.source.messageTransmitter,messageEvents,'MessageSent',[controlledMessage(b,true)]);
  add(ROUTE.source.usdc,tokenEvents,'Transfer',[account,'0x'+'00'.repeat(20),b.amountUnits]);
 }
 if(step==='mint'){
  add(ROUTE.destination.messageTransmitter,messageEvents,'MessageReceived',[account,0,h('91'),zeroPadValue(ROUTE.source.tokenMessenger,32),2000,'0x'+r.cctp.proof.message.slice(2+148*2)]);
  add(ROUTE.destination.usdc,tokenEvents,'Transfer',['0x'+'00'.repeat(20),b.recipient,b.amountUnits]);
 }
 const state={receipt,tx:{hash:r.hash,from:account,to:r.to,input:r.transaction.data,nonce:'0x1',value:'0x0',gas:'0x186a0',gasPrice:'0x3b9aca00',chainId:r.network.chainId,blockHash:receipt.blockHash,blockNumber:'0x64',transactionIndex:'0x1'},block:{hash:receipt.blockHash,number:'0x64',transactions:[h('43'),r.hash]}};
 const calls=[],adapter=new CctpEVMAdapter({rpc:async(_url,method,params)=>{
  calls.push({method,params:structuredClone(params)});
  if(method==='eth_chainId')return r.network.chainId;
  if(method==='eth_getBlockByNumber')return structuredClone(params[0]==='0x0'?{hash:r.network.genesis,number:'0x0'}:state.block);
  if(method==='eth_getTransactionReceipt')return structuredClone(state.receipt);
  if(method==='eth_getTransactionByHash')return structuredClone(state.tx);
  assert.fail('Original reconciliation must only read: '+method);
 }});
 return {r,state,calls,adapter};
}

for(const step of ['approve','burn','mint']){
 test(`canonical ${step} recovery keeps exact signed bytes and accepts nonzero transaction/log indices`,async()=>{
  const f=await reconcileFixture(step),before=structuredClone(f.r),result=await f.adapter.reconcile(f.r.network,f.r);
  assert.equal(result.state,'included');assert.equal(result.receipt.hash,f.r.hash);assert.deepEqual(f.r,before);
  assert.ok(f.calls.filter(x=>x.method==='eth_getTransactionReceipt'||x.method==='eth_getTransactionByHash').every(x=>x.params[0]===f.r.hash));
 });
 for(const [name,mutate] of [
  ['receipt transaction index differs from transaction',s=>s.receipt.transactionIndex='0x0'],
  ['hash is at another block position',s=>s.block.transactions.reverse()],
  ['transaction index is out of bounds',s=>{s.receipt.transactionIndex='0x2';s.tx.transactionIndex='0x2'}],
 ])test(`canonical ${step} recovery rejects ${name}`,async()=>{
  const f=await reconcileFixture(step);mutate(f.state);
  await assert.rejects(f.adapter.reconcile(f.r.network,f.r),{code:'CCTP_RECEIPT_MISMATCH'});
 });
 for(const [name,mutate] of [
  ['log belongs to another transaction index',s=>s.receipt.logs[0].transactionIndex='0x0'],
  ['log index is missing',s=>delete s.receipt.logs[0].logIndex],
  ['log index is duplicated across receipt',s=>s.receipt.logs.push({...s.receipt.logs[0]})],
 ])test(`canonical ${step} recovery rejects ${name}`,async()=>{
  const f=await reconcileFixture(step);mutate(f.state);
  await assert.rejects(f.adapter.reconcile(f.r.network,f.r),{code:'CCTP_EVENT_MISMATCH'});
 });
 if(step!=='approve')test(`canonical ${step} recovery rejects shared log index across different event contracts`,async()=>{
  const f=await reconcileFixture(step);f.state.receipt.logs[1].logIndex=f.state.receipt.logs[0].logIndex;
  await assert.rejects(f.adapter.reconcile(f.r.network,f.r),{code:'CCTP_EVENT_MISMATCH'});
 });
}

test('canonical recovery through cold original Main journal and flow cannot advance on a misplaced approval',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ynx-cctp-canonical-main-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const f=await reconcileFixture('approve'),original={...f.r,state:'prepared',raw:null,hash:null,receipt:null,createdAt:1,updatedAt:1};
 const filePath=join(directory,'journal.json'),journal=new MultiJournal({filePath});
 await journal.reserve(original);await journal.transition(original.id,{state:'signed',raw:f.r.raw,hash:f.r.hash,updatedAt:2});await journal.transition(original.id,{state:'unknown',receipt:null,updatedAt:3});
 const context={account,revision:1,locked:false},config={revision:1,selected:f.r.network.id,networks:[f.r.cctp.binding.sourceNetwork,f.r.cctp.binding.destinationNetwork]};
 let custodyCalls=0;
 const service=new MultichainService({journal:new MultiJournal({filePath}),adapter:f.adapter,config:{read:async()=>structuredClone(config)},getContext:async()=>context,withSecret:async()=>{custodyCalls++;assert.fail('Recovery cannot enter custody')},now:()=>1000});
 const routeFile=join(directory,'cctp.json'),store=new CctpStore({filePath:routeFile});
 await store.insert({id:f.r.cctp.intentId,revision:0,binding:f.r.cctp.binding,state:'approval-pending',operations:[{step:'approve',id:f.r.id,state:'unknown',hash:f.r.hash}],proof:null,destination:null,firstError:'ORIGINAL_SEND_UNKNOWN',createdAt:1,updatedAt:1});
 const reader={quote:async()=>assert.fail('Original result query cannot quote'),attestation:async()=>assert.fail('Unconfirmed approval cannot request a burn proof')};
 const flow=new CctpFlow({wallet:service,reader,store:new CctpStore({filePath:routeFile}),now:()=>1000});
 const originalReads=calls=>{
  assert.equal(calls.filter(x=>x.method==='eth_getTransactionReceipt'&&x.params[0]===f.r.hash).length,1);
  assert.equal(calls.filter(x=>x.method==='eth_getTransactionByHash'&&x.params[0]===f.r.hash).length,1);
  assert.ok(calls.every(x=>['eth_chainId','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getTransactionByHash'].includes(x.method)),'No write method may hide behind Main UNKNOWN error handling');
 };
 f.state.block.transactions.reverse();
 const unknown=await flow.check(f.r.cctp.intentId);
 originalReads(f.calls);
 assert.equal(unknown.state,'approval-pending');assert.equal(unknown.operations[0].state,'unknown');assert.equal(unknown.operations[0].hash,f.r.hash);assert.equal(unknown.firstError,'ORIGINAL_SEND_UNKNOWN');
 await assert.rejects(flow.prepareStep(unknown.id),{code:'CCTP_CHECK_ORIGINAL'});
 const saved=(await journal.list(f.r.network.id,account))[0];assert.equal(saved.state,'unknown');assert.equal(saved.raw,f.r.raw);assert.equal(saved.hash,f.r.hash);assert.equal(saved.nonce,f.r.nonce);
 f.state.block.transactions.reverse();
 const previousCalls=f.calls.length;
 const recovered=await flow.check(unknown.id);assert.equal(recovered.state,'burn-ready');assert.equal(recovered.operations[0].id,f.r.id);assert.equal(recovered.operations[0].hash,f.r.hash);assert.equal(recovered.firstError,'ORIGINAL_SEND_UNKNOWN');
 originalReads(f.calls.slice(previousCalls));assert.equal(custodyCalls,0);assert.deepEqual(recovered.binding,f.r.cctp.binding);
 const records=await journal.list(f.r.network.id,account);assert.equal(records.length,1);assert.equal(records[0].raw,f.r.raw);assert.equal(records[0].hash,f.r.hash);assert.equal(records[0].nonce,f.r.nonce);
});

test('approve and burn use the original adapter signing implementation and exact closed bytes',async()=>{
  assert.equal(CctpEVMAdapter.prototype.sign,EVMAdapter.prototype.sign);
  const adapter=new CctpEVMAdapter();
  for(const step of ['approve','burn']){const r=record(step),signed=await adapter.sign(secret,r);assert.equal(verifyCctpSignedRecord(signed.raw,{...r,hash:signed.hash}),true);
    for(const change of [v=>v.transaction.to=account,v=>v.transaction.value='1',v=>v.transaction.nonce='2',v=>v.transaction.chainId='0x1917',v=>v.cctp.binding.recipient=account,v=>v.cctp.binding.amountUnits='2',v=>v.cctp.binding.maxFeeUnits='1']){
      const changed=structuredClone(r);change(changed);
      // Recipient/fee do not alter approve calldata, but remain immutable in
      // the original service's complete persisted review marker.
      if(step==='approve'&&(changed.cctp.binding.recipient!==r.cctp.binding.recipient||changed.cctp.binding.maxFeeUnits!==r.cctp.binding.maxFeeUnits))continue;
      assert.throws(()=>verifyCctpSignedRecord(signed.raw,changed));
    }
  }
});
test('closed marker rejects YNX, unsupported action, nonzero value, fee overflow and unbound mint',()=>{
  for(const change of [r=>r.cctp.step='refund',r=>r.cctp.binding.routeId='ynx-bridge',r=>r.transaction.value='1',r=>r.transaction.gasPrice='100000000000000000',r=>r.cctp.anyCalldata='0x']){const r=record('burn');change(r);assert.throws(()=>validateCctpRecord(r));}
  assert.throws(()=>describeCctpAction(marker('mint')),/attestation/i);
});
test('live CCTP prepare validates exact allowance, gas cap, contract simulation and network',async()=>{
  const erc20=new Interface(['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
  let allowance=1000000n,observedChain='0xaa36a7',gasPrice='0x3b9aca00',code='0x6000';
  const adapter=new CctpEVMAdapter({rpc:async(_url,method,params)=>{
    if(method==='eth_chainId')return observedChain;
    if(method==='eth_getBlockByNumber')return {hash:'0x'+'aa'.repeat(32)};
    if(method==='eth_getCode')return code;
    if(method==='eth_getTransactionCount')return '0x1';
    if(method==='eth_gasPrice')return gasPrice;
    if(method==='eth_estimateGas')return '0xc350';
    if(method==='eth_getBalance')return '0xde0b6b3a7640000';
    if(method==='eth_call'){
      const selector=params[0].data.slice(0,10);
      if(selector===erc20.getFunction('allowance').selector)return erc20.encodeFunctionResult('allowance',[allowance]);
      if(selector===erc20.getFunction('approve').selector)return erc20.encodeFunctionResult('approve',[true]);
      if(selector==='0x70a08231')return '0x'+1000000n.toString(16).padStart(64,'0');
      return '0x';
    }
    throw Error('Unexpected '+method);
  }});
  const m=marker('burn');assert.equal((await adapter.prepareCctp(m.binding.sourceNetwork,account,m)).amount,'1000000');
  allowance=0n;await assert.rejects(()=>adapter.prepareCctp(m.binding.sourceNetwork,account,m),{code:'CCTP_APPROVAL_REQUIRED'});allowance=1000000n;
  gasPrice='0xffffffffff';await assert.rejects(()=>adapter.prepareCctp(m.binding.sourceNetwork,account,m),{code:'CCTP_GAS_LIMIT'});gasPrice='0x3b9aca00';
  code='0x';await assert.rejects(()=>adapter.prepareCctp(m.binding.sourceNetwork,account,m),{code:'CCTP_CONTRACT_MISSING'});code='0x6000';
  observedChain='0x1917';await assert.rejects(()=>adapter.prepareCctp(m.binding.sourceNetwork,account,m),{code:'MULTICHAIN_NETWORK_MISMATCH'});
});
