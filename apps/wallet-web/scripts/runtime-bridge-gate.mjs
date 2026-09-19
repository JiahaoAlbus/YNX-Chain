import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createServer} from "node:https";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),extensionPath=join(root,"dist","chromium"),fixturePath=join(root,"test","fixtures","dapp-eip6963.html"),evidenceDir=join(root,"evidence","runtime");
const browserId=process.env.YNX_BROWSER||"edge",gate=process.env.YNX_GATE||"injection",writeEvidence=process.env.YNX_WALLET_WEB_WRITE_EVIDENCE==="1";
const browsers={chrome:{name:"Google Chrome",path:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",automationCapability:"manual-required",reason:"Branded Chrome rejects command-line unpacked-extension automation in this environment; use Chrome for Testing for automated coverage and a real toolbar action for branded acceptance."},edge:{name:"Microsoft Edge",path:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",automationCapability:"supported"},chromium:{name:"Chrome for Testing",path:chromium.executablePath(),automationCapability:"supported"}};
if(!browsers[browserId]||!["injection","chain-id","rpc"].includes(gate))throw new Error("YNX_BROWSER must be edge, chrome, or chromium and YNX_GATE must be injection, chain-id, or rpc");
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`${label} timed out after ${ms}ms`),{code:"GATE_TIMEOUT"})),ms))]);
const sha256=value=>createHash("sha256").update(value).digest("hex");
const temp=await mkdtemp(join(tmpdir(),`ynx-${browserId}-${gate}-`)),profile=join(temp,"profile"),keyPath=join(temp,"fixture.key.pem"),certPath=join(temp,"fixture.cert.pem");
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyPath,"-out",certPath,"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
const [fixture,key,cert,pageProvider,manifest]=await Promise.all([readFile(fixturePath),readFile(keyPath),readFile(certPath),readFile(join(extensionPath,"page-provider.js")),readFile(join(extensionPath,"manifest.json"))]);
const server=createServer({key,cert},(_request,response)=>{response.setHeader("content-type","text/html; charset=utf-8");response.setHeader("cache-control","no-store");response.end(fixture)});
await bounded(new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)}),3000,"HTTPS fixture server");
const fixtureUrl=`https://127.0.0.1:${server.address().port}/`,browser=browsers[browserId];let context;
const result={schemaVersion:2,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),browserId,browserName:browser.name,browserExecutable:browser.path,browserCapability:{unpackedAutomation:browser.automationCapability,reason:browser.reason||null},gate,fixtureUrl:"https://127.0.0.1:<ephemeral>/",fixtureAuthority:"local HTTPS blank DApp; it only records EIP-6963 announcements and supplies no provider, account, RPC, signature, or transaction implementation",excludedLegacyFixtureGates:{names:["accounts","lifecycle","wrong-chain","add-chain","switch-chain","tamper"],reason:"The former gates depended on a fixture-created YNX provider and fixture-generated calls, accounts, chain changes, or lifecycle events. They are excluded from real runtime proof; corresponding capability claims remain false until exercised through the real extension and approval UI."},loadMode:"temporary-unpacked-isolated-profile",profileClass:"disposable",temporaryDirectory:temp,runtimeFiles:{manifestSha256:sha256(manifest),pageProviderSha256:sha256(pageProvider)},passed:false,providerDiscovered:false,exactYnxIdentityProved:false,chainIdProved:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,installedLocal:false,downloadHosted:false,productionSigned:false,storeReleased:false};
try{
  context=await bounded(chromium.launchPersistentContext(profile,{executablePath:browser.path,headless:true,ignoreHTTPSErrors:true,timeout:12000,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]}),15000,"browser launch");
  result.version=context.browser()?.version()||"unknown";
  const worker=await bounded((async()=>{for(let i=0;i<30;i++){const found=context.serviceWorkers()[0];if(found)return found;await new Promise(resolveWait=>setTimeout(resolveWait,200))}return context.waitForEvent("serviceworker",{timeout:1000})})(),8000,"service worker");
  result.serviceWorker={started:true,url:worker.url()};
  const page=context.pages()[0]||await context.newPage();
  await bounded(page.goto(fixtureUrl,{waitUntil:"domcontentloaded",timeout:5000}),6000,"HTTPS fixture navigation");
  await bounded(page.waitForFunction(()=>globalThis.__YNX_EIP6963_FIXTURE__?.announcements?.some(item=>item.info?.rdns==="com.ynx.wallet"),null,{timeout:5000}),6000,"real EIP-6963 announcement");
  result.discovery=await page.evaluate(()=>{const announcements=globalThis.__YNX_EIP6963_FIXTURE__.announcements,matching=announcements.filter(item=>item.info?.rdns==="com.ynx.wallet"),item=matching[0];return{announcementCount:announcements.length,matchingCount:matching.length,info:item?.info||null,provider:{present:Boolean(item?.provider),isYNXWallet:item?.provider?.isYNXWallet===true,isMetaMask:item?.provider?.isMetaMask===true,requestType:typeof item?.provider?.request,__ynxCompanion:item?.provider?.__ynxCompanion===true}}});
  result.providerDiscovered=result.discovery.matchingCount===1&&result.discovery.provider.present;
  result.exactYnxIdentityProved=result.providerDiscovered&&result.discovery.info?.rdns==="com.ynx.wallet"&&result.discovery.info?.name==="YNX Wallet"&&result.discovery.provider.isYNXWallet&&result.discovery.provider.isMetaMask===false&&result.discovery.provider.requestType==="function"&&result.discovery.provider.__ynxCompanion;
  if(gate==="chain-id"||gate==="rpc"){
    result.outcome=await bounded(page.evaluate(async()=>{const item=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(candidate=>candidate.info?.rdns==="com.ynx.wallet");try{return{success:true,result:await item.provider.request({method:"eth_chainId"})}}catch(error){return{success:false,error:{code:error?.code||null,message:error?.message||String(error)}}}}),20000,"real provider eth_chainId");
    result.chainIdProved=result.outcome.success===true&&result.outcome.result==="0x1917";
  }
  result.passed=result.exactYnxIdentityProved&&(gate==="injection"||result.chainIdProved);
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)};}
finally{if(context)await bounded(context.close(),4000,"browser close").catch(()=>{});server.closeAllConnections?.();await bounded(new Promise(resolveClose=>server.close(resolveClose)),2000,"HTTPS fixture close").catch(()=>{});await rm(temp,{recursive:true,force:true}).catch(()=>{});}
if(writeEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,`branded-${browserId}-${gate}.json`),`${JSON.stringify(result,null,2)}\n`)}
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
