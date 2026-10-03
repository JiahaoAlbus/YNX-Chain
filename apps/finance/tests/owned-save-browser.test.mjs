import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

// Production forms/controller in Chromium; controlled API completion only.
// Does not prove Wallet, server authentication or a public business journey.
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const locale=await readFile(new URL('../web/finance-locale.js',import.meta.url),'utf8');
const saves=app.slice(app.indexOf('const formSaves='),app.indexOf('function renderStatement('));
const privacy=app.slice(app.indexOf('function renderPrivacy('),app.indexOf('function renderAIRecords('));
const reportView=app.slice(app.indexOf('let statementOperation='),app.indexOf('function loadStatement('));
test('all twelve locales keep reminder protocol values independent from translated option labels',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addScriptTag({content:locale});
    for(const language of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(language=>window.YNXFinanceLocale.set(language),language);
      for(const [value,key] of [['monthly','monthlyLabel'],['weekly','weeklyLabel'],['custom','customLabel']]){
        await page.locator('#reminder-form select[name=schedule]').selectOption(value);
        assert.deepEqual(await page.evaluate(()=>{const select=document.querySelector('#reminder-form select[name=schedule]');return {value:new FormData(document.querySelector('#reminder-form')).get('schedule'),label:select.selectedOptions[0].textContent};}),{value,label:await page.evaluate(key=>window.YNXFinanceLocale.text(key),key)});
      }
    }
  }finally{await browser.close();}
});
test('normal privacy checkbox submit is single-flight and a late read preserves the next unsaved edit',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({content:locale});
    await page.addScriptTag({content:`
      const state={context:1,connected:true};let browserSSOIntentGeneration=1;
      const $=selector=>document.querySelector(selector),$$=selector=>Array.from(document.querySelectorAll(selector));window.calls=[];window.notices=[];
      const financeText=key=>window.YNXFinanceLocale.text(key),notify=value=>notices.push(value),notifyFailure=()=>notices.push('failure');
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
    for(const language of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(language=>window.YNXFinanceLocale.set(language),language);
      assert.equal(await page.locator('#privacy-form [data-save-state]').innerText(),await page.evaluate(()=>window.YNXFinanceLocale.text('ownedSavePending')));
    }
    await page.evaluate(()=>window.YNXFinanceLocale.set('en'));
    await alerts.uncheck();await page.evaluate(()=>calls[0].resolve({...calls[0].body,updatedAt:'2026-10-03T00:00:00Z'}));
    await page.waitForFunction(()=>!document.querySelector('#privacy-form button').disabled);
    const savedText=await page.evaluate(()=>window.YNXFinanceLocale.text('privacySaved'));
    assert.equal(await alerts.isChecked(),false);assert.deepEqual(await page.evaluate(()=>notices),[savedText]);
    await page.locator('#privacy-form button').click();
    await page.evaluate(()=>{switchAccount();calls[1].reject(new Error('old account failure'));});
    await page.waitForFunction(()=>!document.querySelector('#privacy-form').hasAttribute('aria-busy'));
    assert.deepEqual(await page.evaluate(()=>notices),[savedText]);assert.equal(await alerts.isChecked(),false);
    await page.locator('#privacy-form button').click();await page.evaluate(()=>calls[2].reject(new Error('unavailable')));
    await page.waitForFunction(()=>document.querySelector('#privacy-form [data-save-state]').dataset.saveKey==='ownedSaveUnconfirmed');
    for(const language of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(language=>window.YNXFinanceLocale.set(language),language);
      assert.equal(await page.locator('#privacy-form [data-save-state]').innerText(),await page.evaluate(()=>window.YNXFinanceLocale.text('ownedSaveUnconfirmed')));
      assert.equal(await alerts.isChecked(),false);
    }
  }finally{await browser.close();}
});
test('native-owned planning drafts clear on sign-out and restore only for their verified account',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    const drafts=reportView+app.slice(app.indexOf('const ownedFormDrafts='),app.indexOf('function clearPrivateView('));
    await page.addScriptTag({content:`const state={context:1,connected:true};let browserSSOIntentGeneration=1;const dataDisabledControls=new Map();const $=selector=>document.querySelector(selector),$$=selector=>Array.from(document.querySelectorAll(selector));const financeText=k=>k,notify=()=>{},notifyFailure=()=>{},attestBrowserIdentityActivity=async()=>{},load=async()=>{},api=async()=>{};${saves}${drafts}window.newContext=()=>{state.context++;browserSSOIntentGeneration++;};`});
    await page.evaluate(()=>restoreOwnedFormDrafts('isolated-native-A'));
    await page.locator('#category-form input[name=name]').fill('A unfinished category');
    await page.locator('#budget-form input[name=name]').fill('A unfinished budget');
    await page.locator('#privacy-form input[name=alertsEnabled]').check();
    await page.evaluate(()=>{formUncommittedDrafts.set(document.querySelector('#privacy-form'),{context:state.context});rememberOwnedFormDrafts();newContext();restoreOwnedFormDrafts('isolated-native-B');});
    assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'');assert.equal(await page.locator('#budget-form input[name=name]').inputValue(),'');
    assert.equal(await page.locator('#privacy-form input[name=alertsEnabled]').isChecked(),false);
    await page.locator('#category-form input[name=name]').fill('B unfinished category');
    await page.evaluate(()=>{rememberOwnedFormDrafts();newContext();restoreOwnedFormDrafts('isolated-native-A');});
    assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'A unfinished category');assert.equal(await page.locator('#budget-form input[name=name]').inputValue(),'A unfinished budget');
    assert.equal(await page.locator('#privacy-form input[name=alertsEnabled]').isChecked(),true);
    await page.evaluate(()=>{rememberOwnedFormDrafts();newContext();restoreOwnedFormDrafts('isolated-native-B');});
    assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'B unfinished category');assert.equal(await page.locator('#budget-form input[name=name]').inputValue(),'');
  }finally{await browser.close();}
});
test('normal account switch releases old save controls without letting its late response release a new save',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.name));
    await page.route('**/*',route=>route.request().url()==='https://finance.ynxweb4.com/'?route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}):route.abort());
    await page.goto('https://finance.ynxweb4.com/');
    const drafts=reportView+app.slice(app.indexOf('const ownedFormDrafts='),app.indexOf('function clearPrivateView('));
    await page.addScriptTag({content:`const state={context:1,connected:true};let browserSSOIntentGeneration=1;const dataDisabledControls=new Map();const $=selector=>document.querySelector(selector),$$=selector=>Array.from(document.querySelectorAll(selector));window.calls=[];window.notices=[];const financeText=k=>k,notify=x=>notices.push(x),notifyFailure=()=>notices.push('failure'),attestBrowserIdentityActivity=async()=>{},load=async()=>{};const api=(path,options)=>new Promise((resolve,reject)=>calls.push({path,body:JSON.parse(options.body),resolve,reject}));${saves}${drafts}`});
    await page.evaluate(()=>restoreOwnedFormDrafts('isolated-native-A'));
    await page.locator('#category-form input[name=name]').fill('A category');await page.locator('#category-form button').click();
    assert.equal(await page.locator('#category-form button').isDisabled(),true);
    await page.evaluate(()=>{rememberOwnedFormDrafts();state.context++;browserSSOIntentGeneration++;restoreOwnedFormDrafts('isolated-native-B');});
    assert.equal(await page.locator('#category-form button').isDisabled(),false);
    await page.locator('#category-form input[name=name]').fill('B category');await page.locator('#category-form button').click();
    await page.evaluate(()=>calls[0].resolve({}));
    assert.equal(await page.locator('#category-form button').isDisabled(),true);assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'B category');assert.deepEqual(await page.evaluate(()=>notices),[]);
    await page.evaluate(()=>calls[1].resolve({...calls[1].body,color:calls[1].body.color.toUpperCase(),id:'owned-B',source:'user',createdAt:'2026-10-03T00:00:00Z'}));await page.waitForFunction(()=>!document.querySelector('#category-form button').disabled);
    assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'');assert.deepEqual(await page.evaluate(()=>notices),['profileSaved']);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
test('actual category form preserves draft and exact idempotency key after an invalid successful response',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.request().url()==='https://finance.ynxweb4.com/'?route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}):route.abort());
    await page.goto('https://finance.ynxweb4.com/');await page.addScriptTag({content:locale});
    await page.addScriptTag({content:`const state={context:1,connected:true};let browserSSOIntentGeneration=1;const $=selector=>document.querySelector(selector),$$=selector=>Array.from(document.querySelectorAll(selector));window.calls=[];window.notices=[];window.reads=0;const financeText=k=>window.YNXFinanceLocale.text(k),notify=x=>notices.push(x),notifyFailure=()=>notices.push('unconfirmed'),attestBrowserIdentityActivity=async()=>{},load=async()=>{reads++};const api=(path,options)=>new Promise(resolve=>calls.push({path,body:JSON.parse(options.body),resolve}));${saves}`});
    const input=page.locator('#category-form input[name=name]'),button=page.locator('#category-form button');await input.fill('Reviewed category');await button.click();
    await page.evaluate(()=>calls[0].resolve({}));await page.waitForFunction(()=>!document.querySelector('#category-form button').disabled);
    assert.equal(await input.inputValue(),'Reviewed category');assert.deepEqual(await page.evaluate(()=>notices),['unconfirmed']);assert.equal(await page.evaluate(()=>reads),0);
    await button.click();assert.deepEqual(await page.evaluate(()=>calls[1].body),await page.evaluate(()=>calls[0].body));
    await page.evaluate(()=>calls[1].resolve({...calls[1].body,color:calls[1].body.color.toUpperCase(),id:'verified-category',source:'user',createdAt:'2026-10-03T00:00:00Z'}));await page.waitForFunction(()=>!document.querySelector('#category-form button').disabled);
    assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>reads),1);assert.equal((await page.evaluate(()=>notices)).length,2);
  }finally{await browser.close()}
});
