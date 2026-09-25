import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import {BRIDGE_VERSION,RUNTIME_REQUEST,RUNTIME_EVENT,RUNTIME_DOCUMENT_PROBE} from "../src/extension-bridge.js";
import {PROVIDER_ACCOUNT_KEY,PROVIDER_PERMISSIONS_KEY,grantPermission,providerPermissionKey} from "../src/extension-provider-permissions.js";
import {EXTENSION_VAULT_KEY} from "../src/extension-vault.js";

// Actual worker and policy modules; only browser APIs and public grant storage
// are simulated. The vault identity is stubbed; no private key, signing,
// approval or network fixture is available.
const ORIGIN="https://fixture-dapp.example",OTHER="https://other.example";
const ACCOUNT={version:1,source:"ynx-wallet-vault",account:`0x${"11".repeat(20)}`};
const source=await readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"),bindings={};
for(const match of source.matchAll(/^import \{([^}]+)\} from "\.\/([^"]+)";$/gm)){
  const module=await import(new URL(`../src/${match[2]}`,import.meta.url));
  for(const name of match[1].split(","))bindings[name]=module[name];
}
const executable=source.replace(/^import .*;\n/gm,"");
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(t,{firefox=false,withDocumentId=true,manualTimers=false,deadlineMs=10000}={}){
  const scope=firefox?"firefox-container-1":"chromium-default",tabs=new Map(),events=[],injections=[],probes=[],timers=new Set(),hooks={};
  const local={[EXTENSION_VAULT_KEY]:{account:ACCOUNT.account},[PROVIDER_ACCOUNT_KEY]:ACCOUNT,[PROVIDER_PERMISSIONS_KEY]:grantPermission({},ORIGIN,ACCOUNT,1,scope)};
  let listener,onUpdated,onRemoved,count=0;
  const addTab=(id,extra={})=>{
    const digits=id.toString(16).padStart(32,"a");
    const tab={id,url:`${ORIGIN}/page`,incognito:false,...(firefox?{cookieStoreId:scope}:{}),documentId:withDocumentId?(firefox?`${digits.slice(0,8)}-${digits.slice(8,12)}-${digits.slice(12,16)}-${digits.slice(16,20)}-${digits.slice(20)}`:digits):undefined,documentNonce:id.toString(16).padStart(64,"b"),active:true,bridge:true,...extra};tabs.set(id,tab);return tab;
  };
  addTab(1);addTab(2);
  const publicTab=tab=>tab&&({id:tab.id,url:tab.url,incognito:tab.incognito,...(tab.cookieStoreId!==undefined?{cookieStoreId:tab.cookieStoreId}:{})});
  const storage=data=>({async get(keys){const result=structuredClone(Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]])));await hooks.get?.(keys);return result},async set(values){await hooks.set?.(values);Object.assign(data,structuredClone(values))},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key]}});
  const api={runtime:{id:"fixture",getURL:p=>`${firefox?"moz":"chrome"}-extension://fixture/${p}`,onMessage:{addListener:fn=>listener=fn}},storage:{local:storage(local),session:storage({})},tabs:{
    onUpdated:{addListener:fn=>onUpdated=fn},onRemoved:{addListener:fn=>onRemoved=fn},
    async query(){const result=[...tabs.values()].map(publicTab);await hooks.query?.();return result},
    async get(id){await hooks.tabGet?.(id);const tab=tabs.get(id);if(!tab)throw new Error("Tab absent");return publicTab(tab)},
    async sendMessage(id,message,target){
      const tab=tabs.get(id);if(!tab||!tab.bridge||!tab.active)throw new Error("No active bridge");
      if(target?.documentId!==undefined&&target.documentId!==tab.documentId)throw new Error("Old document");
      assert.equal(target?.frameId,0);
      if(message.type===RUNTIME_DOCUMENT_PROBE){
        probes.push({id,target:plain(target)});await hooks.probe?.(id,message,target);
        if(!tab.active||!tab.bridge||new URL(tab.url).origin!==message.origin)throw new Error("Inactive document");
        const response={version:1,origin:message.origin,challenge:message.challenge,documentNonce:tab.documentNonce};await hooks.probeReply?.(id,response);return response;
      }
      assert.equal(message.type,RUNTIME_EVENT);
      // Content script independently checks the activation nonce and origin.
      if(message.documentNonce===tab.documentNonce&&message.origin===new URL(tab.url).origin)events.push({id,target:plain(target),...plain(message)});
      await hooks.event?.(id,message);
    }
  },scripting:{async executeScript(plan){
    injections.push(plan.target.tabId);assert.equal(plan.world,"ISOLATED");assert.deepEqual(plain(plan.target.frameIds),[0]);assert.equal(plan.func(),null);
    await hooks.inject?.(plan.target.tabId);const tab=tabs.get(plan.target.tabId);if(!tab)throw new Error("No target");
    const result=[{frameId:0,result:null,...(tab.documentId!==undefined?{documentId:tab.documentId}:{})}];await hooks.injectReply?.(tab.id);return result;
  }},windows:{create(){throw new Error("Approval forbidden")},remove(){throw new Error("Approval forbidden")}}};
  const forbidden=()=>{throw new Error("Vault/signing/network forbidden in revocation fixture")};
  const context=vm.createContext({...bindings,chrome:api,URL,Date,crypto:webcrypto,
    setTimeout:(fn,ms)=>{const timer=manualTimers?{fn,ms}:setTimeout(fn,ms);timers.add(timer);return timer},clearTimeout:timer=>{if(!manualTimers)clearTimeout(timer);timers.delete(timer)},
    runExtensionMigration:async()=>({fixture:true}),providerAccountFromVault:()=>ACCOUNT,forwardExtensionRpc:forbidden,broadcastExtensionTransaction:forbidden,unlockEncryptedVault:forbidden,signExtensionRequest:forbidden,fetch:forbidden});
  vm.runInContext(executable,context);t.after(()=>{if(!manualTimers)for(const timer of timers)clearTimeout(timer)});
  const request=(id,method="wallet_revokePermissions",params=[{eth_accounts:{}}])=>{
    const tab=tabs.get(id),sender={tab:publicTab(tab),frameId:0,url:tab.url,...(tab.documentId!==undefined?{documentId:tab.documentId,documentLifecycle:"active"}:{})};
    const message={type:RUNTIME_REQUEST,version:BRIDGE_VERSION,requestId:`ynx-${(++count).toString(16).padStart(8,"0")}-1111-4111-8111-111111111111`,origin:new URL(tab.url).origin,deadlineAt:Date.now()+deadlineMs,method,params,documentNonce:tab.documentNonce};
    return new Promise(resolve=>listener(message,sender,value=>resolve(plain(value))));
  };
  return{scope,tabs,local,events,probes,injections,hooks,addTab,request,
    expireNotificationBudget:()=>{assert.equal(manualTimers,true);assert.equal(timers.size,1);const[timer]=timers;timers.delete(timer);timer.fn();return timer.ms},
    update:(id,change={status:"loading"})=>onUpdated(id,change),remove:id=>{tabs.delete(id);onRemoved(id)},
    queueAuthority:vm.runInContext("action=>mutateAuthority(action)",context)};
}

