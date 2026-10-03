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
const saves=app.slice(app.indexOf('function financeTimestampValid('),app.indexOf('const date='))+app.slice(app.indexOf('const formSaves='),app.indexOf('function renderStatement('));
const privacy=app.slice(app.indexOf('function renderPrivacy('),app.indexOf('function renderAIRecords('));
const reportView=app.slice(app.indexOf('let statementOperation='),app.indexOf('function loadStatement('));
const aiViewRetirement=app.slice(app.indexOf('let ownedAIGeneration='),app.indexOf('function ownedAIContext('));
test('statement dates fail closed before showing coverage and explicit read recovers in real Chrome',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addScriptTag({content:locale});
    const helpers=app.slice(app.indexOf('const esc='),app.indexOf('const wait='));
    const statement=app.slice(app.indexOf('function renderStatement('),app.indexOf('const ownedExportOperations='));
    await page.addScriptTag({content:`const state={context:1,overview:{portfolio:{account:'controlled-statement-owner'}},statement:null,statementError:false};let browserSSOIntentGeneration=1;const $=s=>document.querySelector(s);const financeText=k=>YNXFinanceLocale.text(k);window.calls=[];window.failures=[];const notifyFailure=()=>failures.push('read-failed');const api=path=>new Promise(resolve=>calls.push({path,resolve}));function formDraft(form){return JSON.stringify(Array.from(new FormData(form)))}${helpers}${statement}window.statementQA={state};`});
    await page.locator('#statement-form input[name=from]').fill('2026-03-02');await page.locator('#statement-form input[name=to]').fill('2026-03-02');
    const submit=()=>page.evaluate(()=>document.querySelector('#statement-form').dispatchEvent(new Event('submit',{cancelable:true})));
    const respond=(index,patch)=>page.evaluate(({index,patch})=>{
      const url=new URL(calls[index].path,'https://local-fixture.invalid');
      calls[index].resolve({schemaVersion:'finance-statement-v2',coverageComplete:false,account:'controlled-statement-owner',network:'YNX Testnet',symbol:'YNXT',from:url.searchParams.get('from'),toExclusive:url.searchParams.get('to'),activity:[],totals:{incomingYnxt:null,outgoingYnxt:null,feesYnxt:null},calculationStatus:'partial',observedTotals:{incomingYnxt:0,outgoingYnxt:0,feesYnxt:0},openingBalance:'unknown',coverage:'Controlled partial local receipt, not full history',...patch});
    },{index,patch});
    await submit();await respond(0,{from:'2026-02-30T00:00:00Z'});
    await page.waitForFunction(()=>!document.querySelector('#statement-form').hasAttribute('aria-busy'));
    assert.equal(await page.locator('#statement').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('unavailable')));
    assert.equal(await page.evaluate(()=>statementQA.state.statement),null);
    await submit();await respond(1,{});await page.waitForFunction(()=>statementQA.state.statement!==null);
    assert.match(await page.locator('#statement').innerText(),/Controlled partial local receipt/);
    assert.equal(await page.evaluate(()=>statementQA.state.statement.coverageComplete),false);
    await page.locator('#statement-form input[name=from]').fill('2024-02-29');await page.locator('#statement-form input[name=to]').fill('2024-02-29');
    await submit();await respond(2,{from:'2024-02-29T08:00:00+08:00',toExclusive:'2024-03-01T08:00:00+08:00'});
    await page.waitForFunction(()=>statementQA.state.statement?.from==='2024-02-29T08:00:00+08:00');
    assert.equal(await page.evaluate(()=>calls.length),3);assert.equal(await page.evaluate(()=>calls.every(c=>c.path.startsWith('/api/statements?'))),true);
    assert.deepEqual(await page.evaluate(()=>failures),['read-failed']);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
    for(const language of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(language=>YNXFinanceLocale.set(language),language);
      let index=await page.evaluate(()=>calls.length);
      await submit();await respond(index,{observedTotals:{incomingYnxt:1,outgoingYnxt:0,feesYnxt:0}});
      await page.waitForFunction(()=>!document.querySelector('#statement-form').hasAttribute('aria-busy'));
      assert.equal(await page.locator('#statement').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('unavailable')));
      assert.equal(await page.evaluate(()=>statementQA.state.statement),null);
      index=await page.evaluate(()=>calls.length);
      await submit();await respond(index,{});await page.waitForFunction(()=>statementQA.state.statement!==null);
      const text=await page.locator('#statement').innerText();
      assert.ok(text.includes(await page.evaluate(()=>YNXFinanceLocale.text('unknown'))));
      assert.ok(!text.includes(await page.evaluate(()=>YNXFinanceLocale.text('dateUnavailable'))));
      assert.equal(await page.evaluate(()=>statementQA.state.statement.coverageComplete),false);
    }
    assert.equal(await page.evaluate(()=>calls.length),27);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
  }finally{await browser.close()}
});
test('invalid calendar receipt preserves the visible draft and same retry request in real Chrome',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.abort());await page.route('https://finance-calendar-save.test/',route=>route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}));await page.goto('https://finance-calendar-save.test/');await page.addScriptTag({content:locale});
    await page.addScriptTag({content:`const state={context:1,connected:true};let browserSSOIntentGeneration=1;const dataDisabledControls=new Map();const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));window.calls=[];window.reads=0;const financeText=k=>YNXFinanceLocale.text(k),notify=()=>{},notifyFailure=()=>{},attestBrowserIdentityActivity=async()=>{},load=async()=>{reads++};const api=(path,options)=>new Promise(resolve=>calls.push({path,body:JSON.parse(options.body),resolve}));${saves}`});
    await page.locator('#category-form input[name=name]').fill('Retain my category');
    const submit=()=>page.evaluate(()=>document.querySelector('#category-form').dispatchEvent(new Event('submit',{cancelable:true})));
    await submit();await page.evaluate(()=>calls[0].resolve({...calls[0].body,id:'controlled-category',source:'user',color:calls[0].body.color.toUpperCase(),createdAt:'2026-02-30T00:00:00Z'}));
    await page.waitForFunction(()=>!document.querySelector('#category-form').hasAttribute('aria-busy'));
    assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'Retain my category');
    assert.equal(await page.locator('#category-form [data-save-state]').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('ownedSaveUnconfirmed')));
    assert.equal(await page.evaluate(()=>reads),0);await submit();
    assert.deepEqual(await page.evaluate(()=>calls[1].body),await page.evaluate(()=>calls[0].body));
    await page.evaluate(()=>calls[1].resolve({...calls[1].body,id:'controlled-category',source:'user',color:calls[1].body.color.toUpperCase(),createdAt:'2024-02-29T00:00:00+08:00'}));
    await page.waitForFunction(()=>!document.querySelector('#category-form').hasAttribute('aria-busy'));
    assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'');assert.equal(await page.evaluate(()=>reads),1);assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});
