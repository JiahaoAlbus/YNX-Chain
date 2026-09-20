import {execFileSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {createServer} from "node:https";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {getBytes,verifyMessage} from "ethers";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const fixturePath=join(root,"test","fixtures","dapp-eip6963-frozen.html");
const evidenceDir=join(root,"evidence","runtime"),sourceCommit=process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree";
const writeEvidence=process.env.YNX_WALLET_WEB_WRITE_EVIDENCE==="1",browserId=process.env.YNX_BROWSER||"edge";
const browsers={
  edge:{name:"Microsoft Edge",path:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",branded:true},
  chromium:{name:"Chrome for Testing",path:chromium.executablePath(),branded:false},
};
if(!browsers[browserId])throw new Error("YNX_BROWSER must be edge or chromium");
const browser=browsers[browserId],password="ynx-disposable-runtime-password",secret=randomBytes(32).toString("hex"),messageHex=`0x${Buffer.from("YNX Wallet real approval runtime").toString("hex")}`;
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`${label} timed out after ${ms}ms`),{code:"GATE_TIMEOUT"})),ms))]);
const sha256=value=>createHash("sha256").update(value).digest("hex");
const temp=await mkdtemp(join(tmpdir(),`ynx-wallet-approval-${browserId}-`)),profile=join(temp,"profile"),keyPath=join(temp,"fixture.key.pem"),certPath=join(temp,"fixture.cert.pem");
const archiveInput=process.env.YNX_WALLET_EXTENSION_ARCHIVE?resolve(process.env.YNX_WALLET_EXTENSION_ARCHIVE):null;
let extensionPath=join(root,"dist","chromium"),archiveEvidence=null;
if(archiveInput){
  const archive=await readFile(archiveInput),entries=execFileSync("unzip",["-Z1",archiveInput],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
  if(entries.length===0||entries.some(entry=>entry.startsWith("/")||entry.split("/").includes("..")))throw new Error("Extension archive contains an unsafe path");
  extensionPath=join(temp,"extension");await mkdir(extensionPath);execFileSync("unzip",["-q",archiveInput,"-d",extensionPath]);
  archiveEvidence={name:basename(archiveInput),bytes:archive.length,sha256:sha256(archive)};
}
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyPath,"-out",certPath,"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
const [fixture,key,cert,manifest,pageProvider]=await Promise.all([readFile(fixturePath),readFile(keyPath),readFile(certPath),readFile(join(extensionPath,"manifest.json")),readFile(join(extensionPath,"page-provider.js"))]);
const server=createServer({key,cert},(_request,response)=>{response.setHeader("content-type","text/html; charset=utf-8");response.setHeader("cache-control","no-store");response.end(fixture)});
await bounded(new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)}),3000,"fixture server");
const fixtureUrl=`https://127.0.0.1:${server.address().port}/`;
const buildIdentity=JSON.parse(await readFile(join(extensionPath,"build-identity.json"),"utf8"));
const result={schemaVersion:1,sourceCommit,generatedAt:new Date().toISOString(),browser:{id:browserId,name:browser.name,version:null,branded:browser.branded},runtimeClass:"temporary unpacked extension in an isolated disposable profile",fixtureAuthority:"local HTTPS DApp with an immutable foreign MetaMask-shaped provider; no account, signature or transaction fixture implementation",artifact:{manifestSha256:sha256(manifest),pageProviderSha256:sha256(pageProvider),buildSourceCommit:buildIdentity.sourceCommit,...(archiveEvidence?{publicArchive:archiveEvidence}:{sourceDirectory:"dist/chromium"})},passed:false,providerDiscovered:false,foreignProviderPreserved:false,vaultCreatedThroughUi:false,providerConnected:false,accountAuthorized:false,messageSigned:false,signatureRecovered:false,permissionRevoked:false,postRevokeDenied:false,transactionSubmitted:false,installedLocal:false,downloadHosted:Boolean(archiveEvidence),productionSigned:false,storeReleased:false};
let context;
try{
  context=await bounded(chromium.launchPersistentContext(profile,{executablePath:browser.path,headless:true,ignoreHTTPSErrors:true,timeout:12000,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]}),15000,"browser launch");
  result.browser.version=context.browser()?.version()||"unknown";
  const worker=await waitForWorker(context),extensionOrigin=worker.url().replace(/\/service-worker\.js$/u,"");
  result.serviceWorker={started:true,url:worker.url()};

  const vault=await context.newPage();
  await bounded(vault.goto(`${extensionOrigin}/vault.html`,{waitUntil:"domcontentloaded",timeout:5000}),6000,"vault navigation");
  await vault.locator("#password").fill(password);await vault.locator("#secret").fill(secret);await vault.locator("#prepare").click();
  await vault.locator("#save").waitFor({state:"visible"});await bounded(vault.locator("#save").click(),3000,"vault save click");
  await bounded(vault.waitForFunction(()=>/^0x[0-9a-f]{40}$/u.test(document.querySelector("#evm-account")?.textContent||"")),10000,"vault account");
  result.account=await vault.locator("#evm-account").textContent();result.vaultCreatedThroughUi=true;await vault.close();

  const dapp=context.pages()[0]||await context.newPage();
  await bounded(dapp.goto(fixtureUrl,{waitUntil:"domcontentloaded",timeout:5000}),6000,"DApp navigation");
  await bounded(dapp.waitForFunction(()=>globalThis.__YNX_EIP6963_FIXTURE__?.announcements?.some(item=>item.info?.rdns==="com.ynx.wallet")),6000,"EIP-6963 discovery");
  const discovery=await dapp.evaluate(()=>{const foreign=globalThis.__YNX_FOREIGN_FIXTURE__,item=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(candidate=>candidate.info?.rdns==="com.ynx.wallet");return{providerPresent:Boolean(item?.provider),isYNXWallet:item?.provider?.isYNXWallet===true,isMetaMask:item?.provider?.isMetaMask===true,foreignPreserved:globalThis.ethereum===foreign.ethereum&&globalThis.ethereum.providers===foreign.providers&&Object.isFrozen(foreign.providers)&&foreign.providers.length===1&&foreign.providers[0]===foreign.provider}});
  result.providerDiscovered=discovery.providerPresent&&discovery.isYNXWallet&&!discovery.isMetaMask;result.foreignProviderPreserved=discovery.foreignPreserved;

  const connectPromise=dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;return provider.request({method:"eth_requestAccounts"})});
  const approval=await waitForExtensionPage(context,"/approval.html");await approval.locator("#approve:not([disabled])").waitFor();await approval.locator("#approve").click();
  const accounts=await bounded(connectPromise,15000,"account approval result");result.connectedAccounts=accounts;result.providerConnected=Array.isArray(accounts)&&accounts.length===1;result.accountAuthorized=result.providerConnected&&accounts[0]===result.account;

  const signPromise=dapp.evaluate(async hex=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider,accounts=await provider.request({method:"eth_accounts"});return provider.request({method:"personal_sign",params:[hex,accounts[0]]})},messageHex);
  const signer=await waitForExtensionPage(context,"/signer.html");await signer.locator("#approve:not([disabled])").waitFor();await signer.locator("#password").fill(password);await signer.locator("#approve").click();
  const signature=await bounded(signPromise,15000,"signature result");result.messageSigned=/^0x[0-9a-f]{130}$/u.test(signature);result.signatureRecovered=verifyMessage(getBytes(messageHex),signature).toLowerCase()===result.account.toLowerCase();result.signatureSha256=sha256(signature);

  await dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;return provider.request({method:"wallet_revokePermissions",params:[{eth_accounts:{}}]})});
  const afterRevoke=await dapp.evaluate(async hex=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider,accounts=await provider.request({method:"eth_accounts"});let denied=null;try{await provider.request({method:"personal_sign",params:[hex,"0x"+"00".repeat(20)]})}catch(error){denied={code:error?.code||null,message:error?.message||String(error)}}return{accounts,denied}},messageHex);
  result.permissionRevoked=Array.isArray(afterRevoke.accounts)&&afterRevoke.accounts.length===0;result.postRevokeDenied=afterRevoke.denied?.code===4100;
  result.passed=result.providerDiscovered&&result.foreignProviderPreserved&&result.vaultCreatedThroughUi&&result.accountAuthorized&&result.messageSigned&&result.signatureRecovered&&result.permissionRevoked&&result.postRevokeDenied;
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)};}
finally{if(context)await bounded(context.close(),5000,"browser close").catch(()=>{});server.closeAllConnections?.();await bounded(new Promise(resolveClose=>server.close(resolveClose)),2000,"fixture close").catch(()=>{});await rm(temp,{recursive:true,force:true}).catch(()=>{});}
if(writeEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,`approval-${archiveEvidence?"public-":""}${browserId}.json`),`${JSON.stringify(result,null,2)}\n`)}
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);

async function waitForWorker(browserContext){for(let attempt=0;attempt<30;attempt++){const found=browserContext.serviceWorkers()[0];if(found)return found;await new Promise(resolveWait=>setTimeout(resolveWait,200))}return bounded(browserContext.waitForEvent("serviceworker"),3000,"service worker")}
async function waitForExtensionPage(browserContext,path){for(let attempt=0;attempt<100;attempt++){const found=browserContext.pages().find(page=>{try{return new URL(page.url()).pathname===path}catch{return false}});if(found){await found.waitForLoadState("domcontentloaded");return found}await new Promise(resolveWait=>setTimeout(resolveWait,100))}throw Object.assign(new Error(`${path} did not open`),{code:"EXTENSION_PAGE_TIMEOUT"})}
