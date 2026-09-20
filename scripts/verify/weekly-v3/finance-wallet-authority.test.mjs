import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(new URL('../../../chain-metadata/endpoint-authority/20260920.1.json',import.meta.url),'utf8'));
const source=fs.readFileSync(new URL('../../../apps/finance/web/order-wallet.js',import.meta.url),'utf8');
const duringValidity=Date.parse(manifest.issuedAt)+1000;

function browser(nowMs=duringValidity){
 const storage=new Map();let writes=0,network=0;
 class FixtureClock extends Date { constructor(...args){super(...(args.length?args:[nowMs]))} static now(){return nowMs} }
 const context=vm.createContext({window:{},Date:FixtureClock,URL,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{writes++;storage.set(k,v)},removeItem:k=>{writes++;storage.delete(k)}},
  fetch:()=>{network++;throw new Error('No network authorized in bundled-authority regression')},
 });
 vm.runInContext(source,context);
 return {api:context.window.YNXFinanceOrderWallet,counts:()=>({writes,network}),storage};
}

test('unchanged Finance bundle refuses private service PENDING without writes or remote trust replacement',async()=>{
 assert.equal(manifest.endpointStates.walletGateway.status,'PENDING');
 assert.equal(manifest.endpointStates.products.finance.status,'PENDING');
 const {api,counts}=browser();
 for(const action of [()=>api.assertAuthority(duringValidity),()=>api.begin({},new Date(duringValidity).toISOString()),()=>api.parseReturn('ynxwallet://invalid',new Date(duringValidity).toISOString())]){
  await assert.rejects(action,/PRIVATE_SERVICE_DEGRADED.*Wallet Gateway=PENDING.*Finance Product Session=PENDING/);
  assert.equal(api.pending(),null);
 }
 assert.deepEqual(counts(),{writes:0,network:0});
});

test('expired endpoint authority cannot be renewed by the browser',async()=>{
 const {api,counts}=browser(Date.parse(manifest.expiresAt));
 await assert.rejects(()=>api.assertAuthority(Date.parse(manifest.expiresAt)),/expir/i);
 assert.deepEqual(counts(),{writes:0,network:0});
});

test('integration bridge awaits the asynchronous refusal and never enters Wallet controller',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./finance-wallet-bridge.mjs',import.meta.url))],{
  input:JSON.stringify({mode:'approve',challenge:{unsigned:{},serverTime:new Date().toISOString()}}),encoding:'utf8',timeout:10000,
  env:{...process.env,WEEKLY_FINANCE_ROOT:root,WEEKLY_WALLET_ROOT:root},
 });
 assert.equal(result.status,0,result.stderr);
 const response=JSON.parse(result.stdout);
 assert.match(response.beginError,/PRIVATE_SERVICE_DEGRADED|expir/i);
 assert.equal(response.keys,0);assert.equal(response.callbackCount,0);assert.equal(response.pending,null);
 assert.deepEqual(response.requested,[]);assert.deepEqual(response.httpResults,[]);
 assert.equal(result.stderr,'');
});
