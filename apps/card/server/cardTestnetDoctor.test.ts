import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CARD_TESTNET_RPC,cardTestnetDoctor,readTestnetChain} from './cardTestnetDoctor.ts';
const complete={YNX_CARD_CORE_RPC_URL:CARD_TESTNET_RPC,YNX_CARD_TESTNET_FUNDING_ADDRESS:'0x'+'1'.repeat(40),YNX_CARD_STATE_KEY_BASE64:Buffer.alloc(32,7).toString('base64'),YNX_CARD_SOURCE_COMMIT:'a'.repeat(40),YNX_CARD_AUTH_ADAPTER_MODULE:'/fixture/not-loaded.mjs'};
test('native Testnet preflight does not depend on commercial processor credentials or claim runtime',()=>{
  const report=cardTestnetDoctor(complete);assert.equal(report.configuration.configurationComplete,true);assert.equal(report.commercialProviderRequiredForNativeTestnetFunding,false);
  assert.equal(report.authority.currentRoleActorBinding,'NOT_CHECKED');assert.equal(report.authority.adapterLoaded,'NOT_CHECKED');
  assert.equal(report.gates.runtimeReady,false);assert.equal(report.gates.cardActive,false);assert.equal(report.gates.cardCredited,false);
  const raw=JSON.stringify(report);for(const value of [complete.YNX_CARD_STATE_KEY_BASE64,complete.YNX_CARD_AUTH_ADAPTER_MODULE,complete.YNX_CARD_TESTNET_FUNDING_ADDRESS])assert.ok(!raw.includes(value));
});
test('missing, hostile and invalid configuration remains fail closed',()=>{
  assert.equal(cardTestnetDoctor({}).configuration.configurationComplete,false);
  for(const url of ['http://evm.ynxweb4.com','https://evil.example','https://user:secret@evm.ynxweb4.com','https://evm.ynxweb4.com/?secret=x','https://evm.ynxweb4.com/#chain','https://evm.ynxweb4.com/private'])assert.equal(cardTestnetDoctor({...complete,YNX_CARD_CORE_RPC_URL:url}).configuration.rpcCanonical,false);
  for(const bad of [{YNX_CARD_TESTNET_FUNDING_ADDRESS:'0x'+'0'.repeat(40)},{YNX_CARD_MIN_CONFIRMATIONS:'0'},{YNX_CARD_MIN_CONFIRMATIONS:'NaN'},{YNX_CARD_SOURCE_COMMIT:'unbound'},{YNX_CARD_STATE_KEY_BASE64:'bad'},{YNX_CARD_ALLOWED_ORIGIN:'https://other.example'}])assert.equal(cardTestnetDoctor({...complete,...bad}).configuration.configurationComplete,false);
});
test('public chain readback is bounded and cannot elevate funding or wallet gates',async()=>{
  const calls:unknown[]=[];
  const request=(async(url:unknown,options:any)=>{calls.push([url,options]);return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1917'})}}) as typeof fetch;
  const report=await readTestnetChain(cardTestnetDoctor(complete),request);assert.equal(report.chainReadback.status,'READBACK_MATCH');assert.equal(report.gates.transactionSent,false);assert.equal(report.gates.fundingReceiptVerified,false);assert.equal(report.gates.runtimeReady,false);
  const [url,options]=calls[0] as any;assert.equal(url,CARD_TESTNET_RPC);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]});assert.ok(options.signal);
  await readTestnetChain(cardTestnetDoctor({}),request);assert.equal(calls.length,1);
});
test('wrong chain, ambiguous JSON and network failures are distinct non-success states',async()=>{
  for(const body of [{jsonrpc:'2.0',id:1,result:'0x1'},{jsonrpc:'2.0',id:2,result:'0x1917'},{jsonrpc:'2.0',id:1,result:'0x1917',error:{message:'sensitive'}}]){
    const result=await readTestnetChain(cardTestnetDoctor(complete),(async()=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}})) as typeof fetch);assert.equal(result.chainReadback.status,'WRONG_OR_UNVERIFIED_CHAIN');assert.equal(result.chainReadback.chainId,null);
  }
  const result=await readTestnetChain(cardTestnetDoctor(complete),(async()=>{throw Error('secret')}) as typeof fetch);assert.equal(result.chainReadback.status,'RPC_UNAVAILABLE');assert.ok(!JSON.stringify(result).includes('secret'));
});
