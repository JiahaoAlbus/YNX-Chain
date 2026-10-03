import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {SESSION_COPY} from "../src/wallet-locale-sessions.mjs";
import {WALLET_COPY,WALLET_LOCALES} from "../src/wallet-locale.mjs";
const source=readFileSync(process.env.YNX_SESSION_RENDERER_SOURCE??new URL("../src/renderer.js",import.meta.url),"utf8");
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const session={topic:"original-topic",origin:"https://app.example.invalid",name:"App",expiry:Math.floor(Date.now()/1000)+3600};
function fixture(){
  const reads=[],actions=[];function node(){return{children:[],textContent:"",disabled:false,append(...values){this.children.push(...values)},replaceChildren(...values){this.children=values},addEventListener(type,fn){this[type]=fn}}}
  const panel=node(),detail=node(),context={invalidateWalletConnectInput(){},sessionsPanel:panel,walletConnectDetail:detail,walletConnectSessionsRevision:0,accountViewRevision:0,accountSecurityIntent:0,activeAccount:"account-a",keyState:{locked:false,revision:1},
    document:{createElement:node},window:{ynxWallet:{walletConnectSessions:()=>{const d=deferred();reads.push(d);return d.promise},walletConnectDisconnect:topic=>{const d=deferred();actions.push({...d,topic});return d.promise}}},showAccountError:(target,error)=>{target.textContent=error.message}};
  const start=source.indexOf("function invalidateWalletConnectSessions("),fallback=source.indexOf("async function refreshWalletConnectSessions()"),end=source.indexOf("window.ynxWallet.onWalletConnectStatus",fallback);
  runInNewContext(source.match(/^function copyUI\([^\n]+/m)[0]+"\n"+source.slice(start<0?fallback:start,end),context);
  const load=async()=>{const job=context.refreshWalletConnectSessions();reads.at(-1).resolve({ok:true,value:[session]});await job;return panel.children[0]?.children?.[1]};
  return{context,panel,detail,reads,actions,load};
}
for(const thrown of [false,true])test(`failed session read ${thrown?"exception":"IPC refusal"} is unavailable, never an empty verified inventory`,async()=>{
  const h=fixture(),job=h.context.refreshWalletConnectSessions();if(thrown)h.reads[0].reject(Error("offline"));else h.reads[0].resolve({ok:false,error:{message:"offline"}});
  const result=await job.then(()=>null,error=>error);assert.equal(result,null);assert.match(h.panel.children[0]?.textContent??"",/could not be read/);
});
test("latest session inventory wins while a late old empty result cannot erase it",async()=>{
  const h=fixture(),old=h.context.refreshWalletConnectSessions(),fresh=h.context.refreshWalletConnectSessions();h.reads[1].resolve({ok:true,value:[session]});await fresh;
  h.reads[0].resolve({ok:true,value:[]});await old;assert.equal(h.panel.children[0]?.children?.[0]?.textContent,"App · https://app.example.invalid");
});
test("a detached session button after the account/security view retires cannot revoke a later account's permissions",async()=>{
  const h=fixture(),button=await h.load();h.context.accountViewRevision++;h.context.accountSecurityIntent++;h.context.keyState.revision+=2;
  const job=button.click();if(h.actions[0])h.actions[0].resolve({ok:true,value:{...session,disconnected:true,localPermissionRevoked:true}});await new Promise(resolve=>setImmediate(resolve));if(h.reads[1])h.reads[1].resolve({ok:true,value:[]});await job;
  assert.equal(h.actions.length,0);
});
test("duplicate native button delivery is single-flight, not a second disconnect IPC",async()=>{
  const h=fixture(),button=await h.load(),job=button.click(),second=button.click();
  const count=h.actions.length;for(const action of h.actions)action.resolve({ok:true,value:{...session,disconnected:true,localPermissionRevoked:true}});
  await new Promise(resolve=>setImmediate(resolve));for(const read of h.reads.slice(1))read.resolve({ok:true,value:[]});await Promise.all([job,second]);assert.equal(count,1);
});
for(const outcome of ["success","failure","throw"])test(`late disconnect ${outcome} cannot publish into a recovered same-account view`,async()=>{
  const h=fixture(),button=await h.load(),job=button.click();h.context.accountViewRevision++;h.context.accountSecurityIntent++;h.context.keyState.revision+=2;h.detail.textContent="new account recovery notice";
  if(outcome==="throw")h.actions[0].reject(Error("old relay failure"));else h.actions[0].resolve(outcome==="success"?{ok:true,value:{...session,disconnected:true,localPermissionRevoked:true}}:{ok:false,error:{message:"old failure"}});
  await new Promise(resolve=>setImmediate(resolve));for(const read of h.reads.slice(1))read.resolve({ok:true,value:[]});await job.then(()=>{},()=>{});
  assert.equal(h.detail.textContent,"new account recovery notice");assert.equal(h.reads.length,1);
});
test("partial disconnect acknowledgement is not a claim that both remote session and local permission were revoked",async()=>{
  const h=fixture(),button=await h.load(),job=button.click();h.actions[0].resolve({ok:true,value:{topic:session.topic,disconnected:false,localPermissionRevoked:true}});
  await new Promise(resolve=>setImmediate(resolve));for(const read of h.reads.slice(1))read.resolve({ok:true,value:[]});await job;
  assert.doesNotMatch(h.detail.textContent,/Session disconnected and local account permission revoked/);assert.match(h.detail.textContent,/complete confirmation/);
});
test("current transport exception remains retryable and does not produce an unhandled promise",async()=>{
  const h=fixture(),button=await h.load(),job=button.click();h.actions[0].reject(Error("relay failure"));
  await new Promise(resolve=>setImmediate(resolve));for(const read of h.reads.slice(1))read.resolve({ok:true,value:[session]});const error=await job.then(()=>null,e=>e);
  assert.equal(error,null);assert.match(h.detail.textContent,/complete confirmation/);assert.equal(button.disabled,false);
});
test("complete producer acknowledgement reports both operations and reloads the inventory",async()=>{
  const h=fixture(),button=await h.load(),job=button.click();h.actions[0].resolve({ok:true,value:{topic:session.topic,disconnected:true,localPermissionRevoked:true}});
  await new Promise(resolve=>setImmediate(resolve));h.reads[1].resolve({ok:true,value:[]});await job;
  assert.equal(h.detail.textContent,"Session disconnected and local account permission revoked.");assert.equal(h.panel.children[0].textContent,"No active WalletConnect sessions.");
});
for(const value of [null,{},[{...session,expiry:0}],[session,session],[{...session,origin:"http://app.example.invalid"}],[{...session,topic:"../topic"}]])test(`invalid inventory ${JSON.stringify(value)} remains unknown with an explicit read-only retry`,async()=>{
  const h=fixture(),job=h.context.refreshWalletConnectSessions();h.reads[0].resolve({ok:true,value});await job;
  assert.match(h.panel.children[0].textContent,/could not be read/);const retry=h.panel.children[1].click();h.reads[1].resolve({ok:true,value:[session]});await retry;assert.equal(h.actions.length,0);assert.equal(h.panel.children[0].children[0].textContent,"App · https://app.example.invalid");
});
test("explicit invalidation detaches old rows and retries only the current account inventory",async()=>{
  const h=fixture(),oldButton=await h.load();h.context.invalidateWalletConnectSessions();h.context.activeAccount="account-b";h.context.accountViewRevision++;
  await oldButton.click();assert.equal(h.actions.length,0);const retry=h.panel.children[0].click();h.reads[1].resolve({ok:true,value:[]});await retry;assert.equal(h.panel.children[0].textContent,"No active WalletConnect sessions.");
});
test("all twelve languages include every session read/revoke/retry state without translating session data",()=>{
 for(const locale of WALLET_LOCALES){assert.equal(Object.keys(SESSION_COPY[locale]).length,6);for(const [key,value] of Object.entries(SESSION_COPY[locale])){assert.equal(WALLET_COPY[locale][key],value);assert.ok(value.length>0);}}
 assert.match(source,/function renderAccount\(payload\)\s*\{\s*clearAssetBalance\(\);\s*clearTransactionResolution\(\);\s*invalidateWalletConnectSessions\(\)/);
 assert.match(source,/accountSecurityIntent\+\+;invalidateWalletConnectSessions\(\)/);
 assert.match(source,/if \(name === "connections"\) void refreshWalletConnectConnectionView\(\)/);
});
