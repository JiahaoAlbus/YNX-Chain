import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {mkdir,readFile,stat,writeFile} from "node:fs/promises";
import {dirname,extname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const publicRoot=join(root,"dist","pwa");
const evidenceDir=join(root,"evidence","browser");
const screenshotPath=join(evidenceDir,"wallet-web-mobile-routing-fail-closed-390-20260815.png");
const evidencePath=join(evidenceDir,"wallet-web-mobile-routing-fail-closed-390-20260815.json");
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".webmanifest":"application/manifest+json"};
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label} timed out`)),ms))]);
const server=createServer(async(request,response)=>{try{const url=new URL(request.url,"http://local"),name=url.pathname==="/"?"index.html":url.pathname.slice(1),path=join(publicRoot,name),body=await readFile(path);response.writeHead(200,{"content-type":types[extname(path)]||"application/octet-stream","cache-control":"no-store"});response.end(body)}catch{response.writeHead(404);response.end()}});
await mkdir(evidenceDir,{recursive:true});
await bounded(new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveListen)}),3000,"local server");
let browser;
const evidence={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),runtimeClass:"Playwright Chromium Pixel 9-sized external mobile browser with controlled RPC transport failure; not a physical device or public service success",viewport:{width:390,height:844},passed:false,providerInjected:false,ynxAuthorizationOpened:false,metaMaskOpened:false,account:false,sign:false,transaction:false,testnetConnected:false,deployedPublic:false};
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},userAgent:"Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile Safari/537.36"});
  await context.route("https://rpc.ynxweb4.com/evm",route=>route.abort("connectionfailed"));
  const page=await context.newPage();
  await bounded(page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:"networkidle"}),10000,"mobile page");
  const ynx=page.locator("#ynx"),download=page.locator("#download"),metamask=page.locator("#metamask");
  evidence.presentation={
    ynxVisible:await ynx.isVisible(),ynxRoute:await ynx.getAttribute("data-route"),
    downloadVisible:await download.isVisible(),metaMaskVisible:await metamask.isVisible(),
    metaMaskRoute:await metamask.getAttribute("data-route"),metaMaskHref:await metamask.getAttribute("href"),
  };
  evidence.actions=Object.fromEntries(await Promise.all(["add","switch","sign","send"].map(async id=>[id,await page.locator(`#${id}`).isDisabled()])));
  await ynx.click();
  evidence.ynxStatus=await page.locator("#status").innerText();
  await page.screenshot({path:screenshotPath,fullPage:true});
  const screenshot=await readFile(screenshotPath),info=await stat(screenshotPath);
  evidence.screenshot={path:"evidence/browser/wallet-web-mobile-routing-fail-closed-390-20260815.png",bytes:info.size,sha256:createHash("sha256").update(screenshot).digest("hex")};
  evidence.passed=evidence.presentation.ynxVisible&&evidence.presentation.ynxRoute==="canonical-auth-unavailable"&&evidence.presentation.downloadVisible&&evidence.presentation.metaMaskVisible&&evidence.presentation.metaMaskRoute==="mobile-dapp"&&evidence.presentation.metaMaskHref==="https://metamask.app.link/dapp/www.ynxweb4.com/dapp/wallet"&&Object.values(evidence.actions).every(Boolean)&&evidence.ynxStatus.includes("CANONICAL_AUTH_UNAVAILABLE");
  await context.close();
}catch(error){evidence.failure={name:error?.name||"Error",message:error?.message||String(error)}}finally{await browser?.close().catch(()=>{});server.close();await writeFile(evidencePath,`${JSON.stringify(evidence,null,2)}\n`)}
console.log(JSON.stringify(evidence,null,2));
process.exit(evidence.passed?0:1);
