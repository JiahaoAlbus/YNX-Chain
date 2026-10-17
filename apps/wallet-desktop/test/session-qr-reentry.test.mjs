import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(process.env.YNX_SESSION_RENDERER_SOURCE??new URL("../src/renderer.js",import.meta.url),"utf8");
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const requests=[];function input(){return{value:"",files:[],addEventListener(type,fn){this[type]=fn},cloneNode(){return input()},replaceWith(){}}}
 const context={walletConnectQR:input(),walletConnectURI:{value:""},walletConnectQRStatus:{textContent:""},pairCancel:{disabled:false},walletConnectInputRevision:0,activeAccount:"a",accountViewRevision:0,accountSecurityIntent:0,keyState:{revision:1},window:{ynxWallet:{walletConnectDecodeQR:()=>{const d=deferred();requests.push(d);return d.promise}}}};
 const helper=source.indexOf("function walletConnectViewCurrent()"),helperEnd=source.indexOf("const pairCancel",helper);
 if(helper>=0)runInNewContext(source.slice(helper,helperEnd),context);
 const start=source.indexOf("function invalidateWalletConnectInput()"),fallback=source.indexOf('walletConnectQR.addEventListener("change"'),end=source.indexOf("const proposalPanel",fallback>=0?fallback:start);
 runInNewContext(source.slice(start>=0?start:fallback,end),context);
 const retire=()=>{context.accountViewRevision++;context.accountSecurityIntent++;context.keyState.revision++;if(context.invalidateWalletConnectInput)context.invalidateWalletConnectInput();};
 const file=(bytes=Promise.resolve(new ArrayBuffer(1)))=>({type:"image/png",size:1,arrayBuffer:()=>bytes});
 return{context,requests,retire,file};
}
test("QR file reader retired by account recovery cannot dispatch decode or overwrite new input",async()=>{
 const h=fixture(),bytes=deferred(),old=h.context.walletConnectQR;old.files=[h.file(bytes.promise)];old.click?.();const job=old.change();h.retire();h.context.walletConnectURI.value="new account input";bytes.resolve(new ArrayBuffer(1));await new Promise(resolve=>setImmediate(resolve));for(const r of h.requests)r.resolve({ok:true,value:{uri:"old uri"}});await job;
 assert.equal(h.requests.length,0);assert.equal(h.context.walletConnectURI.value,"new account input");
});
for(const fail of [false,true])test(`late QR decoder ${fail?"failure":"success"} cannot overwrite a newer account`,async()=>{
 const h=fixture(),old=h.context.walletConnectQR;old.files=[h.file()];old.click?.();const job=old.change();await new Promise(resolve=>setImmediate(resolve));h.retire();h.context.walletConnectURI.value="new uri";h.context.walletConnectQRStatus.textContent="new notice";
 if(fail)h.requests[0].reject(Error("old decoder"));else h.requests[0].resolve({ok:true,value:{uri:"old uri"}});await job;assert.equal(h.context.walletConnectURI.value,"new uri");assert.equal(h.context.walletConnectQRStatus.textContent,"new notice");
});
test("detached chooser callback cannot dispatch a decode into the new account",async()=>{
 const h=fixture(),old=h.context.walletConnectQR;old.click?.();h.retire();old.files=[h.file()];const job=old.change();await new Promise(resolve=>setImmediate(resolve));for(const r of h.requests)r.resolve({ok:true,value:{uri:"old"}});await job;assert.equal(h.requests.length,0);
});
test("current QR decodes locally without pairing or approving",async()=>{
 const h=fixture(),input=h.context.walletConnectQR;input.click?.();input.files=[h.file()];const job=input.change();await new Promise(resolve=>setImmediate(resolve));h.requests[0].resolve({ok:true,value:{uri:"wc:current"}});await job;assert.equal(h.context.walletConnectURI.value,"wc:current");
});
function pairingFixture(cancel=false){
 const h=fixture(),pending=deferred(),status=deferred(),nodes={};
 const button={disabled:false,addEventListener(type,fn){this[type]=fn}};
 Object.assign(h.context,{walletConnectStatusRevision:0,pairButton:button,pairCancel:button,walletConnectDetail:{textContent:""},errorText:()=>"old refusal",copyUI:(node,key)=>{node.textContent=key},renderWalletConnect:value=>{nodes.rendered=value},statusReads:0});
 Object.assign(h.context.window.ynxWallet,{walletConnectPair:()=>pending.promise,walletConnectCancelPair:()=>pending.promise,walletConnectStatus:()=>{h.context.statusReads++;return status.promise}});
 const start=source.indexOf(cancel?'pairCancel.addEventListener("click"':'pairButton.addEventListener("click"'),end=source.indexOf(cancel?"function renderWalletConnect(payload)":source.includes("function invalidateWalletConnectInput()")?"function invalidateWalletConnectInput()":'walletConnectQR.addEventListener("change"',start);
 runInNewContext(source.slice(start,end),h.context);return{...h,pending,status,button,nodes};
}
for(const cancel of [false,true])for(const fail of [false,true])test(`late ${cancel?"cancel":"pair"} ${fail?"failure":"success"} cannot publish or read status in a recovered account`,async()=>{
 const h=pairingFixture(cancel),job=h.button.click();h.retire();h.context.walletConnectDetail.textContent="fresh pairing notice";
 if(fail)h.pending.reject(Error("old failure"));else h.pending.resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));h.status.resolve({started:true});await job;
 assert.equal(h.context.walletConnectDetail.textContent,"fresh pairing notice");assert.equal(h.context.statusReads,0);assert.equal(h.nodes.rendered,undefined);
});
for(const cancel of [false,true])test(`late ${cancel?"cancel":"pair"} status exception cannot unlock a newer busy button`,async()=>{
 const h=pairingFixture(cancel),job=h.button.click();h.pending.resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));h.retire();h.button.disabled=true;h.context.walletConnectDetail.textContent="fresh notice";h.status.reject(Error("old status"));await job;
 assert.equal(h.button.disabled,true);assert.equal(h.context.walletConnectDetail.textContent,"fresh notice");
});
function statusFixture(){
 const h=fixture(),reads=[];Object.assign(h.context,{walletConnectStatusRevision:0,walletConnectDetail:{textContent:""},refreshWalletConnectSessions:async()=>{},renderWalletConnect:value=>{h.context.rendered=value},copyUI:(node,key)=>{node.textContent=key}});
 h.context.window.ynxWallet.walletConnectStatus=()=>{const d=deferred();reads.push(d);return d.promise};
 const start=source.indexOf("async function refreshWalletConnectConnectionView()"),end=source.indexOf("window.ynxWallet.onWalletConnectStatus",start);runInNewContext(source.slice(start,end),h.context);return{...h,reads};
}
test("re-entered connection status wins over an older status read",async()=>{
 const h=statusFixture(),old=h.context.refreshWalletConnectConnectionView(),fresh=h.context.refreshWalletConnectConnectionView();h.reads[1].resolve({marker:"fresh"});await fresh;h.reads[0].resolve({marker:"old"});await old;assert.equal(h.context.rendered.marker,"fresh");
});
test("status read failure after account recovery cannot replace its current notice",async()=>{
 const h=statusFixture(),old=h.context.refreshWalletConnectConnectionView();h.retire();h.context.walletConnectDetail.textContent="current recovery";h.reads[0].reject(Error("old failure"));await old;assert.equal(h.context.walletConnectDetail.textContent,"current recovery");
});
for(const cancel of [false,true])for(const fail of [false,true])test(`newer status event survives a late ${cancel?"cancel":"pair"} status ${fail?"failure":"snapshot"}`,async()=>{
 const h=pairingFixture(cancel),job=h.button.click();h.pending.resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));h.context.walletConnectStatusRevision++;h.context.walletConnectDetail.textContent="new pairing event";h.button.disabled=true;
 if(fail)h.status.reject(Error("old status"));else h.status.resolve({started:true,pairing:false,pair:{phase:"canceled"}});await job;assert.equal(h.context.walletConnectDetail.textContent,"new pairing event");assert.equal(h.button.disabled,true);assert.equal(h.nodes.rendered,undefined);
});
