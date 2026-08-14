import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {appendFile, mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, extname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const extensionPath=join(root,"dist","chromium"),fixtureRoot=join(root,"test","fixtures"),evidenceDir=join(root,"evidence","runtime");
const sourceCommit=process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",keepEvidence=process.env.YNX_WALLET_WEB_WRITE_EVIDENCE==="1";
const stageLog=join(evidenceDir,"branded-runtime-stages.ndjson");
const browsers=[
  {id:"chrome",name:"Google Chrome",executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"},
  {id:"edge",name:"Microsoft Edge",executablePath:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"},
];

const server=createServer(async(request,response)=>{
  const url=new URL(request.url||"/","https://ynx.fixture"),relative=url.pathname==="/"?"dapp.html":url.pathname.slice(1),path=resolve(fixtureRoot,relative);
  if(!path.startsWith(fixtureRoot)){response.writeHead(403).end();return;}
  try{const body=await readFile(path);response.setHeader("content-type",extname(path)===".html"?"text/html":"application/octet-stream");response.end(body)}catch{response.writeHead(404).end()}
});
await new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)});
const address=server.address(),fixtureUrl=`http://127.0.0.1:${address.port}/`;

async function workerFrom(context){
  for(let attempt=0;attempt<20;attempt++){const worker=context.serviceWorkers()[0];if(worker)return worker;await new Promise(resolve=>setTimeout(resolve,250))}
  return context.waitForEvent("serviceworker",{timeout:5000});
}
async function testBrowser(browser){
  const result={browserId:browser.id,browserName:browser.name,executablePath:browser.executablePath,loadMode:"temporary-unpacked-isolated-profile",brandedBinary:true,temporaryUnpackedRuntimeTested:false,installedLocal:false,downloadHosted:false,productionSigned:false,storeReleased:false};
  const profile=await mkdtemp(join(tmpdir(),`ynx-wallet-${browser.id}-runtime-`));let context;
  const stage=async(name,detail={})=>{if(keepEvidence){await mkdir(evidenceDir,{recursive:true});await appendFile(stageLog,`${JSON.stringify({at:new Date().toISOString(),browserId:browser.id,stage:name,...detail})}\n`)}};
  try{
    await stage("launch-start");
    context=await chromium.launchPersistentContext(profile,{executablePath:browser.executablePath,headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
    await stage("launch-complete");
    result.version=context.browser()?.version()||"unknown";
    const worker=await workerFrom(context),extensionOrigin=worker.url().replace(/\/service-worker\.js$/u,"");
    await stage("service-worker",{url:worker.url()});
    result.serviceWorker={started:true,url:worker.url(),extensionOrigin};
    const page=context.pages()[0]||await context.newPage();await page.goto(fixtureUrl,{waitUntil:"domcontentloaded"});await page.bringToFront();
    await stage("fixture-active",{url:page.url()});
    await worker.evaluate(async()=>{await chrome.action.openPopup().catch(()=>{});});
    await stage("action-invoked");
    const activeTab=await worker.evaluate(async()=>{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      return {id:tab?.id,url:tab?.url};
    });
    await stage("active-tab",activeTab);
    try {
      const discovered=await worker.evaluate(async()=>{
        const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
        const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:globalThis.__YNX_INTERNAL_PAGE_WALLET_REQUEST__,args:["any",{method:"ynx_walletDetected"}]});
        return execution?.result;
      });
      await stage("provider-discovery",{discovered});
      const response=await worker.evaluate(async()=>{
        const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
        const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:globalThis.__YNX_INTERNAL_PAGE_WALLET_REQUEST__,args:["ynx",{method:"eth_requestAccounts"}]});
        return {ok:true,result:await execution?.result};
      });
      const calls=await page.evaluate(()=>globalThis.__YNX_FIXTURE_CALLS__);
      result.dappBridge={fixtureUrl,mainWorldInjection:"production pageWalletRequest via chrome.scripting.executeScript world MAIN",contentScriptRegistered:false,activeTab,discovered,tested:true};
      result.ynxPriority={response,calls,passed:response?.ok===true&&response.result?.[0]==="0x1111111111111111111111111111111111111111"&&calls.at(-1)?.provider==="ynx"};
      await stage("provider-request",{response,calls});
    } catch (error) {
      result.dappBridge={fixtureUrl,mainWorldInjection:"production pageWalletRequest via chrome.scripting.executeScript world MAIN",contentScriptRegistered:false,activeTab,tested:false,error:{name:error?.name||"Error",message:error?.message||String(error)},reason:"Programmatic action.openPopup does not grant the user-gesture activeTab permission."};
      result.ynxPriority={passed:false,reason:"MAIN-world injection was denied before provider selection."};
      await stage("provider-injection-denied",result.dappBridge.error);
    }
    const popup=await context.newPage();await popup.goto(`${extensionOrigin}/index.html`,{waitUntil:"domcontentloaded"});
    await stage("popup-open",{url:popup.url()});
    result.popup={url:popup.url(),opened:true};await popup.locator("#theme").click();await popup.getByLabel("Language").selectOption("ar");
    result.rpcFailClosed=await popup.evaluate(async()=>{
      const {YNX_CHAIN,verifyTestnetRpc}=await import(chrome.runtime.getURL("provider.js"));
      try{return {requestedUrl:YNX_CHAIN.rpcUrls[0],requestedChainId:YNX_CHAIN.chainId,proof:await verifyTestnetRpc(),chainChangeSucceeded:true}}
      catch(error){return {requestedUrl:YNX_CHAIN.rpcUrls[0],requestedChainId:YNX_CHAIN.chainId,error:{name:error?.name,code:error?.code,message:error?.message},chainChangeSucceeded:false}}
    });
    await stage("rpc-fail-closed",result.rpcFailClosed);
    const preference=await popup.evaluate(()=>({locale:localStorage.getItem("ynx.wallet.web.locale"),theme:localStorage.getItem("ynx.wallet.web.theme")}));result.firstLaunch={preference};
    await context.close();context=undefined;
    await stage("first-context-closed");
    context=await chromium.launchPersistentContext(profile,{executablePath:browser.executablePath,headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
    const worker2=await workerFrom(context),extensionOrigin2=worker2.url().replace(/\/service-worker\.js$/u,"");const popup2=await context.newPage();await popup2.goto(`${extensionOrigin2}/index.html`,{waitUntil:"domcontentloaded"});
    await stage("second-launch",{worker:worker2.url(),popup:popup2.url()});
    const preference2=await popup2.evaluate(()=>({locale:localStorage.getItem("ynx.wallet.web.locale"),theme:localStorage.getItem("ynx.wallet.web.theme"),dir:document.documentElement.dir}));
    result.secondLaunch={serviceWorkerRestarted:true,preference:preference2,persisted:preference2.locale===preference.locale&&preference2.theme===preference.theme};
    result.runtimeLifecycleTested=result.serviceWorker.started&&result.secondLaunch.persisted&&!result.rpcFailClosed.chainChangeSucceeded;
    result.temporaryUnpackedRuntimeTested=result.runtimeLifecycleTested&&result.ynxPriority.passed;
  }catch(error){result.error={name:error?.name||"Error",message:error?.message||String(error)};await stage("error",result.error);}
  finally{if(context)await context.close().catch(()=>{});await rm(profile,{recursive:true,force:true}).catch(()=>{});}
  return result;
}

if(keepEvidence){await mkdir(evidenceDir,{recursive:true});await rm(stageLog,{force:true})}
const results=[];for(const browser of browsers)results.push(await testBrowser(browser));server.close();
const artifact=await readFile(join(root,"artifacts","ynx-wallet-chrome-edge-0.1.0.zip"));
const evidence={schemaVersion:1,sourceCommit,generatedAt:new Date().toISOString(),fixtureAuthority:"isolated test fixture; never production runtime",artifact:{name:"ynx-wallet-chrome-edge-0.1.0.zip",bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex"),signingClass:"unsigned-unpacked-extension"},results,releaseStates:{installedLocal:false,downloadHosted:false,productionSigned:false,storeReleased:false}};
if(keepEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,"branded-temporary-runtime.json"),`${JSON.stringify(evidence,null,2)}\n`)}
console.log(JSON.stringify(evidence,null,2));if(!results.some(result=>result.runtimeLifecycleTested))process.exitCode=1;
