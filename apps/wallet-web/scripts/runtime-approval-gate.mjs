import {execFileSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {createServer} from "node:https";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {loadavg,tmpdir} from "node:os";
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
const result={schemaVersion:2,sourceCommit,generatedAt:new Date().toISOString(),hostLoadAverageStart:loadavg(),browser:{id:browserId,name:browser.name,version:null,branded:browser.branded},runtimeClass:"temporary unpacked extension in an isolated disposable profile",fixtureAuthority:"local HTTPS DApp with an immutable foreign MetaMask-shaped provider; no account, signature or transaction fixture implementation",artifact:{manifestSha256:sha256(manifest),pageProviderSha256:sha256(pageProvider),buildSourceCommit:buildIdentity.sourceCommit,...(archiveEvidence?{localArchive:archiveEvidence}:{sourceDirectory:"dist/chromium"})},passed:false,providerDiscovered:false,foreignProviderPreserved:false,vaultCreatedThroughUi:false,providerConnected:false,accountAuthorized:false,chainIdProved:false,addChainAccepted:false,switchChainAccepted:false,invalidChainRejected:false,approvalRejected:false,refreshDisconnected:false,accountSwitchRevoked:false,accountSwitched:false,messageSigned:false,signatureRecovered:false,permissionRevoked:false,postRevokeDenied:false,transactionSubmitted:false,installedLocal:false,downloadHosted:false,productionSigned:false,storeReleased:false};
let context;
try{
  context=await bounded(chromium.launchPersistentContext(profile,{executablePath:browser.path,headless:process.env.YNX_HEADFUL!=="1",ignoreHTTPSErrors:true,timeout:12000,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]}),15000,"browser launch");
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
  result.steps=[];const step=name=>result.steps.push({name,elapsedMs:Date.now()-startedAt});const startedAt=Date.now();
  await dapp.evaluate(()=>{globalThis.__YNX_BRIDGE_TRACE__=[];addEventListener("message",event=>{if(/^YNX_PAGE_/u.test(event.data?.type||""))globalThis.__YNX_BRIDGE_TRACE__.push({type:event.data.type,method:event.data.method,ok:event.data.ok,error:event.data.error})})});
  step("discovered");
  result.chainIdProved=(await bounded(dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;return provider.request({method:"eth_chainId"})}),90000,"chain ID result"))==="0x1917";step("chain-returned");

  const connectPromise=dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;try{return{ok:true,result:await provider.request({method:"eth_requestAccounts"})}}catch(error){return{ok:false,error:{code:error?.code||null,message:error?.message||String(error)}}}});
  const approval=await Promise.race([waitForExtensionPage(context,"/approval.html"),connectPromise.then(response=>response.ok?new Promise(()=>{}):response)]);step("approval-opened");
  if(!approval?.locator)throw Object.assign(new Error(approval?.error?.message||"Approval did not open"),{code:approval?.error?.code||"APPROVAL_REQUEST_FAILED"});
  await approval.locator("#approve:not([disabled])").waitFor();await approval.locator("#approve").click();step("approval-clicked");
  const accountResponse=await bounded(connectPromise,90000,"account approval result");step("account-returned");if(!accountResponse.ok)throw Object.assign(new Error(accountResponse.error.message),{code:accountResponse.error.code});const accounts=accountResponse.result;result.connectedAccounts=accounts;result.providerConnected=Array.isArray(accounts)&&accounts.length===1;result.accountAuthorized=result.providerConnected&&accounts[0]===result.account;
  if(!approval.isClosed())await approval.waitForEvent("close",{timeout:15000});

  const network=await bounded(dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider,chain={chainId:"0x1917",chainName:"YNX Testnet",nativeCurrency:{name:"YNX Testnet",symbol:"YNXT",decimals:18},rpcUrls:["https://rpc-testnet.ynxweb4.com","https://evm.ynxweb4.com"],blockExplorerUrls:["https://explorer.ynxweb4.com"]};await provider.request({method:"wallet_addEthereumChain",params:[chain]});const added=await provider.request({method:"eth_chainId"});await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x1917"}]});const switched=await provider.request({method:"eth_chainId"});let invalidCode=null;try{await provider.request({method:"wallet_addEthereumChain",params:[{chainId:"0x1"}]})}catch(error){invalidCode=error?.code}return{added,switched,invalidCode,accounts:await provider.request({method:"eth_accounts"})}}),90000,"network mutations");result.addChainAccepted=network.added==="0x1917";result.switchChainAccepted=network.switched==="0x1917"&&network.accounts?.[0]===result.account;result.invalidChainRejected=network.invalidCode==="INVALID_CHAIN_PARAMS";step("network-checked");

  const signPromise=dapp.evaluate(async hex=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;try{const accounts=await provider.request({method:"eth_accounts"});return{ok:true,result:await provider.request({method:"personal_sign",params:[hex,accounts[0]]})}}catch(error){return{ok:false,error:{code:error?.code||null,message:error?.message||String(error)}}}},messageHex);
  const signer=await waitForExtensionPage(context,"/signer.html");await signer.locator("#approve:not([disabled])").waitFor();await signer.locator("#password").fill(password);await signer.locator("#approve").click();
  const signResponse=await bounded(signPromise,90000,"signature result");if(!signResponse.ok)throw Object.assign(new Error(signResponse.error.message),{code:signResponse.error.code});const signature=signResponse.result;result.messageSigned=/^0x[0-9a-f]{130}$/u.test(signature);result.signatureRecovered=verifyMessage(getBytes(messageHex),signature).toLowerCase()===result.account.toLowerCase();result.signatureSha256=sha256(signature);

  await dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;return provider.request({method:"wallet_revokePermissions",params:[{eth_accounts:{}}]})});
  const afterRevoke=await dapp.evaluate(async hex=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider,accounts=await provider.request({method:"eth_accounts"});let denied=null;try{await provider.request({method:"personal_sign",params:[hex,"0x"+"00".repeat(20)]})}catch(error){denied={code:error?.code||null,message:error?.message||String(error)}}return{accounts,denied}},messageHex);
  result.permissionRevoked=Array.isArray(afterRevoke.accounts)&&afterRevoke.accounts.length===0;result.postRevokeDenied=afterRevoke.denied?.code===4100;
  step("permission-revoked");
  const rejectPromise=dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;try{return{ok:true,result:await provider.request({method:"eth_requestAccounts"})}}catch(error){return{ok:false,code:error?.code}}});
  const rejectPage=await waitForExtensionPage(context,"/approval.html");await rejectPage.locator("#reject:not([disabled])").waitFor();await rejectPage.locator("#reject").click();const rejected=await bounded(rejectPromise,90000,"rejection result");result.approvalRejected=rejected.ok===false&&rejected.code===4001;step("approval-rejected");
  if(!rejectPage.isClosed())await rejectPage.waitForEvent("close",{timeout:15000});
  await bounded(dapp.reload({waitUntil:"domcontentloaded"}),15000,"DApp refresh");await bounded(dapp.waitForFunction(()=>globalThis.__YNX_EIP6963_FIXTURE__?.announcements?.some(item=>item.info?.rdns==="com.ynx.wallet")),15000,"provider rediscovery");result.refreshDisconnected=(await bounded(dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;return provider.request({method:"eth_accounts"})}),90000,"accounts after refresh")).length===0;step("page-refreshed");
  const replacementSecret=randomBytes(32).toString("hex"),replacementVault=await context.newPage();await bounded(replacementVault.goto(`${extensionOrigin}/vault.html`,{waitUntil:"domcontentloaded",timeout:5000}),6000,"replacement vault navigation");await replacementVault.locator("#password").fill(password);await replacementVault.locator("#secret").fill(replacementSecret);await replacementVault.locator("#prepare").click();await replacementVault.locator("#save:not([disabled])").waitFor();await replacementVault.locator("#save").click();await bounded(replacementVault.waitForFunction(oldAccount=>/^0x[0-9a-f]{40}$/u.test(document.querySelector("#evm-account")?.textContent||"")&&document.querySelector("#evm-account").textContent!==oldAccount,result.account),15000,"replacement account");result.replacementAccount=await replacementVault.locator("#evm-account").textContent();await replacementVault.close();result.accountSwitchRevoked=(await bounded(dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;return provider.request({method:"eth_accounts"})}),90000,"accounts after account switch")).length===0;step("account-switched-in-vault");
  const reconnectPromise=dapp.evaluate(async()=>{const provider=globalThis.__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider;try{return{ok:true,result:await provider.request({method:"eth_requestAccounts"})}}catch(error){return{ok:false,code:error?.code,message:error?.message}}});const reconnectPage=await waitForExtensionPage(context,"/approval.html");await reconnectPage.locator("#approve:not([disabled])").waitFor();await reconnectPage.locator("#approve").click();const reconnected=await bounded(reconnectPromise,90000,"new account approval result");result.accountSwitched=reconnected.ok===true&&reconnected.result?.[0]===result.replacementAccount;step("new-account-returned");
  result.passed=result.providerDiscovered&&result.foreignProviderPreserved&&result.vaultCreatedThroughUi&&result.chainIdProved&&result.accountAuthorized&&result.addChainAccepted&&result.switchChainAccepted&&result.invalidChainRejected&&result.messageSigned&&result.signatureRecovered&&result.permissionRevoked&&result.postRevokeDenied&&result.approvalRejected&&result.refreshDisconnected&&result.accountSwitchRevoked&&result.accountSwitched;
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)};const dapp=context?.pages().find(page=>page.url().startsWith(fixtureUrl));if(dapp)result.bridgeTrace=await dapp.evaluate(()=>globalThis.__YNX_BRIDGE_TRACE__||[]).catch(()=>[]);}
finally{if(context)await bounded(context.close(),5000,"browser close").catch(()=>{});server.closeAllConnections?.();await bounded(new Promise(resolveClose=>server.close(resolveClose)),2000,"fixture close").catch(()=>{});await rm(temp,{recursive:true,force:true}).catch(()=>{});}
result.hostLoadAverageEnd=loadavg();
if(writeEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,`approval-${archiveEvidence?"local-archive-":""}${browserId}.json`),`${JSON.stringify(result,null,2)}\n`)}
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);

async function waitForWorker(browserContext){for(let attempt=0;attempt<30;attempt++){const found=browserContext.serviceWorkers()[0];if(found)return found;await new Promise(resolveWait=>setTimeout(resolveWait,200))}return bounded(browserContext.waitForEvent("serviceworker"),3000,"service worker")}
async function waitForExtensionPage(browserContext,path){for(let attempt=0;attempt<600;attempt++){const found=browserContext.pages().find(page=>{try{return new URL(page.url()).pathname===path}catch{return false}});if(found){await found.waitForLoadState("domcontentloaded");return found}await new Promise(resolveWait=>setTimeout(resolveWait,100))}throw Object.assign(new Error(`${path} did not open`),{code:"EXTENSION_PAGE_TIMEOUT"})}
