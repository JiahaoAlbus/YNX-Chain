import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {chromium} from "playwright";
import {p256} from "@noble/curves/nist.js";
import registry from "../vendor/product-session-registry-b754ffc42.json" with {type:"json"};
import {createProductSessionRequest,encodeProductSessionWalletURL,parseProductSessionReturnURL} from "@ynx-chain/wallet-auth-card-provider-v2";

const browserName=process.env.YNX_BROWSER||"chromium";
const executablePath=browserName==="edge"?"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge":chromium.executablePath();
const extensionPath=resolve("dist/chromium"),temporary=await mkdtemp(join(tmpdir(),"ynx-private-v2-"));
const evidenceDir=resolve("evidence/private-v2");
const password="ynx-disposable-private-test-password",secret=randomBytes(32).toString("hex"),origin="https://card.ynxweb4.com";
const deviceKey=Buffer.from(p256.getPublicKey(Buffer.alloc(32,0x42),true)).toString("base64url");
const scopes=["account:read","card:application:write","card:controls:write","card:finance:share"];
const html='<!doctype html><html><head><meta charset="utf-8"></head><body><script>globalThis.providers=[];addEventListener("eip6963:announceProvider",e=>providers.push(e.detail.provider));dispatchEvent(new Event("eip6963:requestProvider"));</script></body></html>';
let browser;
const result={browser:browserName,fixtureOrigin:origin,fixtureOnly:true,gatewayVerified:false,passed:false};
function request(){const at=new Date(),token=()=>randomBytes(32).toString("base64url");const value=createProductSessionRequest(registry,{productId:"card",platform:"web",deviceId:`web_${token()}`,deviceKey,scopes,purpose:"Allow Card to manage your separately selected read-only sharing with YNX Finance. This grants no payment or trading authority.",nonce:token(),state:token()},at);return{value,url:encodeProductSessionWalletURL(registry,value,at)}}
async function popup(){for(let i=0;i<100;i++){const found=browser.pages().find(page=>page.url().includes("/private-approval.html?"));if(found){await found.locator("#approve:not([disabled])").waitFor({timeout:5000});return found}await new Promise(resolveWait=>setTimeout(resolveWait,50))}throw Error("Private approval popup did not open")}
async function ask(page,url){return page.evaluate(async value=>{const provider=providers.find(item=>item?.isYNXWallet);try{return{ok:true,result:await provider.requestProductSessionV2(value)}}catch(error){return{ok:false,code:error.code,message:error.message}}},url)}
try{
  browser=await chromium.launchPersistentContext(join(temporary,"profile"),{executablePath,headless:true,ignoreHTTPSErrors:true,ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]});
  let worker=browser.serviceWorkers()[0];if(!worker)worker=await browser.waitForEvent("serviceworker",{timeout:10000});
  const extensionOrigin=worker.url().replace(/\/service-worker\.js$/u,"");
  const vault=await browser.newPage();await vault.goto(`${extensionOrigin}/vault.html`);await vault.locator("#password").fill(password);await vault.locator("#secret").fill(secret);await vault.locator("#prepare").click();await vault.locator("#save:not([disabled])").click();await vault.waitForFunction(()=>/^0x[0-9a-f]{40}$/u.test(document.querySelector("#evm-account")?.textContent||""));await vault.close();
  await browser.route(`${origin}/**`,route=>route.fulfill({status:200,contentType:"text/html",body:html}));
  const page=await browser.newPage();await page.goto(`${origin}/fixture`);await page.waitForFunction(()=>providers.some(item=>item?.isYNXWallet));
  const initialAccounts=await page.evaluate(()=>providers.find(item=>item?.isYNXWallet).request({method:"eth_accounts"}));assert.deepEqual(initialAccounts,[]);
  const first=request(),firstResult=ask(page,first.url).catch(error=>({ok:false,code:"EVALUATION_FAILED",message:error.message})),firstPopup=await popup();
  assert.match(await firstPopup.locator("#scope-ids").textContent(),/card:finance:share/u);
  assert.match(await firstPopup.locator("#product").textContent(),/YNX Card/u);
  if((await firstPopup.locator("#title").textContent())!=="Allow this product?")await firstPopup.locator("#language").click();
  assert.match(await firstPopup.locator("#scopes").textContent(),/Share Card data with Finance/u);
  await mkdir(evidenceDir,{recursive:true});await firstPopup.screenshot({path:join(evidenceDir,`${browserName}-en.png`),fullPage:true});
  await firstPopup.locator("#language").click();assert.equal(await firstPopup.locator("#title").textContent(),"允许该产品访问吗？");assert.match(await firstPopup.locator("#scopes").textContent(),/向 Finance 共享 Card 数据/u);
  await firstPopup.screenshot({path:join(evidenceDir,`${browserName}-zh.png`),fullPage:true});await firstPopup.locator("#language").click();result.bilingualReviewRendered=true;
  await firstPopup.locator("#password").fill(password);await firstPopup.locator("#approve").click();const approved=await firstResult;
  assert.equal(approved.ok,true,JSON.stringify(approved));assert.equal(approved.result.version,2);
  assert.equal(parseProductSessionReturnURL(registry,first.value,approved.result.returnUrl).status,"ready");
  result.approvedSignedReturn=true;
  const afterPrivateAccounts=await page.evaluate(()=>providers.find(item=>item?.isYNXWallet).request({method:"eth_accounts"}));assert.deepEqual(afterPrivateAccounts,[]);result.standardAccountRemainsDisconnected=true;
  const repeated=await ask(page,first.url);assert.equal(repeated.code,"PRIVATE_REQUEST_REPLAYED");result.replayRejected=true;
  const foreignOrigin="https://finance.ynxweb4.com";await browser.route(`${foreignOrigin}/**`,route=>route.fulfill({status:200,contentType:"text/html",body:html}));
  const foreignPage=await browser.newPage();await foreignPage.goto(`${foreignOrigin}/fixture`);await foreignPage.waitForFunction(()=>providers.some(item=>item?.isYNXWallet));
  const foreign=await ask(foreignPage,request().url);assert.equal(foreign.code,"PRIVATE_ORIGIN_MISMATCH");result.foreignOriginRejected=true;await foreignPage.close();await page.bringToFront();
  const second=request(),secondResult=ask(page,second.url),secondPopup=await popup();await secondPopup.locator("#reject").click();const rejected=await secondResult;
  assert.equal(rejected.ok,true);assert.equal(parseProductSessionReturnURL(registry,second.value,rejected.result.returnUrl).status,"user-rejected");result.explicitReject=true;
  const third=request(),thirdResult=ask(page,third.url).catch(()=>({ok:false,code:"PAGE_CONTEXT_DESTROYED"})),thirdPopup=await popup();await page.reload();await page.waitForFunction(()=>providers.some(item=>item?.isYNXWallet));
  assert.equal((await thirdResult).ok,false);if(!thirdPopup.isClosed())await thirdPopup.waitForEvent("close",{timeout:5000});result.oldDocumentCancelled=true;
  assert.equal((await ask(page,third.url)).code,"PRIVATE_REQUEST_REPLAYED");result.restoredPendingNeedsFreshRequest=true;
  const fourth=request(),fourthResult=ask(page,fourth.url),fourthPopup=await popup();await fourthPopup.locator("#reject").click();assert.equal((await fourthResult).ok,true);result.freshRequestAfterReload=true;
  const closed=request(),closedResult=ask(page,closed.url),closedPopup=await popup();await closedPopup.close();assert.equal((await closedResult).code,"PRIVATE_APPROVAL_CLOSED");result.windowCloseCancelled=true;
  const fifth=request(),fifthResult=ask(page,fifth.url),fifthPopup=await popup();
  const replacement=await browser.newPage();await replacement.goto(`${extensionOrigin}/vault.html`);await replacement.locator("#password").fill(password);await replacement.locator("#secret").fill(randomBytes(32).toString("hex"));await replacement.locator("#prepare").click();await replacement.locator("#save:not([disabled])").click();
  const accountChanged=await fifthResult;assert.ok(["PRIVATE_TAB_CHANGED","PROVIDER_ACCOUNT_CHANGED"].includes(accountChanged.code));result.vaultNavigationCancelled=true;
  if(!fifthPopup.isClosed())await fifthPopup.waitForEvent("close",{timeout:5000});await replacement.close();
  result.passed=true;
}finally{await browser?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true})}
await writeFile(join(evidenceDir,`${browserName}-summary.json`),`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result));
