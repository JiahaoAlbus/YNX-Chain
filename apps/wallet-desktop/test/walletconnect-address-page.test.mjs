import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountWalletAddressConnectionPage,ADDRESS_CONNECTION_ORIGIN} from '../src/walletconnect-address-page.mjs';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({connect,encodeQR=async()=> 'data:image/png;base64,aGVsbG8=',disconnect=async()=>{},cancel=async()=>{},formalDisconnect=false}={}){
 const nodes=new Map();for(const id of ['connect','cancel','disconnect','check-original','original-result','status','address','diagnostic','pairing','pairing-qr','open-wallet'])nodes.set(id,{disabled:false,hidden:false,textContent:'',attributes:new Map(),handlers:new Map(),setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);},addEventListener(k,v){this.handlers.set(k,v);}});
 let calls=0,cancels=0,disconnects=0;const provider={request:async({method})=>method==='eth_chainId'?'0x1917':['0x'+'a'.repeat(40)]};
 const listeners=new Map();
 const controller=mountWalletAddressConnectionPage({document:{getElementById:id=>nodes.get(id)},origin:ADDRESS_CONNECTION_ORIGIN,createConnection:options=>{assert.deepEqual(options.methods,[]);return {on:(name,handler)=>listeners.set(name,handler),
  ...(formalDisconnect?{cleanupSnapshot:()=>({scope:'local-only',attempt:1,stage:'approval',connection:'fulfilled',initialization:'fulfilled',inFlight:false,draining:false,cancelled:false,cleanup:'unobserved',firstCause:{present:false,code:null},remoteCleanup:'not-proven',remoteCleanupUnconfirmed:true})}:{}),
  cancel:async()=>{cancels++;return cancel();},disconnect:async()=>{disconnects++;await disconnect();if(formalDisconnect)listeners.get('disconnect')?.({code:4900,message:'PAIR_EXPLICIT_DISCONNECT',reason:'permission-revoked'});},connect:async input=>{calls++;return connect?connect(input,provider):provider;}};},encodeQR});
 return {nodes,controller,provider,calls:()=>calls,counts:()=>({calls,cancels,disconnects}),click:id=>nodes.get(id).handlers.get('click')()};
}
test('normal page buttons require an explicit connection and show only the approved address',async()=>{
 const f=fixture({formalDisconnect:true});assert.equal(f.calls(),0);assert.equal(f.nodes.get('connect').disabled,false);assert.equal(f.nodes.get('cancel').disabled,true);
 f.click('connect');await flush();assert.equal(f.calls(),1);assert.equal(f.controller.snapshot().phase,'connected');assert.equal(f.nodes.get('address').textContent,'0x'+'a'.repeat(40));assert.equal(f.nodes.get('disconnect').disabled,false);
 f.click('disconnect');await flush();assert.equal(f.controller.snapshot().phase,'disconnected');assert.equal(f.nodes.get('address').textContent,'');
 assert.match(f.nodes.get('original-result').textContent,/Original approved session disconnected locally/);assert.equal(f.nodes.get('connect').disabled,false);
});
test('late QR encoding after cancellation cannot restore the URI, native link or approval state',async()=>{
 const qr=defer(),approval=defer(),f=fixture({connect:async input=>{input.onURI('PUBLIC_SYNTHETIC_NOT_A_REAL_URI');return approval.promise;},encodeQR:()=>qr.promise});
 f.click('connect');await flush();assert.equal(f.nodes.get('cancel').disabled,false);f.click('cancel');await flush();
 assert.equal(f.nodes.get('connect').disabled,true,'original approval is still draining; do not offer a new connection');
 qr.resolve('data:image/png;base64,aGVsbG8=');approval.resolve(f.provider);await flush();
 assert.equal(f.controller.snapshot().phase,'cancelled');assert.equal(f.nodes.get('pairing').hidden,true);assert.equal(f.nodes.get('pairing-qr').attributes.has('src'),false);assert.equal(f.nodes.get('open-wallet').attributes.has('href'),false);
 assert.equal(f.nodes.get('connect').disabled,true,'local cancellation and late promise settlement do not prove remote cleanup');
});
test('normal consumer entry imports only the public original SDK and has no sign-in or transaction action',()=>{
 const entry=readFileSync(new URL('../web-connect/entry.mjs',import.meta.url),'utf8'),html=readFileSync(new URL('../web-connect/index.html',import.meta.url),'utf8');
 assert.ok(entry.includes("from '@ynx-chain/wallet-auth/walletconnect-dapp-connection'"));assert.ok(entry.includes('origin:location.origin'));assert.equal(/personal_sign|eth_sendTransaction|ynx_requestProductSession|clientFactory/.test(entry),false);
 for(const id of ['connect','cancel','disconnect','status','address','pairing','pairing-qr','open-wallet'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(html.includes("script-src 'self'"));assert.ok(html.includes('no-referrer'));
});
test('reviewed bilingual permission text and public address are not machine-translated',()=>{
 const html=readFileSync(new URL('../web-connect/index.html',import.meta.url),'utf8');
 assert.match(html,/<html\b[^>]*\blang="en"[^>]*\btranslate="no"/);
 assert.match(html,/<p id="address" aria-label="Approved public address \/ 已批准的公开地址"/);
 assert.ok(html.includes('Connect / 连接'));
 assert.ok(html.includes('It cannot request signatures, sign-in permissions, tokens or transfers.'));
});
test('normal original-result button only observes original local calls and never constructs or retries a connection',async()=>{
 const pending=defer(),f=fixture({connect:()=>pending.promise});
 assert.equal(f.nodes.get('check-original').disabled,true);f.click('check-original');assert.equal(f.calls(),0);
 f.click('connect');await flush();assert.equal(f.nodes.get('check-original').disabled,false);
 for(let i=0;i<3;i++)f.click('check-original');assert.match(f.nodes.get('original-result').textContent,/awaiting original result/);
 assert.deepEqual(f.counts(),{calls:1,cancels:0,disconnects:0});
 pending.resolve(f.provider);await flush();f.click('check-original');
 assert.match(f.nodes.get('original-result').textContent,/returned/);assert.match(f.nodes.get('original-result').textContent,/Remote cleanup is not independently confirmed/);
 assert.deepEqual(f.counts(),{calls:1,cancels:0,disconnects:0});
});
test('normal original-result UI preserves separate cancel and cleanup codes while UNKNOWN keeps retry disabled',async()=>{
 const pending=defer(),f=fixture({connect:()=>pending.promise,cancel:async()=>{throw Object.assign(Error('PRIVATE_CLEANUP'),{code:'YNX_PAIR_CLEANUP_UNCONFIRMED'});}});
 f.click('connect');await flush();f.click('cancel');await flush();
 pending.reject(Object.assign(Error('PRIVATE_ORIGINAL'),{code:'YNX_PAIR_CANCELLED'}));await flush();
 f.click('check-original');const text=f.nodes.get('original-result').textContent;
 assert.ok(text.includes('YNX_PAIR_CANCELLED'));assert.ok(text.includes('YNX_PAIR_CLEANUP_UNCONFIRMED'));assert.equal(text.includes('PRIVATE_'),false);
 assert.equal(f.nodes.get('connect').disabled,true);assert.equal(f.nodes.get('check-original').disabled,false);
 f.click('connect');f.click('cancel');f.click('disconnect');f.click('check-original');await flush();
 assert.deepEqual(f.counts(),{calls:1,cancels:1,disconnects:0});assert.equal(f.controller.snapshot().phase,'cleanup-unconfirmed');
});
