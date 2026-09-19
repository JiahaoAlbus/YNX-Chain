import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createServer} from "node:https";
import {appendFile, mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, extname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {bounded,allSelectedBrowsersPassed} from "./runtime-evidence.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const artifactPath=join(root,"artifacts","ynx-wallet-chrome-edge-0.1.0.zip"),fixtureRoot=join(root,"test","fixtures"),evidenceDir=process.env.YNX_WALLET_WEB_EVIDENCE_DIR?resolve(process.env.YNX_WALLET_WEB_EVIDENCE_DIR):join(root,"evidence","runtime");
const sourceCommit=process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",keepEvidence=process.env.YNX_WALLET_WEB_WRITE_EVIDENCE==="1";
const requestedBrowser=process.env.YNX_BROWSER||"all";
const stageLog=join(evidenceDir,"branded-runtime-stages.ndjson");
const browsers=[
  {id:"chrome",name:"Google Chrome",executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"},
  {id:"edge",name:"Microsoft Edge",executablePath:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"},
];
if(!["all",...browsers.map(({id})=>id)].includes(requestedBrowser))throw new Error("YNX_BROWSER must be chrome, edge, or all");


const fixtureTemp=await mkdtemp(join(tmpdir(),"ynx-branded-https-")),keyPath=join(fixtureTemp,"fixture.key.pem"),certPath=join(fixtureTemp,"fixture.cert.pem");
const artifact=await readFile(artifactPath),loadedArtifactPath=join(fixtureTemp,"extension.zip");await writeFile(loadedArtifactPath,artifact);
const extensionPath=join(fixtureTemp,"extension");await mkdir(extensionPath);execFileSync("unzip",["-q",loadedArtifactPath,"-d",extensionPath]);
const artifactSource=JSON.parse(await readFile(join(extensionPath,"build-identity.json"),"utf8")).sourceCommit;
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyPath,"-out",certPath,"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
const [fixtureKey,fixtureCert]=await Promise.all([readFile(keyPath),readFile(certPath)]);
const server=createServer({key:fixtureKey,cert:fixtureCert},async(request,response)=>{
  const url=new URL(request.url||"/","https://ynx.fixture"),relative=url.pathname==="/"?"dapp-eip6963-frozen.html":url.pathname.slice(1),path=resolve(fixtureRoot,relative);
  if(!path.startsWith(fixtureRoot+"/")){response.writeHead(403).end();return;}
  try{const body=await readFile(path);response.setHeader("content-type",extname(path)===".html"?"text/html":"application/octet-stream");response.end(body)}catch{response.writeHead(404).end()}
});
await new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)});
const address=server.address(),fixtureUrl=`https://127.0.0.1:${address.port}/`;

