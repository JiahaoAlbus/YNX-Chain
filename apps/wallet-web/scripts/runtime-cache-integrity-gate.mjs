import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createServer} from "node:http";
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,extname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),repository=resolve(root,"..",".."),dist=join(root,"dist","pwa"),legacyCommit="4152af9061b77a619a8f09522dc150c6a6b8d622",legacyArtifact=`${legacyCommit}:apps/wallet-web/artifacts/ynx-wallet-web-pwa-0.1.0.zip`,temp=await mkdtemp(join(tmpdir(),"ynx-pwa-v6-to-v7-")),legacyZip=join(temp,"legacy-v6.zip"),legacyDist=join(temp,"legacy-v6"),profile=join(temp,"profile"),evidencePath=join(root,"evidence","runtime","pwa-v6-to-v7-upgrade-20260821.json"),screenshotPath=join(root,"evidence","browser","pwa-v6-to-v7-upgrade-20260821.png");
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`${label} timed out after ${ms}ms`),{code:"GATE_TIMEOUT"})),ms))]);
const contentType=(path)=>({".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".webmanifest":"application/manifest+json",".png":"image/png"}[extname(path)]||"application/octet-stream");
await writeFile(legacyZip,execFileSync("git",["show",legacyArtifact],{cwd:repository,maxBuffer:2_000_000}));
execFileSync("unzip",["-q",legacyZip,"-d",legacyDist]);
let generation="v6";
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url||"/","http://fixture").pathname;
  const base=generation==="v6"?legacyDist:dist,path=resolve(base,pathname==="/"?"index.html":pathname.slice(1));
  if(!path.startsWith(base)){response.writeHead(403).end();return}
  try {
    const body=await readFile(path),name=path.slice(base.length+1);
    response.writeHead(200,{"content-type":contentType(path),"cache-control":["sw.js","asset-integrity.js","service-worker-policy.js"].includes(name)?"no-store, max-age=0":"no-store"});
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await bounded(new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveListen)}),3000,"server start");
const url=`http://127.0.0.1:${server.address().port}/`,result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",legacy:{sourceCommit:legacyCommit,artifact:null,actualWorker:false,cacheName:"ynx-wallet-web-v6"},upgrade:{targetCacheName:"ynx-wallet-web-v7",scriptAndIntegrityNoStore:true,atomicStaging:true,oldCacheRemoved:false,integrityFailure:false,englishVisibleTextNoCjk:false,noFabricatedSession:false,actionsDisabled:false},generatedAt:new Date().toISOString(),runtimeClass:"Playwright bundled Chromium-compatible persistent browser with a real legacy v6 PWA artifact and mutable local static origin; not public/installed PWA evidence",passed:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,installedLocal:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false};
let context;
const workerDiagnostics=[];
async function close(){if(context)await bounded(context.close(),3000,"browser close").catch(()=>{});context=null}
try {
  const legacyBytes=await readFile(legacyZip); result.legacy.artifact={name:"ynx-wallet-web-pwa-0.1.0.zip",bytes:legacyBytes.length,sha256:createHash("sha256").update(legacyBytes).digest("hex")};
  context=await bounded(chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},timeout:10000}),12000,"Chromium-compatible launch");
  context.on("serviceworker",(worker)=>{
    workerDiagnostics.push({event:"created",url:worker.url()});
    worker.on("console",(message)=>workerDiagnostics.push({event:"console",type:message.type(),text:message.text()}));
    worker.on("close",()=>workerDiagnostics.push({event:"closed",url:worker.url()}));
  });
  await context.route("https://rpc.ynxweb4.com/evm",route=>route.abort("connectionfailed"));
  const page=context.pages()[0]||await context.newPage();
  await bounded(page.goto(url,{waitUntil:"domcontentloaded",timeout:5000}),6000,"legacy PWA launch");
  await page.evaluate(async()=>navigator.serviceWorker.ready);
  if(!await page.evaluate(()=>Boolean(navigator.serviceWorker.controller))) { await page.reload({waitUntil:"domcontentloaded"}); await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller)); }
  result.legacy.initial=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL||null,caches:await caches.keys(),session:localStorage.getItem("ynx.wallet.web.session.v1"),signDisabled:document.querySelector("#sign")?.disabled,sendDisabled:document.querySelector("#send")?.disabled}));
  result.legacy.actualWorker=result.legacy.initial.controller?.endsWith("/sw.js")===true&&result.legacy.initial.caches.includes(result.legacy.cacheName);
  generation="v7";
  const recoveryRedirect=page.waitForURL(/pwa-recovered=7/u,{timeout:8000});
  await bounded(page.goto(new URL("pwa-upgrade.html",url).href,{waitUntil:"domcontentloaded",timeout:5000}),6000,"legacy recovery bootstrap");
  await bounded(recoveryRedirect,9000,"v7 recovery redirect");
  await page.waitForLoadState("domcontentloaded");
  await new Promise(resolveWait=>setTimeout(resolveWait,500));
  result.upgrade.afterRecoveryNavigation=await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();return {url:location.href,body:document.body.innerText,active:registration?.active?.scriptURL||null,waiting:registration?.waiting?.scriptURL||null,installing:registration?.installing?.scriptURL||null};});
  let upgraded=false;
  for(let attempt=0;attempt<40;attempt+=1){
    const names=await page.evaluate(()=>caches.keys());
    if(names.includes("ynx-wallet-web-v7")&&!names.some(name=>name.startsWith("ynx-wallet-web-v")&&name!=="ynx-wallet-web-v7")){upgraded=true;break;}
    await new Promise(resolveWait=>setTimeout(resolveWait,250));
  }
  if(!upgraded) {
    result.upgrade.activationDiagnostic=await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();return {caches:await caches.keys(),active:registration?.active?.scriptURL||null,waiting:registration?.waiting?.scriptURL||null,installing:registration?.installing?.scriptURL||null};});
    result.upgrade.workerDiagnostics=workerDiagnostics;
    throw Object.assign(new Error("v7 activation and cache purge did not complete"),{code:"UPGRADE_INCOMPLETE"});
  }
  if(!await page.evaluate(()=>Boolean(navigator.serviceWorker.controller))) { await page.reload({waitUntil:"domcontentloaded"}); await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller)); }
  await page.waitForFunction(()=>/RPC_UNAVAILABLE/.test(document.querySelector("#status")?.textContent||""));
  const visibleCjk=await page.locator("body *").evaluateAll((nodes)=>nodes.flatMap((node)=>{
    if(node.tagName==="OPTION"||node.children.length!==0||getComputedStyle(node).display==="none"||getComputedStyle(node).visibility==="hidden")return [];
    const value=(node.textContent||"").trim();return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value)?[value]:[];
  }));
  await mkdir(dirname(screenshotPath),{recursive:true}); await page.screenshot({path:screenshotPath,fullPage:true});
  const screenshot=await readFile(screenshotPath),info=await stat(screenshotPath);
  result.upgrade.after=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL||null,caches:await caches.keys(),status:document.querySelector("#status")?.textContent||null,body:document.body.innerText,session:localStorage.getItem("ynx.wallet.web.session.v1"),signDisabled:document.querySelector("#sign")?.disabled,sendDisabled:document.querySelector("#send")?.disabled}));
  result.upgrade.oldCacheRemoved=!result.upgrade.after.caches.some(name=>name.startsWith("ynx-wallet-web-v")&&name!=="ynx-wallet-web-v7");
  result.upgrade.integrityFailure=!/PWA shell integrity verification failed|PWA asset integrity verification failed/u.test(result.upgrade.after.body);
  result.upgrade.englishVisibleTextNoCjk=visibleCjk.length===0;
  result.upgrade.visibleCjkNodes=visibleCjk;
  result.upgrade.noFabricatedSession=result.upgrade.after.session===null;
  result.upgrade.actionsDisabled=result.upgrade.after.signDisabled===true&&result.upgrade.after.sendDisabled===true;
  result.upgrade.screenshot={path:"evidence/browser/pwa-v6-to-v7-upgrade-20260821.png",bytes:info.size,sha256:createHash("sha256").update(screenshot).digest("hex")};
  result.passed=result.legacy.actualWorker&&result.legacy.initial.session===null&&result.legacy.initial.signDisabled===true&&result.legacy.initial.sendDisabled===true&&result.upgrade.oldCacheRemoved&&result.upgrade.integrityFailure&&result.upgrade.englishVisibleTextNoCjk&&result.upgrade.noFabricatedSession&&result.upgrade.actionsDisabled&&/^Status: RPC_UNAVAILABLE: The request failed closed\. No wallet state was changed\.$/u.test(result.upgrade.after.status||"");
} catch(error) { result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)}; }
finally { await close(); server.close(); await rm(temp,{recursive:true,force:true}).catch(()=>{}); }
const artifact=await readFile(join(root,"artifacts","ynx-wallet-web-pwa-0.1.0.zip"));result.artifact={name:"ynx-wallet-web-pwa-0.1.0.zip",bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex"),minimumOS:"modern browser with Service Worker and Web Crypto support",signingClass:"unsigned-web-bundle"};
await mkdir(dirname(evidencePath),{recursive:true}); await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`); console.log(JSON.stringify(result,null,2)); process.exit(result.passed?0:1);
