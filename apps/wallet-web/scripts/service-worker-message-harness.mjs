import {pathToFileURL} from "node:url";

const REQUEST_ID="ynx-11111111-1111-4111-8111-111111111111",ORIGIN="http://127.0.0.1:4173";
function apiState(){
  const state={listener:null,scriptingCalls:[],tabCalls:[],storage:{}};
  const api={runtime:{onMessage:{addListener(listener){state.listener=listener}}},permissions:{async getAll(){return{origins:["https://*/*"]}},async remove(){return true}},tabs:{async query(){state.tabCalls.push("query");return[{id:7,url:`${ORIGIN}/`}]} ,async get(id){state.tabCalls.push(["get",id]);return{id,url:`${ORIGIN}/`}},sendMessage:async()=>null},scripting:{async getRegisteredContentScripts(){return[]},async unregisterContentScripts(){},async executeScript(plan){state.scriptingCalls.push({files:plan.files||null,world:plan.world||null,hasFunction:typeof plan.func==="function"});if(plan.func)return[{result:{ynx:false,metamask:false}}];return[]}},storage:{local:{async set(value){Object.assign(state.storage,value)}},session:{async get(key){return{[key]:state.storage[key]}},async set(value){Object.assign(state.storage,value)}}}};
  return{api,state};
}
async function loadWorker(extensionPath,tag){const runtime=apiState();globalThis.chrome=runtime.api;await import(`${pathToFileURL(`${extensionPath}/service-worker.js`).href}?harness=${tag}`);if(typeof runtime.state.listener!=="function")throw new Error("Service worker message listener did not start.");return runtime}
async function send(listener,message,sender={}){return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Service worker response timed out.")),1000);const response=(value)=>{clearTimeout(timer);resolve(value)};try{const pending=listener(message,sender,response);if(pending!==true){clearTimeout(timer);resolve(undefined)}}catch(error){clearTimeout(timer);reject(error)}})}

export async function runServiceWorkerMessageHarness(extensionPath){
  const first=await loadWorker(extensionPath,`${Date.now()}-first`),startupCalls=first.state.scriptingCalls.length;
  const discovery=await send(first.state.listener,{type:"YNX_WALLET_DISCOVER"});
  const injectionCalls=first.state.scriptingCalls.map(call=>({...call}));first.state.scriptingCalls.length=0;
  const sensitive=await send(first.state.listener,{type:"YNX_DAPP_REQUEST_V1",version:1,requestId:REQUEST_ID,origin:ORIGIN,method:"eth_requestAccounts",params:[],deadlineAt:Date.now()+18000},{tab:{id:7,url:`${ORIGIN}/`},url:`${ORIGIN}/`,frameId:0});
  const sensitiveScriptingCalls=first.state.scriptingCalls.length;
  const noTab=await send(first.state.listener,{type:"YNX_DAPP_REQUEST_V1",version:1,requestId:"ynx-22222222-2222-4222-8222-222222222222",origin:ORIGIN,method:"eth_accounts",params:[],deadlineAt:Date.now()+18000},{});
  const policy=await import(pathToFileURL(`${extensionPath}/active-tab-policy.js`).href);const policyFailures={};for(const[name,value]of[["noTab",null],["chromeUrl",{id:7,url:"chrome://extensions"}]]){try{policy.requireActiveDappTab(value);policyFailures[name]={failedClosed:false}}catch(error){policyFailures[name]={failedClosed:true,code:error?.code||null}}}
  const second=await loadWorker(extensionPath,`${Date.now()}-second`),secondStartupCalls=second.state.scriptingCalls.length;
  const injectionOrder=injectionCalls.length>=3&&injectionCalls[0].files?.[0]==="content-script.js"&&injectionCalls[0].world===null&&injectionCalls[1].files?.[0]==="page-provider.js"&&injectionCalls[1].world==="MAIN"&&injectionCalls[2].hasFunction===true;
  const passed=startupCalls===0&&secondStartupCalls===0&&discovery?.ynx===false&&discovery?.metamask===false&&injectionOrder&&sensitive?.ok===false&&sensitive.error?.code==="CANONICAL_AUTH_UNAVAILABLE"&&sensitiveScriptingCalls===0&&noTab?.ok===false&&noTab.error?.code==="INVALID_BRIDGE_REQUEST"&&policyFailures.noTab.code==="ACTIVE_TAB_REQUIRED"&&policyFailures.chromeUrl.code==="ACTIVE_TAB_REQUIRED";
  return{runtimeClass:"direct production service-worker module message harness in Node; not a browser extension runtime",passed,startupCalls,secondStartupCalls,discovery,injectionCalls,injectionOrder,sensitive,sensitiveScriptingCalls,noTab,policyFailures};
}
