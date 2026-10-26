import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const main=await readFile(new URL('./macos/main.m',import.meta.url),'utf8');
const match=main.match(/NSString \*walletScript=@("(?:\\.|[^"\\])*");/);
assert.ok(match,'actual Cocoa Wallet document script required');
const script=JSON.parse(match[1]);
function fixture(){
 const posts=[],timers=new Map(),listeners=new Map();let n=0;
 const window={webkit:{messageHandlers:{ynxLocalWallet:{postMessage:value=>posts.push(value)}}}};
 vm.runInNewContext(script,{window,location:{pathname:'/'},crypto:{randomUUID},TextEncoder,DOMException,
 setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id),
 addEventListener:(name,fn)=>{const list=listeners.get(name)||[];list.push(fn);listeners.set(name,list);}});
 return {window,posts,timers,pagehide(){for(const fn of listeners.get('pagehide')||[])fn();}};
}
const requestId='00000000-0000-4000-8000-000000000001';
test('actual document asks native review without accepting renderer Source or automatically signing',async()=>{
 const f=fixture(),p=f.window.ynxDesktopWallet.approveDeploymentObservation(requestId),sent=f.posts[0];
 assert.equal(sent.action,'review-service-read');assert.equal(sent.requestId,requestId);
 assert.deepEqual(Object.keys(sent).sort(),['action','id','requestId']);
 f.window.__ynxNativeWalletReply({id:sent.id,ok:true,value:{approved:true,requestId}});
 assert.equal((await p).approved,true);assert.equal(f.posts.length,1);assert.equal(f.timers.size,0);
});
test('review timeout cancels the exact native prompt and late approval cannot revive the promise',async()=>{
 const f=fixture(),p=f.window.ynxDesktopWallet.approveDeploymentObservation(requestId);
 const refused=assert.rejects(p,/Native Wallet request timed out/),sent=f.posts[0];
 [...f.timers.values()][0]();
 assert.equal(f.posts.length,2);assert.equal(f.posts[1].action,'cancel-service-read-review');assert.equal(f.posts[1].id,sent.id);
 f.window.__ynxNativeWalletReply({id:sent.id,ok:true,value:{approved:true,requestId}});
 await refused;assert.equal(f.posts.length,2);
});
test('document retirement cancels native review and refuses further requests',async()=>{
 const f=fixture(),p=f.window.ynxDesktopWallet.approveDeploymentObservation(requestId);
 const refused=assert.rejects(p,/document closed/),sent=f.posts[0];f.pagehide();await refused;
 assert.equal(f.posts.filter(x=>x.action==='cancel-service-read-review').length,1);
 assert.equal(f.posts[1].id,sent.id);
 await assert.rejects(f.window.ynxDesktopWallet.approveDeploymentObservation(requestId),/document closed/);
 assert.equal(f.posts.length,2);
});
test('explicit read revocation uses its separate native action',async()=>{
 const f=fixture(),p=f.window.ynxDesktopWallet.endDeploymentObservation(),sent=f.posts[0];
 assert.equal(sent.action,'end-service-read');
 f.window.__ynxNativeWalletReply({id:sent.id,ok:true,value:null});await p;
 assert.equal(f.posts.some(x=>x.action==='end-connection'||x.action==='device-sign'),false);
});

