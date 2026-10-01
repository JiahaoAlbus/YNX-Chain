import {loadPreferences,savePreferences} from "../src/preferences.js";
import {extensionFlowCopy} from "../src/i18n.js";
import {HOSTED_LOCALES,hostedCopy,normalizeHostedLocale} from "../src/hosted-i18n.js";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import {isProviderInternalRequestId,providerContextLabel} from "../src/extension-provider-permissions.js";
import {toYNXAddress} from "../src/wallet-address.js";
import {extensionReviewText} from "../src/extension-signer.js";
const INTERNAL=`ynx-scope-v2-${"a".repeat(64)}`,EXTERNAL="ynx-aaaaaaaa-1111-4111-8111-111111111111",ACCOUNT="0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
for(const page of["approval","signer"])test(`${page} actual renderer routes the full internal locator and rejects an external wire UUID`,async t=>{
  const html=await readFile(new URL(`../extension/${page}.html`,import.meta.url),"utf8"),source=(await readFile(new URL(`../extension/${page}.js`,import.meta.url),"utf8")).replace(/^import .*;\n/gm,"");
  for(const id of[INTERNAL,EXTERNAL]){
    // Nodes come from the real HTML; browser runtime and event delivery are simulated.
    const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/gu)].map(([,key])=>[key,{textContent:"",value:"",disabled:true,style:{},handlers:{},addEventListener(event,fn){this.handlers[event]=fn},click(){if(!this.disabled)this.handlers.click?.()}}]));
    const calls=[],timers=new Set(),events={};let closed=false;
    const context=vm.createContext({loadPreferences,extensionFlowCopy,hostedCopy,normalizeHostedLocale,isProviderInternalRequestId,providerContextLabel,toYNXAddress,extensionReviewText,URLSearchParams,Date,location:{search:`?requestId=${id}`},document:{querySelector:selector=>nodes.get(selector.slice(1))},window:{close:()=>{closed=true}},addEventListener:(event,fn)=>events[event]=fn,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);return timer},clearTimeout:timer=>{clearTimeout(timer);timers.delete(timer)},chrome:{runtime:{sendMessage:async message=>{calls.push(message);return{ok:true,request:{requestId:id,origin:"https://dapp.example",account:ACCOUNT,method:"personal_sign",summary:"Public synthetic message",browserContext:"firefox-container-1",deadlineAt:Date.now()+5000}}}}}});
    t.after(()=>{for(const timer of timers)clearTimeout(timer)});vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));
    if(id===EXTERNAL){assert.equal(calls.length,0);if(page==="approval")assert.equal(nodes.get("error-code").textContent,"INVALID_APPROVAL_REQUEST");else assert.match(nodes.get("status").textContent,/INVALID_SIGNER_REQUEST/u);assert.equal(nodes.get("approve").disabled,true);continue}
    assert.equal(calls[0].requestId,INTERNAL);assert.equal(nodes.get("browser-context").textContent,"Firefox container · firefox-container-1");assert.equal(nodes.get("approve").disabled,false);
    const password=nodes.get("password");if(password)password.value="public-fixture-password-only";nodes.get("approve").click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls[1].requestId,INTERNAL);assert.equal(closed,true);if(password)assert.equal(password.value,"");events.pagehide?.();
  }
});


test("actual setup and site review reuse complete localized Hosted copy",async()=>{
 for(const page of["vault","approval"]){const html=await readFile(new URL(`../extension/${page}.html`,import.meta.url),"utf8");const keys=[...html.matchAll(/data-hosted-i18n="([^"]+)"/gu)].map(x=>x[1]);assert.ok(keys.length>=2);const flowKeys=[...html.matchAll(/data-extension-i18n="([^"]+)"/gu)].map(x=>x[1]);assert.ok(flowKeys.length>=5);for(const[locale]of HOSTED_LOCALES)for(const key of flowKeys)assert.ok(extensionFlowCopy(locale,key).trim(),locale+":"+key);for(const[locale]of HOSTED_LOCALES)for(const key of keys)assert.ok(hostedCopy(locale,key).trim(),locale+":"+key);}
});

 test("actual approval respects selected Wallet language over browser locale and keeps failure code secondary",async()=>{
 const html=await readFile(new URL("../extension/approval.html",import.meta.url),"utf8"),source=(await readFile(new URL("../extension/approval.js",import.meta.url),"utf8")).replace(/^import .*;\n/gm,"");
 const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/gu)].map(([,id])=>[id,{textContent:"",disabled:true,hidden:true,handlers:{},addEventListener(event,fn){this.handlers[event]=fn}}]));
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};savePreferences(storage,null,{locale:"zh-CN",theme:"system"});
 const doc={documentElement:{},querySelector:s=>nodes.get(s.slice(1)),querySelectorAll:()=>[]};
 const context=vm.createContext({loadPreferences,extensionFlowCopy,hostedCopy,normalizeHostedLocale,isProviderInternalRequestId,providerContextLabel,toYNXAddress,URLSearchParams,Date,localStorage:storage,navigator:{language:"en-US"},location:{search:`?requestId=${INTERNAL}`},document:doc,window:{close(){}},chrome:{runtime:{sendMessage:async input=>input.type==="YNX_PROVIDER_APPROVAL_GET_V1"?{ok:true,request:{origin:"https://dapp.example",account:ACCOUNT,browserContext:"chromium-default"}}:{ok:false,error:{code:"PROVIDER_CONTEXT_CHANGED"}}}}});
 vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));assert.equal(doc.documentElement.lang,"zh-CN");assert.equal(nodes.get("status").textContent,extensionFlowCopy("zh-CN","ready"));nodes.get("approve").handlers.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(nodes.get("status").textContent,extensionFlowCopy("zh-CN","failed"));assert.equal(nodes.get("error-code").textContent,"PROVIDER_CONTEXT_CHANGED");assert.equal(nodes.get("error-details").hidden,false);assert.equal(nodes.get("approve").disabled,true);
 });
