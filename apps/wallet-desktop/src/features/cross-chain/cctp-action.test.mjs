import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,Wallet} from 'ethers';
import {validateNetwork} from '../../multichain-config.mjs';
import {EVMAdapter} from '../../multichain-evm.mjs';
import {CctpEVMAdapter,describeCctpAction,validateCctpRecord,verifyCctpSignedRecord} from './cctp-action.mjs';
import {ROUTE} from './cctp-wire.mjs';

// Public deterministic TEST fixture, never loaded into Wallet or sent to a chain.
const secret='0x'+'0'.repeat(63)+'1',account=new Wallet(secret).address.toLowerCase();
const network=chain=>validateNetwork({name:'Controlled test network',chainId:String(chain),rpcUrl:'https://example.com',symbol:'ETH',decimals:18,genesis:'0x'+'aa'.repeat(32)});
const binding=()=>({routeId:ROUTE.id,account,recipient:'0x'+'22'.repeat(20),amountUnits:'1000000',maxFeeUnits:'0',maxSourceGasFeeWei:'100000000000000',maxDestinationGasFeeWei:'100000000000000',sourceNetwork:network(11155111),destinationNetwork:network(84532),context:{account,revision:1,epoch:1,locked:false},configRevision:1,expiresAt:100000,quoteId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'});
const marker=step=>({version:1,intentId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',step,binding:binding(),proof:null});
const record=step=>{const cctp=marker(step),a=describeCctpAction(cctp);return {id:'cccccccc-cccc-4ccc-cccc-cccccccccccc',network:a.network,account,nonce:'1',asset:a.asset,to:a.to,amount:a.amount,transaction:{chainId:a.network.chainId,nonce:'1',to:a.to,value:'0',data:a.data,gasLimit:'100000',gasPrice:'1000000000',type:0},cctp,hash:null}};

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
