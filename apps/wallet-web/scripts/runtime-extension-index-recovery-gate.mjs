import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {createServer} from "node:https";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {chromium} from "playwright";

const sourceCommit="31f3ef16d3812870e0c3d23350565fd592482227",archivePath=resolve(process.env.YNX_EXTENSION_ARCHIVE||"");
if(!process.env.YNX_EXTENSION_ARCHIVE)throw new Error("YNX_EXTENSION_ARCHIVE is required");
const browserName=process.env.YNX_BROWSER||"chromium",executablePath=browserName==="edge"?"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge":chromium.executablePath();
if(!["chromium","edge"].includes(browserName))throw new Error("Unsupported browser");
const archive=await readFile(archivePath),archiveSha256=createHash("sha256").update(archive).digest("hex");
const entries=execFileSync("unzip",["-Z1",archivePath],{encoding:"utf8"}).trim().split("\n");
assert.ok(entries.length>10&&entries.every(entry=>!entry.startsWith("/")&&!entry.split("/").includes("..")));
const temporary=await mkdtemp(join(tmpdir(),"ynx-extension-index-qa-")),extensionPath=join(temporary,"extension"),profile=join(temporary,"profile"),keyPath=join(temporary,"fixture.key"),certPath=join(temporary,"fixture.crt");
await mkdir(extensionPath);execFileSync("unzip",["-q",archivePath,"-d",extensionPath]);
const identity=JSON.parse(await readFile(join(extensionPath,"build-identity.json"),"utf8"));assert.equal(identity.sourceCommit,sourceCommit);
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyPath,"-out",certPath,"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
const [key,cert,fixture]=await Promise.all([readFile(keyPath),readFile(certPath),readFile(new URL("../test/fixtures/dapp-eip6963-frozen.html",import.meta.url))]);
const server=createServer({key,cert},(_request,response)=>{response.setHeader("content-type","text/html");response.end(fixture)});
const result={schemaVersion:1,sourceCommit,archive:{bytes:archive.length,sha256:archiveSha256},browser:browserName,runtimeClass:"frozen extension ZIP in disposable HTTPS DApp profile",fixtureOnly:true,initialVaultCreated:false,priorGrantWritten:false,indexDeleted:false,coldRestart:false,indexRecovered:false,vaultUnchanged:false,samePublicAccount:false,grantsReset:false,providerAccountsStayedDisconnected:false,installedLocal:false,deployedPublic:false,passed:false};
let browser;
const workerFrom=async context=>context.serviceWorkers()[0]||await context.waitForEvent("serviceworker",{timeout:10000});
const launch=()=>chromium.launchPersistentContext(profile,{executablePath,headless:true,ignoreHTTPSErrors:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]});
try{
  await new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)});
  browser=await launch();let worker=await workerFrom(browser),origin=worker.url().replace(/\/service-worker\.js$/u,"");
  const vault=await browser.newPage();await vault.goto(`${origin}/vault.html`);await vault.locator("#password").fill(`qa-${randomBytes(16).toString("hex")}`);await vault.locator("#secret").fill(randomBytes(32).toString("hex"));await vault.locator("#prepare").click();await vault.locator("#save:not([disabled])").click();
  await vault.waitForFunction(()=>/^0x[0-9a-f]{40}$/u.test(document.querySelector("#evm-account")?.textContent||""));const address=await vault.locator("#evm-account").textContent();result.initialVaultCreated=true;
  const dappOrigin=`https://127.0.0.1:${server.address().port}`;
  await worker.evaluate(async({address,dappOrigin})=>{await chrome.storage.local.set({"ynx.wallet.provider.permissions.v1":{[dappOrigin]:{version:1,origin:dappOrigin,account:address,chainId:"0x1917",grantedAt:Date.now()}}})},{address,dappOrigin});
  const before=await worker.evaluate(async()=>chrome.storage.local.get(["ynx.wallet.provider.vault.v1","ynx.wallet.provider.account.v1","ynx.wallet.provider.permissions.v1"]));
  assert.equal(before["ynx.wallet.provider.account.v1"]?.account,address);
  assert.ok(Object.keys(before["ynx.wallet.provider.permissions.v1"]||{}).length===1);result.priorGrantWritten=true;
  await worker.evaluate(()=>chrome.storage.local.remove("ynx.wallet.provider.account.v1"));result.indexDeleted=true;
  await browser.close();browser=await launch();result.coldRestart=true;worker=await workerFrom(browser);
  const dapp=await browser.newPage();await dapp.goto(`https://127.0.0.1:${server.address().port}/`);await dapp.waitForFunction(()=>__YNX_EIP6963_FIXTURE__.announcements.some(item=>item.info?.rdns==="com.ynx.wallet"));
  const accounts=await dapp.evaluate(async()=>__YNX_EIP6963_FIXTURE__.announcements.find(item=>item.info?.rdns==="com.ynx.wallet").provider.request({method:"eth_accounts"}));
  result.providerAccountsStayedDisconnected=Array.isArray(accounts)&&accounts.length===0;
  const after=await worker.evaluate(async()=>chrome.storage.local.get(["ynx.wallet.provider.vault.v1","ynx.wallet.provider.account.v1","ynx.wallet.provider.permissions.v1"]));
  result.indexRecovered=after["ynx.wallet.provider.account.v1"]?.account===address;
  result.samePublicAccount=result.indexRecovered;
  result.vaultUnchanged=JSON.stringify(before["ynx.wallet.provider.vault.v1"])===JSON.stringify(after["ynx.wallet.provider.vault.v1"]);
  result.grantsReset=JSON.stringify(after["ynx.wallet.provider.permissions.v1"]||{})==="{}";
  result.passed=result.initialVaultCreated&&result.priorGrantWritten&&result.indexDeleted&&result.coldRestart&&result.indexRecovered&&result.vaultUnchanged&&result.samePublicAccount&&result.grantsReset&&result.providerAccountsStayedDisconnected;
}catch(error){result.error={code:error?.code||null,name:error?.name||"Error",message:error?.message||String(error)}}finally{
  await browser?.close().catch(()=>{});server.closeAllConnections?.();await new Promise(done=>server.close(done)).catch(()=>{});await rm(temporary,{recursive:true,force:true}).catch(()=>{});
}
if(process.env.YNX_QA_EVIDENCE_DIR){await mkdir(process.env.YNX_QA_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.YNX_QA_EVIDENCE_DIR,`extension-index-${browserName}.json`),`${JSON.stringify(result,null,2)}\n`)}
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