test('real Chrome retains confirmed save status across failed follow-up read and locale changes without another POST',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
    await page.route('https://finance-confirmed-save.test/',route=>route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}));
    await page.goto('https://finance-confirmed-save.test/');await page.addScriptTag({content:locale});
    await page.addScriptTag({content:`const state={context:1,connected:true};let browserSSOIntentGeneration=1;const dataDisabledControls=new Map();const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));window.calls=[];window.reads=0;window.failures=[];const financeText=k=>YNXFinanceLocale.text(k),notify=()=>{},notifyFailure=(e,key)=>failures.push(key),attestBrowserIdentityActivity=async()=>{},load=async()=>{reads++;throw Error('Controlled overview unavailable')};const api=(path,options)=>new Promise(resolve=>calls.push({path,body:JSON.parse(options.body),resolve}));${saves}`});
    await page.locator('#category-form input[name=name]').fill('Confirmed category');
    await page.evaluate(()=>document.querySelector('#category-form').dispatchEvent(new Event('submit',{cancelable:true})));
    await page.evaluate(()=>calls[0].resolve({...calls[0].body,id:'controlled-save',source:'user',color:calls[0].body.color.toUpperCase(),createdAt:'2026-10-04T00:00:00Z'}));
    await page.waitForFunction(()=>!document.querySelector('#category-form').hasAttribute('aria-busy'));
    assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'');
    for(const language of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(language=>YNXFinanceLocale.set(language),language);
      assert.equal(await page.locator('#category-form [data-save-state]').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('profileSaved')));
    }
    assert.equal(await page.evaluate(()=>calls.length),1);assert.equal(await page.evaluate(()=>reads),1);
    assert.deepEqual(await page.evaluate(()=>failures),['connectionUnavailable']);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
  }finally{await browser.close()}
});
test('confirmed category save reads a new overview and ignores a delayed pre-save overview in real Chrome',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.route('https://finance-save-read.test/',route=>route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}));
    await page.goto('https://finance-save-read.test/');await page.addScriptTag({content:locale});
    const workspace=app.slice(app.indexOf('function validateFinanceOverview('),app.indexOf('function render(data)'))+app.slice(app.indexOf('let loadOperation='),app.indexOf('async function reconnect('));
    await page.addScriptTag({content:`const state={context:1,connected:true};let browserSSOIntentGeneration=1;const dataDisabledControls=new Map();const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));window.calls=[];window.readErrors=[];window.YNXFinanceWallet={ready:Promise.resolve(),connected:()=>true};const financeText=k=>YNXFinanceLocale.text(k),notify=()=>{},notifyFailure=()=>{},attestBrowserIdentityActivity=async()=>{},renderBrowserWalletIdentity=()=>true,sourceStatus=()=>{},reconcileOpaqueBrokerOwner=()=>{},workspaceDataState=value=>$('#workspace').dataset.dataState=value,render=value=>$('#categories').textContent=value.label,clearPrivateView=()=>readErrors.push('signed-out');const api=(path,options)=>new Promise((resolve,reject)=>calls.push({path,body:options?.body?JSON.parse(options.body):null,resolve,reject}));${workspace}${saves}window.beginOldRead=()=>{window.oldRead=load()};`});
    await page.evaluate(()=>beginOldRead());await page.waitForFunction(()=>calls.length===1);
    await page.locator('#category-form input[name=name]').fill('Saved category');
    await page.evaluate(()=>document.querySelector('#category-form').dispatchEvent(new Event('submit',{cancelable:true})));
    await page.waitForFunction(()=>calls.some(call=>call.path==='/api/categories'));
    await page.evaluate(()=>{const call=calls.find(call=>call.path==='/api/categories');call.resolve({...call.body,id:'controlled-owned-category',name:call.body.name.trim(),color:call.body.color.toUpperCase(),source:'user',createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z'})});
    await page.waitForFunction(()=>calls.filter(call=>call.path==='/api/overview').length===2);
    await page.evaluate(()=>calls.filter(call=>call.path==='/api/overview')[1].resolve({portfolio:{account:'isolated-save-owner'},profile:{privacy:{includePayInStatements:false,allowAiActivityContext:false,alertsEnabled:true}},label:'Saved category — fresh response'}));
    await page.waitForFunction(()=>!document.querySelector('#category-form').hasAttribute('aria-busy'));
    await page.evaluate(async()=>{calls[0].resolve({label:'Stale pre-save response'});await oldRead});
    assert.equal(await page.locator('#categories').innerText(),'Saved category — fresh response');
    assert.deepEqual(await page.evaluate(()=>readErrors),[]);assert.equal(await page.locator('#category-form input[name=name]').inputValue(),'');
    assert.equal(await page.evaluate(()=>calls.filter(call=>call.path==='/api/categories').length),1);
  }finally{await browser.close()}
});
test('actual export button single-flights downloads and suppresses late previous-account blobs',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({acceptDownloads:true}),downloads=[];page.on('download',item=>downloads.push(item.suggestedFilename()));
    await page.setContent('<button id="export-json">Export</button>');
    const exportController=app.slice(app.indexOf('const ownedExportOperations='),app.indexOf('let ownedAIGeneration='));
    await page.addScriptTag({content:`const state={context:1,overview:{portfolio:{account:'controlled-owner-A'}}};let browserSSOIntentGeneration=1;const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));window.calls=[];window.failures=[];const notifyFailure=()=>failures.push('failed');const api=()=>new Promise((resolve,reject)=>calls.push({resolve,reject}));${exportController}window.switchExportOwner=()=>{state.context++;browserSSOIntentGeneration++;};`});
    await page.locator('#export-json').click();await page.locator('#export-json').click();assert.equal(await page.evaluate(()=>calls.length),1);
    const first=page.waitForEvent('download');await page.evaluate(()=>calls[0].resolve(new Blob(['{"coverageComplete":false}'],{type:'application/json'})));await first;
    assert.deepEqual(downloads,['ynx-finance-observed-export.json']);
    await page.locator('#export-json').click();await page.evaluate(()=>switchExportOwner());await page.locator('#export-json').click();assert.equal(await page.evaluate(()=>calls.length),3);
    await page.evaluate(()=>calls[1].resolve(new Blob(['old-owner'])));assert.equal(downloads.length,1);
    const next=page.waitForEvent('download');await page.evaluate(()=>calls[2].resolve(new Blob(['new-owner'])));await next;
    assert.equal(downloads.length,2);assert.deepEqual(await page.evaluate(()=>failures),[]);
    await page.locator('#export-json').click();
    await page.evaluate(()=>{state.overview.portfolio.account='controlled-owner-B'});
    await page.locator('#export-json').click();await page.locator('#export-json').click();
    assert.equal(await page.evaluate(()=>calls.length),5,'new displayed owner gets an independent export without changing epochs');
    await page.evaluate(()=>calls[3].resolve(new Blob(['old-owner-only-transition'])));assert.equal(downloads.length,2);
    const owned=page.waitForEvent('download');await page.evaluate(()=>calls[4].resolve(new Blob(['new-owner-only-transition'])));
    const delivered=await owned;assert.equal(await readFile(await delivered.path(),'utf8'),'new-owner-only-transition');
    assert.equal(downloads.length,3);assert.deepEqual(await page.evaluate(()=>failures),[]);
  }finally{await browser.close();}
});
test('invalid reminder date remains a recoverable localized draft rather than an uncaught submit error',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.abort());
    await page.route('https://finance-draft.test/',route=>route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}));
    await page.goto('https://finance-draft.test/');await page.addScriptTag({content:locale});
    await page.addScriptTag({content:`const state={context:1,connected:true};let browserSSOIntentGeneration=1;const dataDisabledControls=new Map();const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));window.calls=[];const financeText=k=>YNXFinanceLocale.text(k),notify=()=>{},notifyFailure=()=>{},attestBrowserIdentityActivity=async()=>{},load=async()=>{};const api=(path,options)=>new Promise(resolve=>calls.push({path,body:JSON.parse(options.body),resolve}));${saves}`});
    await page.locator('#reminder-form input[name=title]').fill('Keep my draft');
    await page.evaluate(()=>document.querySelector('#reminder-form').dispatchEvent(new Event('submit',{cancelable:true})));
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>calls.length),0);
    assert.equal(await page.locator('#reminder-form input[name=title]').inputValue(),'Keep my draft');
    for(const language of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(language=>YNXFinanceLocale.set(language),language);
      assert.equal(await page.locator('#reminder-form [data-save-state]').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('ownedSaveUnconfirmed')));
    }
    await page.locator('#reminder-form input[name=nextDueAt]').fill('2030-10-03T10:30');
    await page.evaluate(()=>document.querySelector('#reminder-form').dispatchEvent(new Event('submit',{cancelable:true})));
    assert.equal(await page.evaluate(()=>calls.length),1);
    await page.evaluate(()=>calls[0].resolve({...calls[0].body,id:'real-fixture-receipt',source:'user',enabled:true,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z'}));
    await page.waitForFunction(()=>!document.querySelector('#reminder-form').hasAttribute('aria-busy'));
    assert.equal(await page.locator('#reminder-form input[name=title]').inputValue(),'');assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
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
    const drafts=aiViewRetirement+reportView+app.slice(app.indexOf('const ownedFormDrafts='),app.indexOf('function clearPrivateView('));
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
    const drafts=aiViewRetirement+reportView+app.slice(app.indexOf('const ownedFormDrafts='),app.indexOf('function clearPrivateView('));
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
