import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {createPwaUpgradeHarness} from "./pwa-upgrade-browser-harness.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),profile=await mkdtemp(join(tmpdir(),"ynx-real-v8-upgrade-"));
const evidencePath=join(root,"evidence/runtime/pwa-v8-to-build-upgrade.json");
const fixture=await createPwaUpgradeHarness({port:0});
const result={schemaVersion:3,generatedAt:new Date().toISOString(),runtimeClass:"isolated Playwright Chromium-compatible profile running the exact git 2f55f7924 v8 service worker, upgraded to the current build; not installed PWA or public deployment",legacyWorkerSha256:fixture.metadata().bundles["legacy-v8"].workerSha256,passed:false,installedLocal:false,deployedPublic:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,productSessionCreated:false};
let context;
async function open(){context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1100,height:850},timeout:15000});const page=context.pages()[0]||await context.newPage();await page.goto(fixture.url,{waitUntil:"domcontentloaded",timeout:10000});await page.waitForFunction(()=>Boolean(window.pwaUpgradeQA));return page}
async function ready(page){await page.waitForFunction(()=>document.querySelector('#wallet').contentWindow.document.documentElement.dataset.pwa==='ready',{},{timeout:20000});return page.evaluate(()=>window.pwaUpgradeQA.snapshot())}
try{
  let page=await open();
  result.beforeUpgrade=await page.evaluate(()=>window.pwaUpgradeQA.install("legacy-v8"));
  if(!result.beforeUpgrade.page.controllerScript||!result.beforeUpgrade.builds["legacy-v8"].complete)throw new Error("Actual v8 worker did not control the complete historical shell");
  await page.evaluate(()=>window.pwaUpgradeQA.update("candidate-a"));
  result.afterUpgrade=await ready(page);
  await page.evaluate(()=>window.pwaUpgradeQA.update("candidate-b-broken"));
  await page.waitForFunction(async()=>!(await navigator.serviceWorker.getRegistration(new URL('/wallet/',location.href))).installing,{},{timeout:10000});
  result.failedUpgrade=await page.evaluate(()=>window.pwaUpgradeQA.snapshot());
  await page.evaluate(()=>window.pwaUpgradeQA.phase("candidate-a"));
  await context.close();context=null;
  page=await open();await page.evaluate(()=>window.pwaUpgradeQA.reload());result.secondLaunch=await ready(page);
  const expected=fixture.metadata().bundles["candidate-a"].cache;
  result.passed=[result.afterUpgrade,result.failedUpgrade,result.secondLaunch].every(value=>value.page.controllerVersion===expected&&value.builds["candidate-a"].complete)&&!result.afterUpgrade.builds["legacy-v8"].present&&!result.failedUpgrade.builds["candidate-b"].present;
}catch(error){result.error={name:error.name,message:error.message}}
finally{if(context)await context.close().catch(()=>{});await fixture.close();await rm(profile,{recursive:true,force:true})}
await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
