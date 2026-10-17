import assert from "node:assert/strict";
import test from "node:test";
import jsQR from "jsqr";
import { createReceiveCode, createBitcoinReceiveCode } from "../src/receive-code.mjs";
import { createReceiveCodeUI, drawReceiveCode, createBitcoinReceiveCodeUI, drawBitcoinReceiveCode } from "../src/receive-code-ui.mjs";
import {PNG} from 'pngjs';

const account = "ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt";
const evm = "0x84bc88971971078d450ac7cc31d9a4775d6e3065";
const status = { initialized: true, account: evm, ynxAccount: account };
const uri = `ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

const BTC_PUBLIC='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
function btcReceiveFixture(){
  let context={account:'PUBLIC-BTC-owner',revision:1,locked:false,authenticating:false},configRevision=0;
  const input={family:'bitcoin',network:'mainnet',vaultAccount:context.account,address:BTC_PUBLIC,revision:1};
  const snapshot=()=>({revision:configRevision,networks:[{family:'bitcoin',network:'mainnet',rpcUrl:'https://public.example/api',genesis:null}]});
  const identity={...input,index:0,account:0,path:"m/84'/0'/0'/0/0"};
  const dependencies={getContext:async()=>({...context}),readNetworks:async()=>snapshot(),readAccount:async()=>({...identity})};
  return {input,identity,dependencies,snapshot,context:()=>context,change:patch=>Object.assign(context,patch),config:()=>configRevision++};
}
function btcPixelsCanvas(){let pixels;const canvas={getContext(){pixels=new Uint8ClampedArray(canvas.width*canvas.height*4);return {fillStyle:'',fillRect(x,y,w,h){const rgb=this.fillStyle==='#FFFFFF'?[255,255,255]:[0,47,167];for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels.set([...rgb,255],(row*canvas.width+col)*4)}}},toDataURL(){return 'data:image/png;base64,'+PNG.sync.write({width:this.width,height:this.height,data:Buffer.from(pixels)}).toString('base64')}};return {canvas,pixels:()=>pixels};}
test('BTC receive: owned public producer and real canvas pixels decode exact amount-free BIP21 address',async()=>{
  const f=btcReceiveFixture(),code=await createBitcoinReceiveCode(f.input,f.dependencies),p=btcPixelsCanvas();drawBitcoinReceiveCode(p.canvas,code,{...f.input,configRevision:0,rpcUrl:'https://public.example/api',genesis:null});assert.equal(jsQR(p.pixels(),p.canvas.width,p.canvas.height).data,`bitcoin:${BTC_PUBLIC}`);assert.equal(code.path,"m/84'/0'/0'/0/0");assert.equal(code.networkVerified,false);assert(!JSON.stringify(code).includes('secretHex'));assert(!code.payload.includes('amount='));
});
for(const boundary of ['locked','authenticating','account','revision','config'])test(`BTC receive: producer fences ${boundary} after existing account read`,async()=>{
  const f=btcReceiveFixture(),original=f.dependencies.readAccount;f.dependencies.readAccount=async()=>{const value=await original();if(boundary==='config')f.config();else f.change({[boundary]:boundary==='account'?'PUBLIC-other':boundary==='revision'?2:true});return value};await assert.rejects(createBitcoinReceiveCode(f.input,f.dependencies),/FAMILY_ACCOUNT_CHANGED/);
});
test('BTC receive: different family address vault derivation and accessor input cannot masquerade as owned address',async()=>{
  for(const patch of [{family:'tron'},{address:'ynx1public'},{network:'testnet3'},{vaultAccount:'OTHER'},{revision:2},{secretHex:'PUBLIC-NOT-KEY'}]){const f=btcReceiveFixture();await assert.rejects(createBitcoinReceiveCode({...f.input,...patch},f.dependencies))}
  for(const patch of [{path:"m/44'/60'/0'/0/0"},{path:"m/84'/0'/0'/0/1"},{address:'PUBLIC-watch-address'},{index:1},{vaultAccount:'PUBLIC-other'}]){const f=btcReceiveFixture();f.dependencies.readAccount=async()=>({...f.identity,...patch});await assert.rejects(createBitcoinReceiveCode(f.input,f.dependencies))}
  const f=btcReceiveFixture();let calls=0;Object.defineProperty(f.input,'address',{get(){calls++;return BTC_PUBLIC},enumerable:true});await assert.rejects(createBitcoinReceiveCode(f.input,f.dependencies));assert.equal(calls,0);
});
test('BTC receive: missing selected network and malformed matrix fail closed before canvas paint',async()=>{
  const f=btcReceiveFixture();f.dependencies.readNetworks=async()=>({revision:0,networks:[]});await assert.rejects(createBitcoinReceiveCode(f.input,f.dependencies),/FAMILY_NETWORK_REQUIRED/);
  const good=btcReceiveFixture(),code=await createBitcoinReceiveCode(good.input,good.dependencies),expected={...good.input,configRevision:0,rpcUrl:'https://public.example/api',genesis:null};let draws=0,getters=0;const canvas={getContext(){draws++;return {}}};
  for(const modules of [Array(code.size**2),Array(code.size**2).fill(2),[0]])assert.throws(()=>drawBitcoinReceiveCode(canvas,{...code,modules},expected));const modules=Array(code.size**2).fill(0);Object.defineProperty(modules,'0',{get(){getters++;return 0}});assert.throws(()=>drawBitcoinReceiveCode(canvas,{...code,modules},expected));assert.equal(draws,0);assert.equal(getters,0);
});
function btcUIFixture(){
  const f=btcReceiveFixture(),p=btcPixelsCanvas(),nodes=[],downloads=[];let open=true,onPNG=()=>{};
  const originalPNG=p.canvas.toDataURL.bind(p.canvas);p.canvas.toDataURL=()=>{onPNG();return originalPNG()};
  const document={body:{append(){}},createElement:tag=>{if(tag==='canvas'){nodes.push(p.canvas);p.canvas.setAttribute=()=>{};return p.canvas}const node={tagName:tag,ownerDocument:{},textContent:'',handlers:{},setAttribute(){},addEventListener(e,fn){this.handlers[e]=fn},click(){downloads.push({data:this.href,name:this.download})},remove(){}};nodes.push(node);return node}};
  const api={familyNetworks:async()=>({ok:true,value:f.snapshot()}),receiveCode:async input=>({ok:true,value:await createBitcoinReceiveCode(input,f.dependencies)})};
  const ui=createBitcoinReceiveCodeUI({document,parent:{append(){}},api,getContext:f.context,getSelection:()=>({family:'bitcoin',network:'mainnet'}),isOpen:()=>open});
  return {...f,...p,ui,api,nodes,downloads,png:callback=>onPNG=callback,close(){open=false;ui.invalidate()}};
}
test('R41 BTC retired network recheck cannot clear the successor QR or PNG control',async()=>{
 for(const phase of ['refresh','export-before','export-after']){
  const h=btcUIFixture();if(phase!=='refresh')await h.ui.refresh(h.identity);
  const read=h.api.familyNetworks,entered=deferred(),released=deferred();let calls=0;
  h.api.familyNetworks=async()=>{const response=await read();if(++calls===(phase==='export-before'?1:2)){entered.resolve();await released.promise}return response};
  const old=phase==='refresh'?h.ui.refresh(h.identity):h.ui.exportPNG();await entered.promise;
  h.api.familyNetworks=read;h.config();h.change({revision:2});await h.ui.refresh(h.identity);assert.equal(h.canvas.hidden,false);
  released.resolve();await old;assert.equal(h.canvas.hidden,false,phase);assert.equal(h.nodes[3].disabled,false,phase);assert.equal(h.downloads.length,0,phase);
  await h.ui.exportPNG();assert.equal(h.downloads.length,1,phase);assert.equal(h.downloads[0].name,`BTC-mainnet-receive-${BTC_PUBLIC}.png`);
 }
});
test('BTC receive: normal producer bridge renders and exports real PNG that independently decodes exact BTC URI',async()=>{
  const h=btcUIFixture();await h.ui.refresh(h.identity);assert.equal(h.canvas.hidden,false);await h.ui.exportPNG();assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].name,`BTC-mainnet-receive-${BTC_PUBLIC}.png`);const png=PNG.sync.read(Buffer.from(h.downloads[0].data.split(',')[1],'base64'));assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,`bitcoin:${BTC_PUBLIC}`);
});
for(const boundary of ['locked','authenticating','account','revision','config','close'])test(`BTC receive: PNG export refuses ${boundary} during encoding`,async()=>{
  const h=btcUIFixture();await h.ui.refresh(h.identity);h.png(()=>{if(boundary==='config')h.config();else if(boundary==='close')h.close();else h.change({[boundary]:boundary==='account'?'PUBLIC-other':boundary==='revision'?2:true})});await h.ui.exportPNG();assert.equal(h.downloads.length,0);
});
test('BTC receive: late old reply cannot resurrect closed view or release new code',async()=>{
  const h=btcUIFixture(),original=h.api.receiveCode,waiting=deferred();h.api.receiveCode=()=>waiting.promise;const first=h.ui.refresh(h.identity);for(let i=0;i<8;i++)await Promise.resolve();h.close();waiting.resolve(await original(h.input));await first;assert.equal(h.canvas.hidden,true);assert.equal(h.downloads.length,0);
  const next=btcUIFixture(),old=next.api.receiveCode,delay=deferred();next.api.receiveCode=()=>delay.promise;const a=next.ui.refresh(next.identity);for(let i=0;i<8;i++)await Promise.resolve();next.api.receiveCode=old;await next.ui.refresh(next.identity);assert.equal(next.canvas.hidden,false);delay.resolve(await old(next.input));await a;assert.equal(next.canvas.hidden,false);await next.ui.exportPNG();assert.equal(next.downloads.length,1);
});
test('BTC receive: forged bindings network verification claim and invalid PNG MIME are rejected',async()=>{
  const h=btcUIFixture(),original=h.api.receiveCode;h.api.receiveCode=async input=>{const reply=await original(input);return {...reply,value:{...reply.value,networkVerified:true}}};await h.ui.refresh(h.identity);assert.equal(h.canvas.hidden,true);assert.equal(h.downloads.length,0);
  const next=btcUIFixture();await next.ui.refresh(next.identity);next.canvas.toDataURL=()=> 'data:text/html;base64,AAAA';await next.ui.exportPNG();assert.equal(next.downloads.length,0);
  const f=btcReceiveFixture(),code=await createBitcoinReceiveCode(f.input,f.dependencies),expected={...f.input,network:'testnet3',configRevision:0,rpcUrl:'https://public.example/api',genesis:null};assert.throws(()=>drawBitcoinReceiveCode({getContext(){throw Error('must not draw')}},{...code,network:'testnet3',path:"m/84'/1'/0'/0/0"},expected),/BTC_RECEIVE_INVALID/);
});

test("actual Klein blue QR pixels decode independently to the exact native receiving identity and Testnet", async () => {
  let reads = 0;
  const code = await createReceiveCode(account, async () => { reads++; return status; });
  assert.equal(reads, 2);
  assert.equal(code.uri, uri);
  let pixels;
  const context = { fillStyle: "", fillRect(x, y, width, height) {
    pixels ??= new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const color = this.fillStyle === "#002FA7" ? [0, 47, 167, 255] : [255, 255, 255, 255];
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) pixels.set(color, (row * canvas.width + column) * 4);
  } };
  const canvas = { getContext: () => context };
  drawReceiveCode(canvas, code, account);
  assert.equal(canvas.width, canvas.height);
  assert.deepEqual([...pixels.slice(0, 4)], [255, 255, 255, 255]);
  assert.equal(jsQR(pixels, canvas.width, canvas.height)?.data, uri);
  assert.deepEqual(Object.keys(code).sort(), ["account", "asset", "chainId", "modules", "size", "uri"]);
});

test("uninitialized, unknown, malformed and mismatched receiving identities are rejected", async () => {
  for (const candidate of [null, { ...status, initialized: false }, { ...status, account: "0x" + "11".repeat(20) }, { ...status, ynxAccount: account.slice(0, -1) + "x" }]) {
    await assert.rejects(createReceiveCode(account, async () => candidate), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" });
  }
  for (const value of [undefined, {}, evm, account.toUpperCase(), account + "?asset=OTHER"]) {
    await assert.rejects(createReceiveCode(value, async () => status), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" });
  }
});

test("account invalidation during generation cannot return the previous receiving code", async () => {
  let reads = 0;
  await assert.rejects(createReceiveCode(account, async () => ++reads === 1 ? status : null), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" });
});

test("renderer rejects a wrong account/network/asset/URI or malformed matrix before allocating pixels", async () => {
  const code = await createReceiveCode(account, async () => status);
  const canvas = { getContext: () => { throw new Error("must not draw"); } };
  for (const delta of [{ account: evm }, { chainId: "ynx_1-1" }, { asset: "YNX" }, { uri: "https://remote.invalid" }, { size: 100000 }, { size: 22 }, { modules: [1] }, { modules: code.modules.map((value, i) => i === 0 ? 2 : value) }]) {
    assert.throws(() => drawReceiveCode(canvas, { ...code, ...delta }, account), /Invalid receiving code/);
    assert.equal(canvas.width, undefined);
  }
});

test("out-of-order account responses and late failures cannot overwrite the latest code", async () => {
  const first = deferred(), second = deferred(), drawn = [];
  const canvas = {}, label = { textContent: "" };
  const ui = createReceiveCodeUI({ canvas, status: label, requestCode: value => value === "first" ? first.promise : second.promise, draw: (_canvas, value, expected) => drawn.push({ value, expected }) });
  const a = ui.refresh("first"), b = ui.refresh("second");
  second.resolve({ ok: true, value: "second-code" }); await b;
  const feedback = label.textContent;
  first.resolve({ ok: false }); await a;
  assert.deepEqual(drawn, [{ value: "second-code", expected: "second" }]);
  assert.equal(label.textContent, feedback);
  assert.equal(canvas.hidden, false);
});

test("closing Receive or clearing a failed account invalidates in-flight generation", async () => {
  const pending = deferred(); let draws = 0;
  const canvas = {}, label = { textContent: "" };
  const ui = createReceiveCodeUI({ canvas, status: label, requestCode: () => pending.promise, draw: () => draws++ });
  const job = ui.refresh(account);
  ui.clear();
  pending.resolve({ ok: true, value: {} }); await job;
  assert.equal(draws, 0);
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.width, 1);
  assert.equal(label.textContent, "");
});

test("local generation and drawing failures hide the QR without a network fallback", async () => {
  for (const requestCode of [async () => { throw new Error("read failed"); }, async () => ({ ok: false }), async () => ({ ok: true, value: {} })]) {
    const canvas = {}, label = { textContent: "" };
    const ui = createReceiveCodeUI({ canvas, status: label, requestCode });
    await ui.refresh(account);
    assert.equal(canvas.hidden, true);
    assert.match(label.textContent, /unavailable/);
    await ui.refresh(null);
    assert.equal(label.textContent, "");
  }
});