async function workerFrom(context){
  for(let attempt=0;attempt<20;attempt++){const worker=context.serviceWorkers()[0];if(worker)return worker;await new Promise(resolve=>setTimeout(resolve,250))}
  return bounded(context.waitForEvent("serviceworker",{timeout:3000}),4000,"service worker");
}
async function testBrowser(browser){
  const result={browserId:browser.id,browserName:browser.name,executablePath:browser.executablePath,browserCapability:browser.id==="chrome"?{unpackedAutomation:"manual-required",automationUnsupported:true}:{unpackedAutomation:"supported",automationUnsupported:false},loadMode:"temporary-unpacked-isolated-profile",profileClass:"disposable-isolated-profile",brandedBinary:true,fixtureAuthority:"local HTTPS EIP-6963 DApp with an immutable foreign ethereum.providers array",temporaryUnpackedRuntimeTested:false,installedLocal:false,providerSuccessClaimed:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,downloadHosted:false,productionSigned:false,storeReleased:false};
  const profile=await mkdtemp(join(tmpdir(),`ynx-wallet-${browser.id}-runtime-`));let context;
  result.profilePath=profile;
  const launch=()=>bounded(chromium.launchPersistentContext(profile,{executablePath:browser.executablePath,headless:true,ignoreHTTPSErrors:true,timeout:12000,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]}),15000,`${browser.id} launch`);
  const stage=async(name,detail={})=>{if(keepEvidence){await mkdir(evidenceDir,{recursive:true});await appendFile(stageLog,`${JSON.stringify({at:new Date().toISOString(),browserId:browser.id,stage:name,...detail})}\n`)}};
  try{
    await stage("launch-start");
    context=await launch();
    await stage("launch-complete");
    result.version=context.browser()?.version()||"unknown";
    const worker=await workerFrom(context),extensionOrigin=worker.url().replace(/\/service-worker\.js$/u,"");
    await stage("service-worker",{url:worker.url()});
    result.serviceWorker={started:true,url:worker.url(),extensionOrigin};
    const page=context.pages()[0]||await context.newPage();await bounded(page.goto(fixtureUrl,{waitUntil:"domcontentloaded",timeout:5000}),6000,"fixture navigation");await page.bringToFront();
    await stage("fixture-active",{url:page.url()});
    const activeTab=await worker.evaluate(async()=>{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      return {id:tab?.id,url:tab?.url};
    });
    await stage("active-tab",activeTab);
    try {
      await page.waitForFunction(()=>globalThis.__YNX_EIP6963_FIXTURE__?.announcements?.some(item=>item.info?.rdns==="com.ynx.wallet"),null,{timeout:5000});
      const bridge=await page.evaluate(async()=>{
        const announcements=globalThis.__YNX_EIP6963_FIXTURE__.announcements,matching=announcements.filter(item=>item.info?.rdns==="com.ynx.wallet"),item=matching[0],provider=item?.provider;let chainId=null,chainError=null;
        try{chainId=await provider.request({method:"eth_chainId"})}catch(error){chainError={code:error?.code,message:error?.message}}
        const foreign=globalThis.__YNX_FOREIGN_FIXTURE__;
        return{foreignUnchanged:globalThis.ethereum===foreign.ethereum&&globalThis.ethereum.providers===foreign.providers&&Object.isFrozen(foreign.providers)&&foreign.providers.length===1&&foreign.providers[0]===foreign.provider,announcementCount:announcements.length,matchingCount:matching.length,info:item?.info||null,injected:Boolean(provider),isYNXWallet:provider?.isYNXWallet===true,isMetaMask:provider?.isMetaMask===true,requestType:typeof provider?.request,chainId,chainError};
      });
      result.dappBridge={fixtureUrl,mainWorldInjection:"manifest content script plus origin-bound page bridge",contentScriptRegistered:true,activeTab,tested:true,...bridge};
      result.ynxPriority={passed:bridge.foreignUnchanged&&bridge.matchingCount===1&&bridge.info?.rdns==="com.ynx.wallet"&&bridge.isYNXWallet&&bridge.isMetaMask===false&&bridge.requestType==="function"};
      result.bridgeLifecycle={passed:result.ynxPriority.passed&&bridge.chainId==="0x1917",scope:"real provider discovery and eth_chainId only; accounts, approval, lifecycle, signing, and sending remain false"};
      await stage("content-bridge",bridge);
    } catch(error){result.dappBridge={fixtureUrl,mainWorldInjection:"manifest content script plus origin-bound page bridge",contentScriptRegistered:true,activeTab,tested:false,error:{name:error?.name||"Error",message:error?.message||String(error)}};result.ynxPriority={passed:false};result.bridgeLifecycle={passed:false};await stage("content-bridge-error",result.dappBridge.error)}
    const popup=await context.newPage();await bounded(popup.goto(`${extensionOrigin}/index.html`,{waitUntil:"domcontentloaded",timeout:5000}),6000,"popup navigation");
    await stage("popup-open",{url:popup.url()});
    result.popup={url:popup.url(),opened:true};if(await popup.locator("#theme").count())throw new Error("Obsolete theme switch is present");await popup.getByLabel("Language").selectOption("ar");
    result.rpcFailClosed=await popup.evaluate(async()=>{
      const {YNX_CHAIN,verifyTestnetRpc}=await import(chrome.runtime.getURL("provider.js"));
      try{return {requestedUrl:YNX_CHAIN.rpcUrls[0],requestedChainId:YNX_CHAIN.chainId,proof:await verifyTestnetRpc(),chainChangeSucceeded:true}}
      catch(error){return {requestedUrl:YNX_CHAIN.rpcUrls[0],requestedChainId:YNX_CHAIN.chainId,error:{name:error?.name,code:error?.code,message:error?.message},chainChangeSucceeded:false}}
    });
    await stage("rpc-fail-closed",result.rpcFailClosed);
    const preference=await popup.evaluate(()=>({locale:localStorage.getItem("ynx.wallet.web.locale"),theme:localStorage.getItem("ynx.wallet.web.theme")}));result.firstLaunch={preference};
    await bounded(context.close(),4000,"first context close");context=undefined;
    await stage("first-context-closed");
    context=await launch();
    const worker2=await workerFrom(context),extensionOrigin2=worker2.url().replace(/\/service-worker\.js$/u,"");const popup2=await context.newPage();await popup2.goto(`${extensionOrigin2}/index.html`,{waitUntil:"domcontentloaded"});
    await stage("second-launch",{worker:worker2.url(),popup:popup2.url()});
    const preference2=await popup2.evaluate(()=>({locale:localStorage.getItem("ynx.wallet.web.locale"),theme:localStorage.getItem("ynx.wallet.web.theme"),dir:document.documentElement.dir}));
    result.secondLaunch={serviceWorkerRestarted:true,preference:preference2,persisted:preference2.locale===preference.locale&&preference2.theme===preference.theme};
    const rpcSafe=result.rpcFailClosed?.proof?.chainId==="0x1917"||result.rpcFailClosed?.chainChangeSucceeded===false;
    result.runtimeLifecycleTested=result.serviceWorker.started&&result.secondLaunch.persisted&&rpcSafe;
    result.temporaryUnpackedRuntimeTested=result.runtimeLifecycleTested&&result.ynxPriority.passed&&result.bridgeLifecycle.passed;
  }catch(error){result.error={name:error?.name||"Error",message:error?.message||String(error)};await stage("error",result.error);}
  finally{if(context)await bounded(context.close(),4000,"final context close").catch(()=>{});await rm(profile,{recursive:true,force:true}).catch(()=>{});}
  return result;
}

if(keepEvidence){await mkdir(evidenceDir,{recursive:true});await rm(stageLog,{force:true})}
const results=[];for(const browser of browsers.filter(({id})=>requestedBrowser==="all"||id===requestedBrowser))results.push(await testBrowser(browser));
server.closeIdleConnections?.();server.closeAllConnections?.();await bounded(new Promise(resolveClose=>server.close(resolveClose)),2000,"fixture server close").catch(()=>{});await rm(fixtureTemp,{recursive:true,force:true}).catch(()=>{});
const evidence={schemaVersion:2,sourceCommit,artifactSource,generatedAt:new Date().toISOString(),fixtureAuthority:"isolated test fixture; never production runtime",artifact:{name:"ynx-wallet-chrome-edge-0.1.0.zip",bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex"),signingClass:"unsigned-unpacked-extension"},results,releaseStates:{installedLocal:false,downloadHosted:false,productionSigned:false,storeReleased:false}};
if(keepEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,"branded-temporary-runtime.json"),`${JSON.stringify(evidence,null,2)}\n`)}
console.log(JSON.stringify(evidence,null,2));await new Promise(resolveWrite=>process.stdout.write("",resolveWrite));process.exit(allSelectedBrowsersPassed(results)?0:1);
