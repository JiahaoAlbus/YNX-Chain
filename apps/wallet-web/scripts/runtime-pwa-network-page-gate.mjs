import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,extname,join,resolve,sep} from "node:path";
import {chromium} from "playwright";

const sourceCommit="31f3ef16d3812870e0c3d23350565fd592482227";
const archivePath=resolve(process.env.YNX_PWA_ARCHIVE||"");
if(!process.env.YNX_PWA_ARCHIVE)throw new Error("YNX_PWA_ARCHIVE is required");
const browserName=process.env.YNX_BROWSER||"chromium";
if(!["chromium","edge"].includes(browserName))throw new Error("Unsupported browser");
const executablePath=browserName==="edge"?"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge":chromium.executablePath();
const archive=await readFile(archivePath),archiveSha256=createHash("sha256").update(archive).digest("hex");
const entries=execFileSync("unzip",["-Z1",archivePath],{encoding:"utf8"}).trim().split("\n");
assert.ok(entries.length>10&&entries.every(entry=>!entry.startsWith("/")&&!entry.split("/").includes("..")));
const temporary=await mkdtemp(join(tmpdir(),"ynx-pwa-page-qa-")),dist=join(temporary,"pwa"),profile=join(temporary,"profile");
await mkdir(dist);execFileSync("unzip",["-q",archivePath,"-d",dist]);
const identity=JSON.parse(await readFile(join(dist,"build-identity.json"),"utf8"));
assert.equal(identity.sourceCommit,sourceCommit);
const account="0x1111111111111111111111111111111111111111";
const result={schemaVersion:1,sourceCommit,archive:{name:basename(archivePath),bytes:archive.length,sha256:archiveSha256},browser:browserName,runtimeClass:"frozen PWA ZIP in disposable browser profile with simulated EIP-1193 provider and local static server",fixtureOnly:true,providerConnected:false,extensionMigrationVerified:false,installedPwa:false,deployedPublic:false,passed:false};
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url||"/","http://127.0.0.1").pathname,path=resolve(dist,pathname==="/"?"index.html":pathname.slice(1));
  if(!path.startsWith(dist+sep)){response.writeHead(403).end();return}
  try{const body=await readFile(path);response.setHeader("cache-control","no-store");response.setHeader("content-type",{html:"text/html",js:"text/javascript",css:"text/css",json:"application/json"}[extname(path).slice(1)]||"application/octet-stream");response.end(body)}catch{response.writeHead(404).end()}
});
let browser;
try{
  await new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)});
  browser=await chromium.launchPersistentContext(profile,{executablePath,headless:true,serviceWorkers:"block",timeout:15000});
  const page=browser.pages()[0]||await browser.newPage();
  await page.addInitScript(accountValue=>{
    const listeners=new Map();
    const restored=localStorage.getItem("__ynx_qa_authorized") === "1";
    const qa=globalThis.__YNX_QA__={authorized:restored,accounts:restored?[accountValue]:[],calls:[],account:accountValue};
    const provider={isYNXWallet:true,isMetaMask:false,rdns:"com.ynx.wallet",on(name,listener){const values=listeners.get(name)||[];values.push(listener);listeners.set(name,values)},removeListener(name,listener){listeners.set(name,(listeners.get(name)||[]).filter(value=>value!==listener))},async request({method,params}){
      qa.calls.push({method,params});
      if(method==="eth_chainId")return "0x1917";
      if(method==="eth_accounts")return [...qa.accounts];
      if(method==="eth_requestAccounts"){
        if(!qa.authorized)throw Object.assign(new Error("User rejected"),{code:4001});
        qa.accounts=[qa.account];return [...qa.accounts];
      }
      if(method==="wallet_addEthereumChain"||method==="wallet_switchEthereumChain")return null;
      if(method==="wallet_revokePermissions")return null;
      throw Object.assign(new Error("Unsupported fixture method"),{code:-32601});
    }};
    globalThis.ethereum=provider;
    addEventListener("eip6963:requestProvider",()=>dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid:"123e4567-e89b-42d3-a456-426614174000",name:"YNX Wallet fixture",rdns:"com.ynx.wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"},provider}})));
  },account);
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:"domcontentloaded"});
  await page.locator("#ynx:not([disabled])").waitFor({timeout:10000});
  await page.locator("#ynx").click();
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("4001"));
  result.rejectedConnectStayedDisconnected=await page.evaluate(()=>!localStorage.getItem("ynx.wallet.web.session.v1")&&!document.querySelector("#status")?.textContent?.includes("Connected"));
  await page.locator("#network-tools summary").click();
  await page.locator("#switch:not([disabled])").click();
  result.switchWithoutAccountDisconnected=await page.evaluate(()=>({status:document.querySelector("#status")?.textContent,session:localStorage.getItem("ynx.wallet.web.session.v1"),accounts:__YNX_QA__.accounts,calls:__YNX_QA__.calls.map(item=>item.method)}));
  assert.equal(result.switchWithoutAccountDisconnected.session,null);
  assert.deepEqual(result.switchWithoutAccountDisconnected.accounts,[]);
  assert.match(result.switchWithoutAccountDisconnected.status,/not connected|disconnected/i);
  assert.doesNotMatch(result.switchWithoutAccountDisconnected.status,/Connected\s*·\s*YNX/);
  await page.locator("#add:not([disabled])").click();
  result.addParams=await page.evaluate(()=>__YNX_QA__.calls.findLast(item=>item.method==="wallet_addEthereumChain")?.params?.[0]);
  assert.equal(result.addParams?.chainId,"0x1917");assert.deepEqual(result.addParams?.rpcUrls,["https://rpc-testnet.ynxweb4.com","https://evm.ynxweb4.com"]);
  await page.evaluate(()=>{__YNX_QA__.authorized=true;localStorage.setItem("__ynx_qa_authorized","1")});await page.locator("#ynx").click();
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("Connected"));
  result.connectedAccount=await page.evaluate(()=>JSON.parse(localStorage.getItem("ynx.wallet.web.session.v1")||"null")?.account);
  assert.equal(result.connectedAccount,account);
  await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("Connected"));
  result.restoredAccount=await page.evaluate(()=>JSON.parse(localStorage.getItem("ynx.wallet.web.session.v1")||"null")?.account);
  assert.equal(result.restoredAccount,account);
  await page.evaluate(()=>{__YNX_QA__.accounts=[]});await page.locator("#network-tools summary").click();await page.locator("#switch:not([disabled])").click();
  result.revokedAfterSwitch=await page.evaluate(()=>({status:document.querySelector("#status")?.textContent,session:localStorage.getItem("ynx.wallet.web.session.v1")}));
  assert.equal(result.revokedAfterSwitch.session,null);assert.match(result.revokedAfterSwitch.status,/ACCOUNT_CHANGED/);
  result.passed=true;
}catch(error){result.error={code:error?.code||null,name:error?.name||"Error",message:error?.message||String(error)}}finally{
  await browser?.close().catch(()=>{});server.closeAllConnections?.();await new Promise(done=>server.close(done)).catch(()=>{});
  await rm(temporary,{recursive:true,force:true}).catch(()=>{});
}
if(process.env.YNX_QA_EVIDENCE_DIR){await mkdir(process.env.YNX_QA_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.YNX_QA_EVIDENCE_DIR,`pwa-page-${browserName}.json`),`${JSON.stringify(result,null,2)}\n`)}
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
