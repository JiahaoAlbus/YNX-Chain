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
const legacyWorker=`const EXPECTED="${legacyIndexSha}",CACHE="ynx-wallet-web-v8";
async function sha(response){const value=await crypto.subtle.digest("SHA-256",await response.clone().arrayBuffer());return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>{if(event.request.mode!=="navigate")return;event.respondWith(fetch(event.request,{cache:"no-store"}).then(async response=>response.ok&&await sha(response)===EXPECTED?response:new Response("PWA shell integrity verification failed",{status:503}))) });`;
let phase="legacy";
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url||"/","http://fixture").pathname,path=pathname==="/"?"index.html":pathname.slice(1);
  try{
    const body=phase==="legacy"&&path==="sw.js"?Buffer.from(legacyWorker):await readFile(join(dist,path));
    response.setHeader("cache-control","no-store");
    response.setHeader("content-type",extname(path)===".html"?"text/html":extname(path)===".js"?"text/javascript":extname(path)===".css"?"text/css":"application/octet-stream");
    response.end(body);
  }catch{response.writeHead(404).end()}
});
await bounded(new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveListen)}),3000,"server start");
const url=`http://127.0.0.1:${server.address().port}/`;
const result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),runtimeClass:"Playwright bundled Chromium-compatible persistent profile reproducing the deployed v8 navigation-integrity worker; not a branded browser or installed PWA",legacyIndexSha,passed:false,installedLocal:false,deployedPublic:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false};
let context;
async function close(){if(context)await bounded(context.close(),3000,"browser close").catch(()=>{});context=null}
async function visible(page){return await page.evaluate(async()=>({url:location.href,title:document.title,text:document.body.innerText,controller:Boolean(navigator.serviceWorker.controller),cacheNames:await caches.keys(),recoveryMarker:location.search.includes("ynx-sw-")}))}
async function controlledVersion(page){return await page.evaluate(()=>new Promise(resolve=>{const controller=navigator.serviceWorker.controller;if(!controller){resolve(null);return}const channel=new MessageChannel(),timer=setTimeout(()=>resolve(null),500);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data?.cache||null)};controller.postMessage({type:"YNX_WALLET_PWA_VERSION"},[channel.port2])}))}
try{
  const index=await readFile(join(dist,"index.html"));
  result.builtIndex={bytes:index.length,sha256:createHash("sha256").update(index).digest("hex"),legacyCompatible:createHash("sha256").update(index).digest("hex")===legacyIndexSha};
  if(!result.builtIndex.legacyCompatible)throw new Error("Built bootstrap HTML is not accepted by the deployed v8 worker");
  context=await bounded(chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},timeout:10000}),12000,"first launch");
  let page=context.pages()[0]||await context.newPage();
  await bounded(page.goto(url,{waitUntil:"domcontentloaded",timeout:5000}),6000,"legacy launch");
  await bounded(page.evaluate(()=>navigator.serviceWorker.ready),6000,"legacy worker ready");
  await bounded(page.reload({waitUntil:"domcontentloaded",timeout:5000}),6000,"legacy controlled reload");
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  result.beforeUpgrade=await visible(page);
  phase="current";
  await bounded(page.reload({waitUntil:"domcontentloaded",timeout:5000}),6000,"candidate bootstrap reload");
  await bounded(page.waitForFunction(()=>document.querySelector("#status")&&!document.body.innerText.includes("PWA shell integrity verification failed")&&location.search==="",null,{timeout:10000}),11000,"v11 visible recovery");
  for(let attempt=0;attempt<20&&await controlledVersion(page)!=="ynx-wallet-web-v11";attempt+=1)await page.waitForTimeout(250);
  result.controlledVersion=await controlledVersion(page);
  await bounded(page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes("ynx-wallet-web-v11")},null,{timeout:10000}),11000,"v11 cache activation");
  result.afterUpgrade=await visible(page);
  await close();
  context=await bounded(chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},timeout:10000}),12000,"second launch");
  page=context.pages()[0]||await context.newPage();
  await bounded(page.goto(url,{waitUntil:"domcontentloaded",timeout:5000}),6000,"second launch navigation");
  await page.waitForSelector("#status",{timeout:5000});
  result.secondLaunch=await visible(page);
  result.passed=result.controlledVersion==="ynx-wallet-web-v11"&&[result.beforeUpgrade,result.afterUpgrade,result.secondLaunch].every(value=>value.title==="YNX Wallet — Testnet companion"&&!value.text.includes("PWA shell integrity verification failed"))&&result.afterUpgrade.cacheNames.includes("ynx-wallet-web-v11")&&!result.afterUpgrade.recoveryMarker&&result.secondLaunch.cacheNames.includes("ynx-wallet-web-v11")&&!result.secondLaunch.cacheNames.includes("ynx-wallet-web-v8")&&result.secondLaunch.url===url&&result.secondLaunch.controller;
}catch(error){result.error={name:error?.name||"Error",message:error?.message||String(error)}}finally{await close();server.close();await rm(profile,{recursive:true,force:true}).catch(()=>{})}
await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
