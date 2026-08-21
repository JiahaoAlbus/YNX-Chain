const {spawn}=require("node:child_process");
const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require("playwright");

const root=path.resolve(__dirname,"../../..");
const port=18295;
const base=`http://127.0.0.1:${port}`;
const artifact=path.join(__dirname,"artifacts");
fs.mkdirSync(artifact,{recursive:true});
const visibleEvidence=path.join(__dirname,"../evidence/visible");
fs.mkdirSync(visibleEvidence,{recursive:true});
const stateDir=fs.mkdtempSync("/tmp/ynx-ai-browser-");
const proc=spawn("go",["run","./apps/ai"],{cwd:root,env:{...process.env,YNX_AI_CLIENT_HTTP_ADDR:`127.0.0.1:${port}`,YNX_AI_CLIENT_STATE_PATH:path.join(stateDir,"state.json"),YNX_AI_CLIENT_CONTENT_KEY:"0808080808080808080808080808080808080808080808080808080808080808",YNX_AI_CLIENT_GATEWAY_URL:"http://127.0.0.1:1",YNX_AI_GATEWAY_API_KEY:"browser-proof-unreachable"},stdio:"inherit",detached:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(){for(let i=0;i<80;i++){try{if((await fetch(`${base}/api/meta`)).ok)return}catch{}await sleep(150)}throw Error("AI server did not start")}
async function assertPage(page){
 const unnamed=await page.evaluate(()=>[...document.querySelectorAll("button,a,input,select,textarea")].filter(el=>!(el.labels?.length||((el.getAttribute("aria-label")||el.textContent||el.getAttribute("placeholder")||"").trim()))).map(el=>el.outerHTML.slice(0,120)));
 if(unnamed.length)throw Error(`unnamed controls: ${unnamed.join(",")}`);
}
(async()=>{
 let browser;
 try{
  await wait();browser=await chromium.launch({headless:true});
  for(const config of [{name:"guest-desktop",width:1440,height:900},{name:"guest-mobile",width:390,height:844}]){
   const context=await browser.newContext({viewport:{width:config.width,height:config.height},reducedMotion:"reduce"});
   const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
   await page.goto(base,{waitUntil:"networkidle"});await page.locator("#guest-preview").click();await page.locator("#app:not(.hidden)").waitFor();
   await page.locator("#account-label").getByText("Guest preview").waitFor();
   await assertPage(page);if(errors.length)throw Error(errors.join("; "));
   await page.screenshot({path:path.join(artifact,`ai-${config.name}.png`),fullPage:true});await context.close();
  }
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:"reduce"});
  await context.addInitScript(()=>{
   const account="0x1234567890abcdef1234567890abcdef12345678";
   const provider={request:async({method})=>{if(method==="eth_requestAccounts")return[account];if(method==="eth_chainId")return"0x1917";if(method==="wallet_switchEthereumChain"||method==="wallet_addEthereumChain")return null;throw Object.assign(new Error("unsupported"),{code:4200})}};
   addEventListener("eip6963:requestProvider",()=>dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid:"ynx-browser-proof",name:"YNX Wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:"com.ynx.wallet"},provider}})));
  });
  const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base,{waitUntil:"networkidle"});await page.locator("#connect-ynx-wallet").click();
  await page.locator("#app:not(.hidden)").waitFor();
  const state=await page.locator("#conversation-kicker").textContent();if(!state.includes("Standard Wallet connected"))throw Error(`unexpected wallet state: ${state}`);
  const connectedAccount=await page.locator("#account-label").textContent();if(!connectedAccount.includes("0x123456"))throw Error(`unexpected connected account: ${connectedAccount}`);
  await assertPage(page);if(errors.length)throw Error(errors.join("; "));
  await page.screenshot({path:path.join(artifact,"ai-wallet-connected-private-degraded.png"),fullPage:true});
  await page.screenshot({path:path.join(visibleEvidence,"ai-wallet-approved-private-degraded-1440x900.png"),fullPage:true});
  await context.close();
  const rejectedContext=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:"reduce"});
  await rejectedContext.addInitScript(()=>{
   const provider={request:async({method})=>{if(method==="eth_requestAccounts")throw Object.assign(new Error("User rejected the request"),{code:4001});if(method==="eth_chainId")return"0x1917";throw Object.assign(new Error("unsupported"),{code:4200})}};
   addEventListener("eip6963:requestProvider",()=>dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid:"ynx-browser-reject",name:"YNX Wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:"com.ynx.wallet"},provider}})));
  });
  const rejectedPage=await rejectedContext.newPage(),rejectedErrors=[];rejectedPage.on("pageerror",error=>rejectedErrors.push(error.message));
  await rejectedPage.goto(base,{waitUntil:"networkidle"});await rejectedPage.locator("#connect-ynx-wallet").click();
  await rejectedPage.locator("#wallet-standard-state").filter({hasText:/WALLET_USER_REJECTED|rejected/i}).waitFor();
  if(!(await rejectedPage.locator("#app").getAttribute("class")).includes("hidden"))throw Error("rejected Wallet unexpectedly opened a private AI workspace");
  if(!(await rejectedPage.locator("#guest-preview").isVisible()))throw Error("guest AI preview is not available after rejection");
  await assertPage(rejectedPage);if(rejectedErrors.length)throw Error(rejectedErrors.join("; "));
  await rejectedPage.screenshot({path:path.join(visibleEvidence,"ai-wallet-rejected-guest-preview-1440x900.png"),fullPage:true});
  await rejectedContext.close();
  console.log(JSON.stringify({product:"ai",guestDesktop:true,guestMobile:true,standardWalletConnected:true,standardWalletRejected:true,privateProductSession:"DEGRADED",generationLive:false,consoleErrors:0,computerControl:false}));
 }finally{if(browser)await browser.close();try{process.kill(-proc.pid,"SIGTERM")}catch{proc.kill()}}
})().catch(error=>{console.error(error);process.exitCode=1});
