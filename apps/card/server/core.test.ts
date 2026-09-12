import test from 'node:test';
import assert from 'node:assert/strict';
import {RpcCoreAuthority} from './core.ts';
import {CHAIN,type FundingIntent} from './contracts.ts';
const owner='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',recipient='0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',hash='0x'+'1'.repeat(64),blockHash='0x'+'2'.repeat(64),createdAt='2026-09-12T00:00:00.000Z';
const intent:FundingIntent={id:'fixture-intent',cardId:'fixture-card',owner,sender:owner,chainId:CHAIN,recipient,amountWei:'1000000000000000001',minConfirmations:2,createdAt,expiresAt:'2026-09-12T00:15:00.000Z',status:'pending'};
function setup(t:any,patch:Record<string,unknown>={},reorg=false){const original=globalThis.fetch,requests:RequestInit[]=[],methods:string[]=[];let blocks=0;const values:Record<string,any>={eth_chainId:CHAIN,eth_getTransactionByHash:{hash,from:owner,to:recipient,value:'0x'+BigInt(intent.amountWei).toString(16),blockNumber:'0x10',blockHash,chainId:CHAIN},eth_getTransactionReceipt:{status:'0x1',transactionHash:hash,from:owner,to:recipient,blockNumber:'0x10',blockHash},eth_blockNumber:'0x11',eth_getBlockByNumber:{hash:blockHash,number:'0x10',timestamp:'0x'+Math.floor(Date.parse(createdAt)/1000).toString(16)},...patch};globalThis.fetch=async(_url,options)=>{requests.push(options??{});const request=JSON.parse(String(options?.body));methods.push(request.method);let result=values[request.method];if(request.method==='eth_getBlockByNumber'&&++blocks>1&&reorg)result={...result,hash:'0x'+'3'.repeat(64)};return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200,headers:{'Content-Type':'application/json'}})};t.after(()=>{globalThis.fetch=original});return {core:new RpcCoreAuthority('https://core-fixture.invalid'),requests,methods,values}}

test('Core adapter verifies exact wei, canonical block and confirmation readback without sending transactions',async t=>{const f=setup(t),receipt=await f.core.verify(intent,hash);assert.equal(receipt.amountWei,'1000000000000000001');assert.equal(receipt.confirmations,2);assert.equal(receipt.blockHash,blockHash);assert.deepEqual(f.methods,['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber','eth_blockNumber','eth_getBlockByNumber']);assert.equal(f.methods.some(m=>m.includes('send')||m.includes('sign')),false)});

test('Core transport does not follow authority redirects',async t=>{const f=setup(t);await f.core.verify(intent,hash);assert.ok(f.requests.every(request=>request.redirect==='error'))});

test('wrong chain is rejected before transaction inspection',async t=>{const f=setup(t,{eth_chainId:'0x1'});await assert.rejects(f.core.verify(intent,hash),/WRONG_TESTNET_CHAIN/);assert.equal(f.methods.length,1)});

test('missing and failed receipts cannot be credited',async t=>{const f=setup(t,{eth_getTransactionReceipt:null});await assert.rejects(f.core.verify(intent,hash),/TRANSACTION_PENDING/);f.values.eth_getTransactionReceipt={status:'0x0',transactionHash:hash};await assert.rejects(f.core.verify(intent,hash),/TRANSACTION_FAILED/)});

test('wrong sender, recipient and exact amount are rejected',async t=>{const f=setup(t);const tx=f.values.eth_getTransactionByHash;for(const changed of [{from:recipient},{to:owner},{value:'0x1'}]){f.values.eth_getTransactionByHash={...tx,...changed};await assert.rejects(f.core.verify(intent,hash),/TRANSACTION_MISMATCH/)}});

test('insufficient confirmations and changed canonical block reject',async t=>{const f=setup(t,{eth_blockNumber:'0x10'});await assert.rejects(f.core.verify(intent,hash),/CONFIRMATIONS_PENDING/);f.values.eth_blockNumber='0x11';f.values.eth_getBlockByNumber={...f.values.eth_getBlockByNumber,hash:'0x'+'9'.repeat(64)};await assert.rejects(f.core.verify(intent,hash),/NON_CANONICAL_TRANSACTION/)});

test('reorg during verification cannot be accepted',async t=>{const f=setup(t,{},true);await assert.rejects(f.core.verify(intent,hash),/NON_CANONICAL_TRANSACTION/)});

test('transaction outside the accepted intent time is rejected',async t=>{const f=setup(t);f.values.eth_getBlockByNumber={...f.values.eth_getBlockByNumber,timestamp:'0x1'};await assert.rejects(f.core.verify(intent,hash),/INTENT_TIME_MISMATCH/)});

test('Core endpoint rejects credentials, query, fragment and non-HTTPS configuration',()=>{for(const endpoint of ['http://core-fixture.invalid','https://user:password@core-fixture.invalid','https://core-fixture.invalid/?target=other','https://core-fixture.invalid/#target'])assert.throws(()=>new RpcCoreAuthority(endpoint))});
