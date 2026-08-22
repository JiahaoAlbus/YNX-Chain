import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,extname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),dist=join(root,"dist","pwa");
const evidencePath=join(root,"evidence","runtime","pwa-v8-to-v11-upgrade-20260822.json");
const profile=await mkdtemp(join(tmpdir(),"ynx-pwa-v8-upgrade-"));
const legacyIndexSha="2df10866a35b074a6fb366439197646dd4e979bc83bdae3aba0ba6db3802986c";
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms))]);
let rootNavigations=0;
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url||"/","http://fixture").pathname;
  if(pathname==="/seed-v8.html"){
    response.setHeader("cache-control","no-store");response.setHeader("content-type","text/html");response.end("<!doctype html><title>Seed v8 cache</title><main>Seed only</main>");return;
  }
  const path=pathname==="/"?"index.html":pathname.slice(1);
  if(pathname==="/"&&request.headers["sec-fetch-mode"]==="navigate")rootNavigations+=1;
  try{
    const body=await readFile(join(dist,path));
    response.setHeader("cache-control","no-store");
    response.setHeader("content-type",extname(path)===".html"?"text/html":extname(path)===".js"?"text/javascript":extname(path)===".css"?"text/css":extname(path)===".json"?"application/json":"application/octet-stream");
    response.end(body);
  }catch{response.writeHead(404).end()}
});
await bounded(new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveListen)}),3000,"server start");
const url=`http://127.0.0.1:${server.address().port}/`;
const result={schemaVersion:2,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),runtimeClass:"Playwright bundled Chromium-compatible persistent same-origin profile seeded with a v8 cache and no legacy worker; not branded Chrome/Edge or installed PWA",legacyIndexSha,passed:false,installedLocal:false,deployedPublic:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false};
let context;
async function close(){if(context)await bounded(context.close(),3000,"browser close").catch(()=>{});context=null}
async function visible(page){return await page.evaluate(async()=>({url:location.href,title:document.title,text:document.body.innerText,controller:Boolean(navigator.serviceWorker.controller),cacheNames:await caches.keys(),registrations:(await navigator.serviceWorker.getRegistrations()).map(registration=>({scope:registration.scope,installing:registration.installing?.state||null,waiting:registration.waiting?.state||null,active:registration.active?.state||null})),pwaState:document.documentElement.dataset.pwa||null,recoveryMarker:location.search.includes("ynx-sw-")}))}
async function controlledVersion(page){return await page.evaluate(()=>new Promise(resolve=>{const controller=navigator.serviceWorker.controller;if(!controller){resolve(null);return}const channel=new MessageChannel(),timer=setTimeout(()=>resolve(null),500);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data?.cache||null)};controller.postMessage({type:"YNX_WALLET_PWA_VERSION"},[channel.port2])}))}
async function waitForState(page,predicate,timeout,label){const deadline=Date.now()+timeout;let lastState=null;while(Date.now()<deadline){try{const state=await bounded(visible(page),1000,`${label} state read`);lastState=state;if(predicate(state))return state}catch(error){if(page.isClosed())throw error}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(`${label} timed out after ${timeout}ms; lastState=${JSON.stringify(lastState)}`)}
try{
  const index=await readFile(join(dist,"index.html"));
  result.builtIndex={bytes:index.length,sha256:createHash("sha256").update(index).digest("hex"),legacyCompatible:createHash("sha256").update(index).digest("hex")===legacyIndexSha};
  if(!result.builtIndex.legacyCompatible)throw new Error("Built bootstrap HTML is not accepted by the deployed v8 integrity policy");
  context=await bounded(chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},timeout:10000}),12000,"first launch");
  let page=context.pages()[0]||await context.newPage();
  let firstLaunchNavigations=0,firstLaunchDocumentRequests=0;page.on("framenavigated",frame=>{if(frame===page.mainFrame()&&frame.url().startsWith(url))firstLaunchNavigations+=1});page.on("request",request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame()&&request.url().startsWith(url))firstLaunchDocumentRequests+=1});
  const cdp=await context.newCDPSession(page);result.serviceWorkerEvents=[];
  cdp.on("ServiceWorker.workerErrorReported",event=>result.serviceWorkerEvents.push({type:"error",event}));
  cdp.on("ServiceWorker.workerRegistrationUpdated",event=>result.serviceWorkerEvents.push({type:"registration",event}));
  cdp.on("ServiceWorker.workerVersionUpdated",event=>result.serviceWorkerEvents.push({type:"version",event}));
  await cdp.send("ServiceWorker.enable");
  await bounded(page.goto(`${url}seed-v8.html`,{waitUntil:"domcontentloaded",timeout:5000}),6000,"same-origin seed page");
  await page.evaluate(async()=>{const cache=await caches.open("ynx-wallet-web-v8");await cache.put("./legacy-v8-marker",new Response("seeded-v8"))});
  result.beforeUpgrade=await visible(page);
  result.integrityProbe=await page.evaluate(async base=>{const {ASSET_INTEGRITY}=await import(`${base}asset-integrity.js`),rows=[];for(const [key,expected] of Object.entries(ASSET_INTEGRITY)){const response=await fetch(new URL(key,base),{cache:"no-store"}),actual=await crypto.subtle.digest("SHA-256",await response.arrayBuffer()).then(value=>[...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,"0")).join(""));rows.push({key,status:response.status,expected,actual,match:response.ok&&actual===expected})}return rows},url);
  if(result.integrityProbe.some(row=>!row.match))throw new Error(`integrity probe failed: ${JSON.stringify(result.integrityProbe.filter(row=>!row.match))}`);
  await bounded(page.goto(url,{waitUntil:"domcontentloaded",timeout:5000}),6000,"candidate first navigation");
  await waitForState(page,state=>state.pwaState==="ready"&&state.controller&&state.cacheNames.length===1&&state.cacheNames[0]==="ynx-wallet-web-v11"&&!state.text.includes("PWA shell integrity verification failed"),15000,"v11 product convergence");
  result.controlledVersion=await controlledVersion(page);
  result.afterUpgrade=await visible(page);
  result.firstLaunchRootNavigations=rootNavigations;
  result.firstLaunchNavigations=firstLaunchNavigations;
  result.firstLaunchDocumentRequests=firstLaunchDocumentRequests;
  await close();
  context=await bounded(chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},timeout:10000}),12000,"second launch");
  page=context.pages()[0]||await context.newPage();
  await bounded(page.goto(url,{waitUntil:"domcontentloaded",timeout:5000}),6000,"second launch navigation");
  await waitForState(page,state=>state.pwaState==="ready"&&state.controller&&state.cacheNames.length===1&&state.cacheNames[0]==="ynx-wallet-web-v11",10000,"second launch v11 control");
  result.secondLaunch=await visible(page);
  result.secondControlledVersion=await controlledVersion(page);
  result.passed=result.controlledVersion==="ynx-wallet-web-v11"&&result.secondControlledVersion==="ynx-wallet-web-v11"&&result.firstLaunchDocumentRequests===3&&!result.beforeUpgrade.controller&&result.beforeUpgrade.cacheNames.includes("ynx-wallet-web-v8")&&[result.afterUpgrade,result.secondLaunch].every(value=>value.title==="YNX Wallet — Testnet companion"&&value.controller&&value.pwaState==="ready"&&value.cacheNames.length===1&&value.cacheNames[0]==="ynx-wallet-web-v11"&&!value.recoveryMarker&&!value.text.includes("PWA shell integrity verification failed"));
}catch(error){result.error={name:error?.name||"Error",message:error?.message||String(error)}}finally{await close();server.close();await rm(profile,{recursive:true,force:true}).catch(()=>{})}
await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
