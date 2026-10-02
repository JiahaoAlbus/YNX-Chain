import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

// Production forms/controller in Chromium; controlled API completion only.
// Does not prove Wallet, server authentication or a public business journey.
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const saves=app.slice(app.indexOf('const formSaves='),app.indexOf('function renderStatement('));
const privacy=app.slice(app.indexOf('function renderPrivacy('),app.indexOf('function renderAIRecords('));
test('normal privacy checkbox submit is single-flight and a late read preserves the next unsaved edit',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({content:`
      const state={context:1,connected:true};let browserSSOIntentGeneration=1;
      const $=selector=>document.querySelector(selector);window.calls=[];window.notices=[];
      const financeText=key=>key,notify=value=>notices.push(value),notifyFailure=()=>notices.push('failure');
      const attestBrowserIdentityActivity=async()=>{};
      const api=(path,options)=>new Promise((resolve,reject)=>calls.push({path,body:JSON.parse(options.body),method:options.method,resolve,reject}));
      const load=async()=>renderPrivacy({includePayInStatements:false,allowAiActivityContext:false,alertsEnabled:true});
      ${privacy}${saves}
      window.switchAccount=()=>{state.context++;browserSSOIntentGeneration++;};
      window.proofOfDraft=()=>document.querySelector('#privacy-form input[name=alertsEnabled]').checked;
    `});
    const alerts=page.locator('#privacy-form input[name=alertsEnabled]');
    await alerts.check();await page.locator('#privacy-form button').click();
    await page.evaluate(()=>document.querySelector('#privacy-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(await page.evaluate(()=>calls.length),1);assert.equal(await page.locator('#privacy-form button').isDisabled(),true);
    await alerts.uncheck();await page.evaluate(()=>calls[0].resolve({}));
    await page.waitForFunction(()=>!document.querySelector('#privacy-form button').disabled);
    assert.equal(await alerts.isChecked(),false);assert.deepEqual(await page.evaluate(()=>notices),['privacySaved']);
    await page.locator('#privacy-form button').click();
    await page.evaluate(()=>{switchAccount();calls[1].reject(new Error('old account failure'));});
    await page.waitForFunction(()=>!document.querySelector('#privacy-form').hasAttribute('aria-busy'));
    assert.deepEqual(await page.evaluate(()=>notices),['privacySaved']);assert.equal(await alerts.isChecked(),false);
  }finally{await browser.close();}
});
