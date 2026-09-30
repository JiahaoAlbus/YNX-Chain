import {execFileSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {loadavg,tmpdir} from "node:os";
import {basename,dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const archivePath=process.env.YNX_WALLET_EXTENSION_ARCHIVE?resolve(process.env.YNX_WALLET_EXTENSION_ARCHIVE):resolve(root,"artifacts/ynx-wallet-chrome-edge-0.1.2.zip");
const browserName=process.env.YNX_BROWSER||"chromium";
const threeFaults=process.env.YNX_WALLET_THREE_FAULTS==="1";
const companionProbe=process.env.YNX_WALLET_SKIP_COMPANION!=="1";
if(!["chromium","edge"].includes(browserName))throw new Error("YNX_BROWSER must be chromium or edge");
const browserPath=browserName==="edge"?"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge":chromium.executablePath();
const evidencePath=process.env.YNX_WALLET_WEB_EVIDENCE_PATH?resolve(process.env.YNX_WALLET_WEB_EVIDENCE_PATH):join(root,"evidence/runtime/finance-public-chromium-20260925.json");
const temp=await mkdtemp(join(tmpdir(),"ynx-finance-public-wallet-"));
const extensionPath=join(temp,"extension"),profile=join(temp,"profile");
const archive=await readFile(archivePath),entries=execFileSync("unzip",["-Z1",archivePath],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
if(!entries.length||entries.some(item=>item.startsWith("/")||item.split("/").includes("..")))throw new Error("Unsafe wallet archive");
await mkdir(extensionPath);execFileSync("unzip",["-q",archivePath,"-d",extensionPath]);
const identity=JSON.parse(await readFile(join(extensionPath,"build-identity.json"),"utf8"));
if(process.env.YNX_WALLET_WEB_SOURCE_COMMIT&&identity.sourceCommit!==process.env.YNX_WALLET_WEB_SOURCE_COMMIT)throw new Error("Candidate ZIP source does not match the requested commit");
const result={schemaVersion:1,generatedAt:new Date().toISOString(),sourceCommit:identity.sourceCommit,hostLoadAverageStart:loadavg(),browser:{name:browserName==="edge"?"Microsoft Edge":"Chrome for Testing",version:null},runtimeClass:"real temporarily unpacked candidate ZIP in an isolated disposable browser profile",publicOrigin:"https://finance.ynxweb4.com",artifact:{name:basename(archivePath),bytes:archive.length,sha256:createHash("sha256").update(archive).digest("hex")},passed:false,providerDiscovered:false,vaultCreatedThroughUi:false,rejectionReturnedToFinance:false,standardConnected:false,refreshConnected:false,financeLocalDisconnect:false,refreshDisconnected:false,permissionRevoked:false,privateFinanceAuthorized:false,brokerLoginAuthorized:false,transactionSubmitted:false,publicWalletReleased:false,steps:[]};
const startedAt=Date.now(),step=name=>result.steps.push({name,elapsedMs:Date.now()-startedAt});
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`${label} timed out after ${ms}ms`),{code:"GATE_TIMEOUT"})),ms))]);
let context,finance;
try{
  context=await bounded(chromium.launchPersistentContext(profile,{executablePath:browserPath,headless:true,ignoreHTTPSErrors:false,timeout:15000,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]}),20000,`${browserName} launch`);
  result.browser.version=context.browser()?.version()||"unknown";
  const worker=await waitForWorker(context),extensionOrigin=worker.url().replace(/\/service-worker\.js$/u,"");
  const vault=await context.newPage(),password="ynx-disposable-finance-qa-password";
  await bounded(vault.goto(`${extensionOrigin}/vault.html`,{waitUntil:"domcontentloaded"}),15000,"vault page");
  await vault.locator("#password").fill(password);await vault.locator("#secret").fill(randomBytes(32).toString("hex"));await vault.locator("#prepare").click();await vault.locator("#save:not([disabled])").waitFor();await vault.locator("#save").click();
  await bounded(vault.waitForFunction(()=>/^0x[0-9a-f]{40}$/u.test(document.querySelector("#evm-account")?.textContent||"")),15000,"vault account");result.account=await vault.locator("#evm-account").textContent();result.vaultCreatedThroughUi=true;await vault.close();step("vault-ready");
  if(threeFaults){
    if(companionProbe){
    const companion=await context.newPage();await companion.goto("https://wallet.ynxweb4.com/",{waitUntil:"domcontentloaded"});await companion.waitForFunction(()=>document.documentElement.dataset.walletDiscovery==="ready");await companion.locator("#wallet-connect-trigger").click();
    await companion.locator("#ynx").click();const review=await waitForExtensionPage(context,"/approval.html");await review.locator("#reject:not([disabled])").click();
    await companion.locator("#network-tools summary").click();
    await companion.locator("#switch:not([disabled])").waitFor();await companion.locator("#switch").click();
    await companion.waitForFunction(()=>document.querySelector("#status")?.dataset.kind==="info"&&!document.querySelector("#switch")?.disabled);
    result.networkOnlyStatus=await companion.locator("#status").innerText();
    result.networkOnlyDisconnected=/not connected/iu.test(result.networkOnlyStatus)&&!await companion.locator("#actions").isVisible();await companion.close();
    }
    // This worker belongs solely to the generated disposable QA profile.
    result.vaultHashBeforeMigration=await worker.evaluate(async()=>{const values=await chrome.storage.local.get("ynx.wallet.provider.vault.v1");const bytes=new TextEncoder().encode(JSON.stringify(values));const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");await chrome.storage.local.remove("ynx.wallet.provider.account.v1");return hash});
  }
  finance=await context.newPage();result.pageErrors=[];finance.on("pageerror",error=>result.pageErrors.push(error.message.slice(0,240)));
  const response=await bounded(finance.goto(result.publicOrigin,{waitUntil:"commit",timeout:30000}),35000,"Finance page");result.publicStatus=response?.status()||null;
  await bounded(finance.waitForFunction(()=>window.YNXFinanceWallet?.getStandardWalletState),20000,"Finance wallet client");
  await bounded(finance.waitForLoadState("domcontentloaded",{timeout:60000}),65000,"Finance DOM ready");
  result.providerDiscovered=await finance.evaluate(()=>new Promise(resolve=>{const found=[];const listener=event=>{if(event.detail?.info?.rdns==="com.ynx.wallet")found.push(event.detail)};addEventListener("eip6963:announceProvider",listener);dispatchEvent(new Event("eip6963:requestProvider"));setTimeout(()=>{removeEventListener("eip6963:announceProvider",listener);resolve(found.some(item=>item.provider?.isYNXWallet===true&&item.provider?.isMetaMask===false))},250)}));step("finance-loaded");
  if(threeFaults){
    const website=await context.request.get("https://www.ynxweb4.com/");const html=await website.text();const asset=html.match(/src="(\/assets\/index-[^"]+\.js)"/u)?.[1];if(!asset)throw new Error("Official website asset unavailable");
    const source=await (await context.request.get(`https://www.ynxweb4.com${asset}`)).text();
    // Decode the currently published networkParams inputs, not Wallet constants.
    const name=source.match(/networkName:"([^"]+)"/u)?.[1],currency=source.match(/nativeCurrency:Object\.freeze\(\{name:"([^"]+)",symbol:"([^"]+)",decimals:(\d+)\}\)/u),id=source.match(/evmChainId:"([^"]+)"/u)?.[1],urls=source.match(/services:Object\.freeze\(\{rpc:"([^"]+)",evm:"([^"]+)",explorer:"([^"]+)"/u);
    if(!source.includes('fv={}')||!source.includes('rpcUrls:[Ze.evmRpc],blockExplorerUrls:[Ze.explorerUrl]')||!currency||!urls||!id||!name)throw new Error("Published networkParams decoder requires review");
    result.websiteParams={chainId:id,chainName:name,nativeCurrency:{name:currency[1],symbol:currency[2],decimals:Number(currency[3])},rpcUrls:[urls[2]],blockExplorerUrls:[urls[3]]};result.websiteAsset=asset;result.websiteAssetSha256=createHash("sha256").update(source).digest("hex");
    result.networkRepetitions=[];
    for(let n=0;n<3;n++)result.networkRepetitions.push(await finance.evaluate(params=>new Promise(resolve=>{const listener=async event=>{if(event.detail?.info?.rdns!=="com.ynx.wallet")return;removeEventListener("eip6963:announceProvider",listener);const provider=event.detail.provider;try{const added=await provider.request({method:"wallet_addEthereumChain",params:[params]});await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:params.chainId}]});resolve({added,chainId:await provider.request({method:"eth_chainId"}),accounts:await provider.request({method:"eth_accounts"})})}catch(error){resolve({errorCode:error.code,error:error.message})}};addEventListener("eip6963:announceProvider",listener);dispatchEvent(new Event("eip6963:requestProvider"))}),result.websiteParams));
    result.networkMutationPassed=result.networkRepetitions.every(item=>item.added===null&&item.chainId==="0x1917"&&item.accounts?.length===0);
  }
  await finance.locator("#connect-ynx").click();const rejectedPage=await waitForExtensionPage(context,"/approval.html");await rejectedPage.locator("#reject:not([disabled])").waitFor();await rejectedPage.locator("#reject").click();
  if(!rejectedPage.isClosed())await rejectedPage.waitForEvent("close",{timeout:15000});
  await finance.waitForTimeout(500);result.rejectionState=await finance.evaluate(()=>({walletState:document.querySelector("#wallet-state")?.textContent,standard:window.YNXFinanceWallet.getStandardWalletState()}));result.rejectionReturnedToFinance=result.rejectionState.standard.status==="disconnected"&&/REJECT|4001|denied/iu.test(result.rejectionState.walletState||"");step("finance-rejected");
  await finance.locator("#connect-ynx").click();const approvedPage=await waitForExtensionPage(context,"/approval.html");await approvedPage.locator("#approve:not([disabled])").waitFor();await approvedPage.locator("#approve").click();
  await bounded(finance.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==="connected"),90000,"Finance standard connection");result.connectedState=await finance.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState());result.standardConnected=result.connectedState.providerKind==="ynx-wallet"&&result.connectedState.account?.toLowerCase()===result.account&&result.connectedState.chainId==="0x1917";step("finance-connected");
  await bounded(finance.reload({waitUntil:"domcontentloaded"}),20000,"Finance connected refresh");await bounded(finance.waitForFunction(()=>window.YNXFinanceWallet?.getStandardWalletState?.().status==="connected"),30000,"Finance connected restore");
  result.refreshedConnectedState=await finance.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState());result.refreshConnected=result.refreshedConnectedState.providerKind==="ynx-wallet"&&result.refreshedConnectedState.account?.toLowerCase()===result.account&&result.refreshedConnectedState.chainId==="0x1917";step("finance-connected-refreshed");
  await finance.locator("#wallet-disconnect").click();result.financeLocalDisconnect=(await finance.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status))==="disconnected";step("finance-local-disconnect");
  await bounded(finance.reload({waitUntil:"domcontentloaded"}),20000,"Finance refresh");await bounded(finance.waitForFunction(()=>window.YNXFinanceWallet?.getStandardWalletState),20000,"Finance restore client");result.refreshDisconnected=(await finance.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status))==="disconnected";step("finance-refreshed");
  await finance.locator("#connect-ynx").click();await bounded(finance.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==="connected"),90000,"Finance reconnect");
  await finance.locator("#wallet-revoke").click();await bounded(finance.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==="disconnected"),30000,"Finance revoke");
  result.permissionRevoked=await finance.evaluate(async()=>{const announced=await new Promise(resolve=>{let found;const listener=event=>{if(event.detail?.info?.rdns==="com.ynx.wallet")found=event.detail.provider};addEventListener("eip6963:announceProvider",listener);dispatchEvent(new Event("eip6963:requestProvider"));setTimeout(()=>{removeEventListener("eip6963:announceProvider",listener);resolve(found)},250)});return Array.isArray(await announced.request({method:"eth_accounts"}))&&(await announced.request({method:"eth_accounts"})).length===0});step("finance-revoked");
  if(threeFaults){
    const stored=await worker.evaluate(async()=>{const values=await chrome.storage.local.get("ynx.wallet.provider.vault.v1"),indexed=await chrome.storage.local.get("ynx.wallet.provider.account.v1");const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(values)))),b=>b.toString(16).padStart(2,"0")).join("");return{hash,account:indexed["ynx.wallet.provider.account.v1"]?.account}});
    result.vaultPreservedAfterMigration=stored.hash===result.vaultHashBeforeMigration;result.providerIndexRecovered=stored.account===result.account;
  }
  result.companionProbePerformed=threeFaults&&companionProbe;
  result.passed=result.publicStatus===200&&result.providerDiscovered&&result.vaultCreatedThroughUi&&result.rejectionReturnedToFinance&&result.standardConnected&&result.refreshConnected&&result.financeLocalDisconnect&&result.refreshDisconnected&&result.permissionRevoked&&(!threeFaults||(!companionProbe||result.networkOnlyDisconnected)&&result.networkMutationPassed&&result.vaultPreservedAfterMigration&&result.providerIndexRecovered);
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)};if(finance&&!finance.isClosed())result.financeAtFailure=await finance.evaluate(()=>({walletState:document.querySelector("#wallet-state")?.textContent,standard:window.YNXFinanceWallet?.getStandardWalletState?.(),approvalVisible:document.querySelector("#wallet-choice")?.classList.contains("hidden")})).catch(()=>null);}
finally{result.hostLoadAverageEnd=loadavg();if(context)await context.close().catch(()=>{});await rm(temp,{recursive:true,force:true}).catch(()=>{});}
await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);

async function waitForWorker(browserContext){for(let attempt=0;attempt<50;attempt++){const worker=browserContext.serviceWorkers()[0];if(worker)return worker;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error("Wallet service worker did not start")}
async function waitForExtensionPage(browserContext,path){for(let attempt=0;attempt<600;attempt++){const page=browserContext.pages().find(item=>{try{return new URL(item.url()).pathname===path}catch{return false}});if(page){await page.waitForLoadState("domcontentloaded");return page}await new Promise(resolve=>setTimeout(resolve,100))}throw Object.assign(new Error(`${path} did not open`),{code:"EXTENSION_PAGE_TIMEOUT"})}