function assertRevokedEvents(f,ids){
  assert.deepEqual([...new Set(f.events.map(e=>e.id))].sort(),ids);
  for(const id of ids){const es=f.events.filter(e=>e.id===id);assert.deepEqual(es.map(e=>[e.event,e.payload]),[["accountsChanged",[]],["disconnect",{code:4900,message:"YNX Wallet disconnected from this site."}]]);assert.ok(es.every(e=>e.documentNonce===f.tabs.get(id).documentNonce));}
}

for(const options of [{},{firefox:true},{firefox:true,withDocumentId:false}])test(`same-scope revoke notifies both current documents ${JSON.stringify(options)}`,async t=>{
  const f=fixture(t,options);
  assert.deepEqual(await f.request(2,"eth_accounts",[]),{ok:true,result:[ACCOUNT.account]});
  assert.deepEqual(await f.request(1),{ok:true,result:null});
  assert.deepEqual(await f.request(2,"eth_accounts",[]),{ok:true,result:[]});
  assertRevokedEvents(f,[1,2]);
  assert.ok(f.events.every(e=>e.target.documentId===f.tabs.get(e.id).documentId));
});

test("fresh worker discovers B without an in-memory request subscription",async t=>{
  const f=fixture(t);assert.deepEqual(await f.request(1,"ynx_disconnect",[]),{ok:true,result:null});assertRevokedEvents(f,[1,2]);
});

