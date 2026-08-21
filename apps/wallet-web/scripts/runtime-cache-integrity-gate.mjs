import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,extname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {PWA_CACHE, PWA_CACHE_PREFIX} from "../src/service-worker-policy.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),dist=join(root,"dist","pwa"),evidencePath=join(root,"evidence","runtime","pwa-cache-integrity-lifecycle-20260814.json"),profile=await mkdtemp(join(tmpdir(),"ynx-pwa-cache-integrity-")),fixture=await mkdtemp(join(tmpdir(),"ynx-pwa-legacy-v7-")),legacy=join(fixture,"v7");
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`${label} timed out after ${ms}ms`),{code:"GATE_TIMEOUT"})),ms))]);
await cp(dist,legacy,{recursive:true});
const legacyPolicy=join(legacy,"service-worker-policy.js"),legacyIntegrity=join(legacy,"asset-integrity.js");
await writeFile(legacyPolicy,(await readFile(legacyPolicy,"utf8")).replace(/PWA_CACHE = `\$\{PWA_CACHE_PREFIX\}8`/u,"PWA_CACHE = `${PWA_CACHE_PREFIX}7`"));
const legacyWorker=join(legacy,"sw.js");
await writeFile(legacyWorker,(await readFile(legacyWorker,"utf8")).replace("pwa-shell-v8","pwa-shell-v7"));
const legacyMap=JSON.parse((await readFile(legacyIntegrity,"utf8")).match(/^export const ASSET_INTEGRITY=Object\.freeze\((\{.*\})\);\n$/u)?.[1]||"null");
for(const key of Object.keys(legacyMap)){const file=key==="./"?"index.html":key.slice(2);legacyMap[key]=createHash("sha256").update(await readFile(join(legacy,file))).digest("hex")}
await writeFile(legacyIntegrity,`export const ASSET_INTEGRITY=Object.freeze(${JSON.stringify(legacyMap)});\n`);
let servedRoot=legacy;
const server=createServer(async(request,response)=>{const pathname=new URL(request.url||"/","http://fixture").pathname,path=resolve(servedRoot,pathname==="/"?"index.html":pathname.slice(1));if(!path.startsWith(servedRoot)){response.writeHead(403).end();return}try{const body=await readFile(path);response.setHeader("cache-control","no-store");response.setHeader("content-type",extname(path)===".html"?"text/html":extname(path)===".js"?"text/javascript":extname(path)===".css"?"text/css":"application/octet-stream");response.end(body)}catch{response.writeHead(404).end()}});
await bounded(new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveListen)}),3000,"server start");
const url=`http://127.0.0.1:${server.address().port}/`,result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),runtimeClass:"Playwright bundled Chromium-compatible persistent PWA profile; not branded Chrome/Edge and not an installed PWA",passed:false,liveRpcProved:false,secondLaunchLiveRpcProved:false,rpcRecoveryProved:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,installedLocal:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false};
let context;
async function close(){if(context)await bounded(context.close(),3000,"browser close").catch(()=>{});context=null}
try{
  context=await bounded(chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},timeout:10000}),12000,"Chromium-compatible launch");let page=context.pages()[0]||await context.newPage();await bounded(page.goto(url,{waitUntil:"domcontentloaded",timeout:5000}),6000,"legacy PWA launch");await page.evaluate(async()=>navigator.serviceWorker.ready);if(!await page.evaluate(()=>Boolean(navigator.serviceWorker.controller))){await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))}
  result.legacyClient=await page.evaluate(async()=>({controlled:Boolean(navigator.serviceWorker.controller),cacheNames:await caches.keys(),statusText:document.querySelector("#status")?.textContent}));
  servedRoot=dist;
  result.updateProbe=await page.evaluate(async()=>({worker:await fetch("./sw.js",{cache:"reload"}).then(response=>response.text()).then(body=>body.includes("pwa-shell-v8")),policy:await fetch("./service-worker-policy.js",{cache:"reload"}).then(response=>response.text()).then(body=>body.includes("PWA_CACHE_PREFIX}8"))}));
  await page.waitForTimeout(300);
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration?.update()});
  await page.waitForTimeout(1000);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForTimeout(600);
  result.liveRpc=await bounded(page.evaluate(async()=>{const {verifyTestnetRpc}=await import("./provider.js");try{return{proved:true,proof:await verifyTestnetRpc()}}catch(error){return{proved:false,error:{code:error?.code||null,message:error?.message||String(error)}}}}),8000,"live RPC probe");result.liveRpcProved=result.liveRpc.proved===true&&result.liveRpc.proof?.chainId==="0x1917";
  result.initial=await page.evaluate(async()=>({controlled:Boolean(navigator.serviceWorker.controller),cacheNames:await caches.keys(),statusText:document.querySelector("#status")?.textContent,session:localStorage.getItem("ynx.wallet.web.session.v1"),signDisabled:document.querySelector("#sign")?.disabled,sendDisabled:document.querySelector("#send")?.disabled}));
  // Corrupt the active cache, not merely an obsolete name.  This proves the
  // controlled Worker deletes a failed digest and cannot revive the stale app.
  await page.evaluate(async(currentCache)=>{const cache=await caches.open(currentCache);await cache.put("./app.js",new Response("globalThis.__YNX_TAMPERED__=true",{status:200,headers:{"content-type":"text/javascript"}}))},PWA_CACHE);await context.setOffline(true);
  result.tamper=await page.evaluate(async()=>{const response=await fetch("./app.js?tamper=1");return{status:response.status,body:await response.text(),tamperedExecuted:globalThis.__YNX_TAMPERED__===true,session:localStorage.getItem("ynx.wallet.web.session.v1"),signDisabled:document.querySelector("#sign")?.disabled,sendDisabled:document.querySelector("#send")?.disabled}});
  // v7 is the exact production schema that could keep a historic app bundle
  // alive.  The v8 Worker must delete it before it can answer a request.
  const legacyCache=`${PWA_CACHE_PREFIX}7`;
  result.rollback=await page.evaluate(async({currentCache,legacyCache})=>{const legacy=await caches.open(legacyCache),current=await caches.open(currentCache);await legacy.put("./index.html",new Response("ROLLBACK_FAKE_CONNECTED",{status:200,headers:{"content-type":"text/html"}}));await current.delete("./index.html");const response=await fetch("./?rollback=1");for(let index=0;index<20&&(await caches.keys()).includes(legacyCache);index+=1)await new Promise(resolve=>setTimeout(resolve,50));return{status:response.status,body:await response.text(),legacyPresent:(await caches.keys()).includes(legacyCache),session:localStorage.getItem("ynx.wallet.web.session.v1")}}, {currentCache:PWA_CACHE,legacyCache});
  await context.setOffline(false);result.recovery=await page.evaluate(async()=>{const app=await fetch("./app.js?recovery=1"),index=await fetch("./?recovery=1");return{appStatus:app.status,indexStatus:index.status,appSha256:await crypto.subtle.digest("SHA-256",await app.arrayBuffer()).then(value=>[...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("")),indexContainsFake:(await index.text()).includes("ROLLBACK_FAKE_CONNECTED"),cacheNames:await caches.keys(),session:localStorage.getItem("ynx.wallet.web.session.v1")}});
  const expectedApp=createHash("sha256").update(await readFile(join(dist,"app.js"))).digest("hex");result.passed=result.legacyClient.controlled&&result.legacyClient.cacheNames.includes("ynx-wallet-web-v7")&&result.initial.controlled&&result.initial.cacheNames.includes(PWA_CACHE)&&!result.initial.cacheNames.includes("ynx-wallet-web-v7")&&!result.initial.session&&result.initial.signDisabled&&result.initial.sendDisabled&&result.tamper.status===503&&!result.tamper.body.includes("__YNX_TAMPERED__")&&!result.tamper.tamperedExecuted&&!result.tamper.session&&result.tamper.signDisabled&&result.tamper.sendDisabled&&result.rollback.status===503&&!result.rollback.body.includes("ROLLBACK_FAKE_CONNECTED")&&!result.rollback.legacyPresent&&!result.rollback.session&&result.recovery.appStatus===200&&result.recovery.indexStatus===200&&result.recovery.appSha256===expectedApp&&!result.recovery.indexContainsFake&&!result.recovery.session;
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)}}finally{await close();server.close();await rm(profile,{recursive:true,force:true}).catch(()=>{});await rm(fixture,{recursive:true,force:true}).catch(()=>{})}
const artifact=await readFile(join(root,"artifacts","ynx-wallet-web-pwa-0.1.0.zip"));result.artifact={name:"ynx-wallet-web-pwa-0.1.0.zip",bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex"),minimumOS:"modern browser with Service Worker and Web Crypto support",signingClass:"unsigned-web-bundle"};await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
