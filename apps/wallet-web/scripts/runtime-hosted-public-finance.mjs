import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=resolve(process.env.YNX_HOSTED_PUBLIC_EVIDENCE_PATH||resolve(root,"evidence/runtime/hosted-public-finance-20260925.json"));
const financeOrigin="https://finance.ynxweb4.com",walletOrigin="https://wallet.ynxweb4.com";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const result={schemaVersion:1,generatedAt:new Date().toISOString(),browser:{name:"Chrome for Testing",version:null},runtimeClass:"real public HTTPS Finance and Hosted Wallet in disposable browser contexts; no response routes or provider injection",publicFinance:financeOrigin,publicWallet:`${walletOrigin}/hosted/`,passed:false,steps:[],assets:{},popupOriginBound:false,newVaultCreated:false,encryptedBackupDownloaded:false,rejectedBeforeConnection:false,approvedSameAccount:false,financeDisconnected:false,reopenedSameAccount:false,backupRestoredSameAccount:false,privateFinanceAuthorized:false,signatureRequested:false,transactionSubmitted:false};
const started=Date.now(),step=name=>result.steps.push({name,elapsedMs:Date.now()-started});
const password=randomBytes(24).toString("base64url");
let browser,backupBytes,account;
const inspect=async response=>({status:response?.status()??null,sha256:response?sha(await response.body()):null});
const state=page=>page.evaluate(()=>window.YNXFinanceWallet?.getStandardWalletState?.());
const hosted=page=>page.evaluate(()=>window.YNXFinanceHostedWallet?.getState?.());
async function popupFrom(page,context){
  const opened=context.waitForEvent("page",{timeout:20000});
  await page.locator("#connect-hosted-ynx").click();
  const popup=await opened;
  await popup.waitForLoadState("domcontentloaded");
  assert.equal(new URL(popup.url()).origin,walletOrigin);
  assert.equal(new URL(popup.url()).pathname,"/hosted/");
  assert.equal((await popup.locator("#product-origin").textContent())?.trim(),financeOrigin);
  result.popupOriginBound=true;
  return popup;
}
try{
  browser=await chromium.launch({headless:true});
  result.browser.version=browser.version();
  const context=await browser.newContext({acceptDownloads:true,ignoreHTTPSErrors:false});
  const finance=await context.newPage();
  const financeResponse=await finance.goto(financeOrigin,{waitUntil:"domcontentloaded",timeout:30000});
  result.assets.financeDocument=await inspect(financeResponse);
  assert.equal(result.assets.financeDocument.status,200);
  await finance.waitForFunction(()=>Boolean(window.YNXFinanceHostedWallet?.getState));
  step("finance-public-loaded");

  const first=await popupFrom(finance,context);
  const hostedResponse=await first.request.get(`${walletOrigin}/hosted/`);
  result.assets.hostedDocument={status:hostedResponse.status(),sha256:sha(await hostedResponse.body())};
  assert.equal(result.assets.hostedDocument.status,200);
  await first.locator("#setup").waitFor({state:"visible"});
  await first.locator("#setup-password").fill(password);
  await first.locator("#setup-confirm").fill(password);
  await first.locator("#setup-form button[type=submit]").click();
  await first.locator("#backup-confirmation").waitFor({state:"visible"});
  result.newVaultCreated=true;
  const downloadReady=first.waitForEvent("download");
  await first.locator("#export-backup").click();
  const download=await downloadReady;
  assert.match(download.suggestedFilename(),/^ynx-wallet-encrypted-0x[0-9a-f]{40}\.json$/u);
  backupBytes=await readFile(await download.path());
  assert.ok(backupBytes.length>=100&&backupBytes.length<=20_000);
  result.encryptedBackupDownloaded=true;
  await first.locator("#backup-ack").check();
  await first.locator("#backup-continue").click();
  await first.locator("#review").waitFor({state:"visible"});
  account=(await first.locator("#account-evm").textContent())?.toLowerCase();
  assert.match(account||"",/^0x[0-9a-f]{40}$/u);
  result.account=account;
  await first.locator("#reject").click();
  await finance.waitForFunction(()=>window.YNXFinanceHostedWallet?.getState?.().status==="rejected");
  result.rejectedBeforeConnection=(await state(finance))?.status!=="connected"&&(await hosted(finance)).account===null;
  step("first-request-rejected");

  const second=await popupFrom(finance,context);
  await second.locator("#review").waitFor({state:"visible"});
  assert.equal((await second.locator("#account-evm").textContent())?.toLowerCase(),account);
  await second.locator("#approve").click();
  await finance.waitForFunction(()=>window.YNXFinanceHostedWallet?.getState?.().status==="connected");
  const approved=await state(finance),hostedApproved=await hosted(finance);
  result.approvedSameAccount=approved?.status==="connected"&&approved.transport==="hosted-wallet-web"&&approved.account===account&&approved.chainId==="0x1917"&&hostedApproved.account===account;
  result.approvedState={status:approved?.status,transport:approved?.transport,account:approved?.account,chainId:approved?.chainId};
  step("second-request-approved");

  await finance.locator("#disconnect-hosted-ynx").click();
  await finance.waitForFunction(()=>window.YNXFinanceHostedWallet?.getState?.().status==="disconnected");
  result.financeDisconnected=(await state(finance))?.status!=="connected"&&(await hosted(finance)).account===null;
  step("finance-disconnected");

  const third=await popupFrom(finance,context);
  await third.locator("#review").waitFor({state:"visible"});
  assert.equal((await third.locator("#account-evm").textContent())?.toLowerCase(),account);
  await third.locator("#approve").click();
  await finance.waitForFunction(()=>window.YNXFinanceHostedWallet?.getState?.().status==="connected");
  result.reopenedSameAccount=(await state(finance))?.account===account&&(await state(finance))?.chainId==="0x1917";
  step("reopened-same-account");

  await context.close();
  const restoredContext=await browser.newContext({acceptDownloads:true,ignoreHTTPSErrors:false});
  const restoredFinance=await restoredContext.newPage();
  assert.equal((await restoredFinance.goto(financeOrigin,{waitUntil:"domcontentloaded",timeout:30000}))?.status(),200);
  await restoredFinance.waitForFunction(()=>Boolean(window.YNXFinanceHostedWallet?.getState));
  const restoredWallet=await popupFrom(restoredFinance,restoredContext);
  await restoredWallet.locator("#setup").waitFor({state:"visible"});
  await restoredWallet.locator("#backup-import-file").setInputFiles({name:"ynx-wallet-encrypted.json",mimeType:"application/json",buffer:backupBytes});
  await restoredWallet.locator("#backup-import-password").fill(password);
  await restoredWallet.locator("#backup-import-confirm").check();
  await restoredWallet.locator("#backup-import-form button[type=submit]").click();
  await restoredWallet.locator("#review").waitFor({state:"visible"});
  assert.equal((await restoredWallet.locator("#account-evm").textContent())?.toLowerCase(),account);
  await restoredWallet.locator("#approve").click();
  await restoredFinance.waitForFunction(()=>window.YNXFinanceHostedWallet?.getState?.().status==="connected");
  result.backupRestoredSameAccount=(await state(restoredFinance))?.account===account&&(await state(restoredFinance))?.chainId==="0x1917";
  step("encrypted-backup-restored-same-account");
  await restoredContext.close();
  result.passed=result.popupOriginBound&&result.newVaultCreated&&result.encryptedBackupDownloaded&&result.rejectedBeforeConnection&&result.approvedSameAccount&&result.financeDisconnected&&result.reopenedSameAccount&&result.backupRestoredSameAccount;
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:String(error?.message||error).slice(0,240)};}
finally{backupBytes=null;await browser?.close().catch(()=>{});}
await mkdir(dirname(evidencePath),{recursive:true});
await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result,null,2));
process.exit(result.passed?0:1);