test("foreign origins, ports, private and other Firefox contexts receive nothing",async t=>{
  const f=fixture(t,{firefox:true});f.addTab(3,{url:`${OTHER}/page`});f.addTab(4,{cookieStoreId:"firefox-container-2"});f.addTab(5,{incognito:true});f.addTab(6,{cookieStoreId:undefined});f.addTab(7,{url:`${ORIGIN}:8443/page`});
  f.local[PROVIDER_PERMISSIONS_KEY]=grantPermission(grantPermission(f.local[PROVIDER_PERMISSIONS_KEY],ORIGIN,ACCOUNT,2,"firefox-container-2"),OTHER,ACCOUNT,2,f.scope);
  await f.request(1);assertRevokedEvents(f,[1,2]);assert.deepEqual(f.injections,[2]);
  assert.ok(f.local[PROVIDER_PERMISSIONS_KEY][providerPermissionKey(ORIGIN,"firefox-container-2")]);assert.ok(f.local[PROVIDER_PERMISSIONS_KEY][providerPermissionKey(OTHER,f.scope)]);
});

for(const stage of ["query","injection","probe"])test(`departing B document at ${stage} is excluded while A still revokes`,async t=>{
  const f=fixture(t);let once=false;const navigate=()=>{if(!once){once=true;f.update(2)}};
  if(stage==="query")f.hooks.query=navigate;
  if(stage==="injection")f.hooks.inject=id=>{if(id===2)navigate()};
  if(stage==="probe")f.hooks.probe=id=>{if(id===2)navigate()};
  await f.request(1);assertRevokedEvents(f,[1]);assert.equal(f.local[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);
});

test("browser document replacement and content activation replacement fail closed",async t=>{
  for(const mutation of ["documentId","nonce","context","missingId","absentBridge","closed"]){await t.test(mutation,async t=>{
    const f=fixture(t);
    if(mutation==="documentId")f.hooks.injectReply=id=>{if(id===2)f.tabs.get(2).documentId="c".repeat(32)};
    if(mutation==="nonce")f.hooks.probeReply=id=>{if(id===2)f.tabs.get(2).documentNonce="c".repeat(64)};
    if(mutation==="context")f.hooks.probeReply=id=>{if(id===2)f.tabs.get(2).incognito=true};
    if(mutation==="missingId")f.tabs.get(2).documentId=undefined;
    if(mutation==="absentBridge")f.tabs.get(2).bridge=false;
    if(mutation==="closed")f.hooks.inject=id=>{if(id===2)f.remove(2)};
    assert.deepEqual(await f.request(1),{ok:true,result:null});assertRevokedEvents(f,[1]);
  });}
});

test("one inaccessible tab does not block the other same-scope tab",async t=>{
  const f=fixture(t);f.addTab(3);f.hooks.inject=id=>{if(id===2)throw new Error("Host permission absent")};await f.request(1);assertRevokedEvents(f,[1,3]);
});

test("revoke storage failure emits no state change",async t=>{
  const f=fixture(t);f.hooks.set=()=>{throw new Error("Storage unavailable")};assert.equal((await f.request(1)).ok,false);assert.equal(f.events.length,0);assert.ok(f.local[PROVIDER_PERMISSIONS_KEY][ORIGIN]);
});

test("tab discovery failure retains revocation and requester notifications",async t=>{
  const f=fixture(t);f.hooks.query=()=>{throw new Error("Tabs unavailable")};
  assert.deepEqual(await f.request(1),{ok:true,result:null});assertRevokedEvents(f,[1]);
  assert.equal(f.local[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);
});

test("malformed sibling probe cannot receive a revocation event",async t=>{
  const f=fixture(t);f.hooks.probeReply=(id,response)=>{if(id===2)response.challenge="0".repeat(64)};
  assert.deepEqual(await f.request(1),{ok:true,result:null});assertRevokedEvents(f,[1]);
});

test("a document departing between events receives no later disconnect",async t=>{
  const f=fixture(t);f.hooks.event=(id,message)=>{if(id===2&&message.event==="accountsChanged")f.update(2)};
  assert.deepEqual(await f.request(1),{ok:true,result:null});
  assert.deepEqual(f.events.filter(event=>event.id===2).map(event=>[event.event,event.payload]),[["accountsChanged",[]]]);
  assert.deepEqual(f.events.filter(event=>event.id===1).map(event=>event.event),["accountsChanged","disconnect"]);
});

test("requester departure after persistence does not suppress a current sibling",async t=>{
  const f=fixture(t);f.hooks.set=()=>f.update(1);
  assert.equal((await f.request(1)).ok,false);assertRevokedEvents(f,[2]);
  assert.equal(f.local[PROVIDER_PERMISSIONS_KEY][ORIGIN],undefined);
});

test("new authority mutation waits until revocation notifications finish",async t=>{
  const f=fixture(t);let queued;f.hooks.event=(id,message)=>{if(id===2&&message.event==="accountsChanged")queued=f.queueAuthority(()=>{assertRevokedEvents(f,[1,2]);f.local[PROVIDER_PERMISSIONS_KEY]=grantPermission({},ORIGIN,ACCOUNT,3)})};
  await f.request(1);assert.ok(queued);await queued;assert.ok(f.local[PROVIDER_PERMISSIONS_KEY][ORIGIN]);
});

for(const stage of ["query","injection","context","probe","event"])test(`hung ${stage} releases authority at total budget; late settlement dispatches nothing else`,{timeout:1000},async t=>{
  const f=fixture(t,{manualTimers:true}),blocked=Promise.withResolvers(),entered=Promise.withResolvers();
  const hang=()=>{entered.resolve();return blocked.promise};
  if(stage==="query")f.hooks.query=hang;
  if(stage==="injection")f.hooks.inject=id=>id===2?hang():undefined;
  if(stage==="context")f.hooks.tabGet=id=>id===2?hang():undefined;
  if(stage==="probe")f.hooks.probe=id=>id===2?hang():undefined;
  if(stage==="event")f.hooks.event=(id,message)=>id===2&&message.event==="accountsChanged"?hang():undefined;
  const request=f.request(1);await entered.promise;
  let continued=false;
  const queued=f.queueAuthority(()=>{continued=true;f.local[PROVIDER_PERMISSIONS_KEY]=grantPermission({},ORIGIN,ACCOUNT,3)});
  await Promise.resolve();assert.equal(continued,false);
  const budget=f.expireNotificationBudget();assert.ok(budget>0&&budget<=2000);
  await queued;assert.equal(continued,true);
  assert.deepEqual(await request,{ok:true,result:null});
  const before={events:plain(f.events),injections:plain(f.injections),probes:plain(f.probes)};
  blocked.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual({events:f.events,injections:f.injections,probes:f.probes},before);
  assert.ok(f.local[PROVIDER_PERMISSIONS_KEY][ORIGIN]);
  if(stage==="event")assert.deepEqual(f.events.filter(event=>event.id===2).map(event=>event.event),["accountsChanged"]);
});

test("notification timer is clipped to the original request deadline",{timeout:1000},async t=>{
  const f=fixture(t,{manualTimers:true,deadlineMs:800}),blocked=Promise.withResolvers(),entered=Promise.withResolvers();
  f.hooks.query=()=>{entered.resolve();return blocked.promise};
  const request=f.request(1);await entered.promise;
  const budget=f.expireNotificationBudget();assert.ok(budget>0&&budget<=800);
  await f.queueAuthority(()=>{});assert.deepEqual(await request,{ok:true,result:null});
  blocked.resolve();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.injections,[]);
});

test("real deadline timer releases authority despite a never-settling browser query",{timeout:1500},async t=>{
  const f=fixture(t,{deadlineMs:250}),entered=Promise.withResolvers();
  f.hooks.query=()=>{entered.resolve();return new Promise(()=>{})};
  const request=f.request(1);await entered.promise;
  await f.queueAuthority(()=>{f.local[PROVIDER_PERMISSIONS_KEY]=grantPermission({},ORIGIN,ACCOUNT,3)});
  await request;assert.ok(f.local[PROVIDER_PERMISSIONS_KEY][ORIGIN]);assert.deepEqual(f.injections,[]);
});
