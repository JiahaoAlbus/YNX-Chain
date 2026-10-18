import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountWalletAddressConnectionPage,ADDRESS_CONNECTION_ORIGIN} from '../src/walletconnect-address-page.mjs';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({connect,encodeQR=async()=> 'data:image/png;base64,aGVsbG8=',disconnect=async()=>{}}={}){
 const nodes=new Map();for(const id of ['connect','cancel','disconnect','status','address','diagnostic','pairing','pairing-qr','open-wallet'])nodes.set(id,{disabled:false,hidden:false,textContent:'',attributes:new Map(),handlers:new Map(),setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);},addEventListener(k,v){this.handlers.set(k,v);}});
 let calls=0;const provider={request:async({method})=>method==='eth_chainId'?'0x1917':['0x'+'a'.repeat(40)]};
 const controller=mountWalletAddressConnectionPage({document:{getElementById:id=>nodes.get(id)},origin:ADDRESS_CONNECTION_ORIGIN,createConnection:options=>{assert.deepEqual(options.methods,[]);return {on(){},cancel:async()=>{},disconnect,connect:async input=>{calls++;return connect?connect(input,provider):provider;}};},encodeQR});
 return {nodes,controller,provider,calls:()=>calls,click:id=>nodes.get(id).handlers.get('click')()};
}
test('normal page buttons require an explicit connection and show only the approved address',async()=>{
 const f=fixture();assert.equal(f.calls(),0);assert.equal(f.nodes.get('connect').disabled,false);assert.equal(f.nodes.get('cancel').disabled,true);
 f.click('connect');await flush();assert.equal(f.calls(),1);assert.equal(f.controller.snapshot().phase,'connected');assert.equal(f.nodes.get('address').textContent,'0x'+'a'.repeat(40));assert.equal(f.nodes.get('disconnect').disabled,false);
 f.click('disconnect');await flush();assert.equal(f.controller.snapshot().phase,'disconnected');assert.equal(f.nodes.get('address').textContent,'');
});
test('late QR encoding after cancellation cannot restore the URI, native link or approval state',async()=>{
 const qr=defer(),approval=defer(),f=fixture({connect:async input=>{input.onURI('PUBLIC_SYNTHETIC_NOT_A_REAL_URI');return approval.promise;},encodeQR:()=>qr.promise});
 f.click('connect');await flush();assert.equal(f.nodes.get('cancel').disabled,false);f.click('cancel');await flush();
 assert.equal(f.nodes.get('connect').disabled,true,'original approval is still draining; do not offer a new connection');
 qr.resolve('data:image/png;base64,aGVsbG8=');approval.resolve(f.provider);await flush();
 assert.equal(f.controller.snapshot().phase,'cancelled');assert.equal(f.nodes.get('pairing').hidden,true);assert.equal(f.nodes.get('pairing-qr').attributes.has('src'),false);assert.equal(f.nodes.get('open-wallet').attributes.has('href'),false);
 assert.equal(f.nodes.get('connect').disabled,false);
});
test('normal consumer entry imports only the public original SDK and has no sign-in or transaction action',()=>{
 const entry=readFileSync(new URL('../web-connect/entry.mjs',import.meta.url),'utf8'),html=readFileSync(new URL('../web-connect/index.html',import.meta.url),'utf8');
 assert.ok(entry.includes("from '@ynx-chain/wallet-auth/walletconnect-dapp-connection'"));assert.ok(entry.includes('origin:location.origin'));assert.equal(/personal_sign|eth_sendTransaction|ynx_requestProductSession|clientFactory/.test(entry),false);
 for(const id of ['connect','cancel','disconnect','status','address','pairing','pairing-qr','open-wallet'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(html.includes("script-src 'self'"));assert.ok(html.includes('no-referrer'));
});
