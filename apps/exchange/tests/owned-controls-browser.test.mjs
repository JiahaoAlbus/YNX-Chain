import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {formatMicro} from '../web/market-data.js';
import {locales} from '../web/locale.js';

// Actual product HTML/render functions, controlled account read input only.
// No Wallet approval, authenticated API or public acceptance is claimed here.
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
const controls=app.slice(app.indexOf('function renderPrivateAccount('),app.indexOf('function renderBook('));
const identity=app.slice(app.indexOf('let browserIdentity='),app.indexOf('\nconst marketFeed='));
const chooser=app.slice(app.indexOf('function openWalletChooser()'),app.indexOf('async function restoreStandardWallet()'));
const ownedTimes=app.slice(app.indexOf('function ownedRecordInstant('),app.indexOf('function renderBalances('));
const activity=ownedTimes+app.slice(app.indexOf('function renderActivity()'),app.indexOf('function renderPublicMarket()'));
const privateReadRender=app.slice(app.indexOf('function renderPrivateAccount('),app.indexOf('function renderPrivateReadMetadata('));
test('guest 401 or unavailable rechecks preserve URL, chart period and drafts; only explicit login navigates',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),requests=[],errors=[];let accountStatus=401;
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname,search:url.search,method:request.method()});
      if(url.origin!=='https://exchange.ynxweb4.com')return route.abort();
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
      if(url.pathname==='/api/v1/sso/config')return route.fulfill({json:{enabled:true,silentRestoreAllowed:true}});
      if(url.pathname==='/api/v1/sso/account')return route.fulfill({status:accountStatus,json:accountStatus===200?{account:'native-owned-cookie',scopes:['identity:read'],privateWorkspaceAuthorized:false}:{code:'SSO_LOGIN_REQUIRED'}});
      if(url.pathname==='/sso/start')return route.fulfill({contentType:'text/html',body:'Explicit fixed SSO fixture; no account request.'});
      return route.abort();
    });
    await page.goto('https://exchange.ynxweb4.com/#market');await page.addStyleTag({content:css});
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:null,standardWallet:{status:'standard-connected'}};const privateAccount={state:()=>({phase:'guest'}),guest:async()=>{},disconnect:async()=>{}};${identity}\nwindow.guestIdentityQA={init:initializeBrowserIdentity,recheck:restoreBrowserIdentity,identity:()=>browserIdentity};`});
    await page.evaluate(()=>guestIdentityQA.init());
    await page.evaluate(()=>{document.getElementById('chart-interval').value='3600000';document.getElementById('support-message').value='Unsubmitted guest draft';});
    for(const status of [401,503,401]){
      accountStatus=status;await page.evaluate(()=>guestIdentityQA.recheck());
      assert.equal(page.url(),'https://exchange.ynxweb4.com/#market');assert.equal(await page.locator('#chart-interval').inputValue(),'3600000');assert.equal(await page.locator('#support-message').inputValue(),'Unsubmitted guest draft');assert.equal(context.pages().length,1);
    }
    assert.equal(requests.filter(row=>row.path==='/sso/start').length,0);assert.equal(requests.filter(row=>row.method!=='GET').length,0);
    accountStatus=200;await page.evaluate(()=>guestIdentityQA.recheck());assert.equal((await page.evaluate(()=>guestIdentityQA.identity())).account,'native-owned-cookie');assert.equal(page.url(),'https://exchange.ynxweb4.com/#market');
    accountStatus=401;await page.evaluate(()=>guestIdentityQA.recheck());assert.equal(await page.evaluate(()=>guestIdentityQA.identity()),null);
    await page.locator('#browser-identity-start').click();await page.waitForURL('**/sso/start?target=market');
    assert.equal(requests.filter(row=>row.path==='/sso/start').length,1);assert.equal(requests.find(row=>row.path==='/sso/start').search,'?target=market');assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});
const activityBinding=app.split('\n').find(line=>line.includes("$$('.tabs button').forEach(b=>b.addEventListener"));
const localeSource=await readFile(new URL('../web/locale.js',import.meta.url),'utf8');
const localeSetup=app.split('\n').find(line=>line.includes('window.YNXExchangeLocale=installExchangeLocale({document'));
const commandCopySource=(await readFile(new URL('../web/command-copy.js',import.meta.url),'utf8')).replaceAll('export ','');
const commandCopyRender=app.slice(app.indexOf('function renderCommandCopy('),app.indexOf('function reviewCommand('));
test('advanced records show existing owned tasks without inventing fills, missing collections or write actions',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];let requests=0;
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:localeSource+'\nwindow.YNXExchangeLocale=installExchangeLocale({document});'});
    await page.waitForFunction(()=>window.YNXExchangeLocale);
    await page.evaluate(()=>{document.querySelectorAll('.view').forEach(element=>element.classList.remove('active'));document.querySelector('#activity').classList.add('active')});
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];const state={account:'A',snapshot:null,activity:'advanced'};const display=${formatMicro.toString()};${activity};${activityBinding};function rememberSupportDraft(){}function renderPrivateReadMetadata(){}function renderOwnedControls(){}function resumeDeferredBrowserIdentity(){}function renderAccount(){renderActivity()};${privateReadRender};window.advancedQA={set(account,snapshot){state.account=account;state.snapshot=snapshot;renderActivity()},retire(){renderPrivateAccount({account:null,snapshot:null,phase:'guest'})}};`});
    const base={account:'A',market:'YNXT-YUSD_TEST',side:'buy',createdAt:'2026-10-04T00:00:00Z',reservedMicro:1234567};
    const data={
      conditionalOrders:[{...base,id:'conditional-A',status:'triggered',amountMicro:2000000,triggerPriceMicro:3000000,limitPriceMicro:4000000,activatedOrderId:'child-A'}],
      ocoGroups:[{...base,id:'oco-A',status:'pending_trigger',amountMicro:2000000,stopConditionalId:'stop-A',takeProfitConditionalId:'profit-A',rejectReason:'<img src=x onerror=alert(1)>'}],
      twapOrders:[{...base,id:'twap-A',status:'scheduled',limitPriceMicro:4000000,totalAmountMicro:2000000,scheduledMicro:1000000,slices:2,slicesExecuted:1,childOrderIds:['scheduled-child-A']},{...base,account:'B',id:'twap-B',status:'scheduled',limitPriceMicro:1,totalAmountMicro:1,scheduledMicro:0,slices:1,slicesExecuted:0,childOrderIds:[]}],
      scaleOrders:[{...base,id:'scale-A',status:'venue_unknown_status',startPriceMicro:1000000,endPriceMicro:3000000,totalAmountMicro:2000000,filledMicro:17,levels:2,childOrderIds:['scale-child-A']}],
      orders:[{...base,id:'child-A',status:'partially_filled',amountMicro:2000000,filledMicro:500000},{...base,account:'B',id:'child-A',status:'foreign-order-status',amountMicro:1000000,filledMicro:0}],
      trades:[{id:'matched-child-A',buyer:'A',seller:'B',buyOrderId:'child-A',sellOrderId:'other-B',priceMicro:4000000,amountMicro:500000,buyerFeeMicro:13,sellerFeeMicro:17,sourceDigest:'d'.repeat(64),createdAt:base.createdAt},{id:'foreign-child-trade',buyer:'C',seller:'D',buyOrderId:'child-A',priceMicro:1,amountMicro:1,buyerFeeMicro:1,sellerFeeMicro:1,createdAt:base.createdAt}]
    };
    const original=JSON.stringify(data);await page.evaluate(data=>advancedQA.set('A',data),data);await page.locator('[data-activity="advanced"]').click();
    let text=await page.locator('#activity-body').innerText();assert.equal(await page.locator('#activity-body tr').count(),4);
    for(const id of ['conditional-A','oco-A','twap-A','scale-A','child-A','stop-A','profit-A','scale-child-A'])assert.ok(text.includes(id));
    assert.ok(text.includes('Activation is not a fill.'));assert.ok(text.includes('Scheduled quantity is not filled quantity.'));
    assert.ok(text.includes('Scheduled: 1'));assert.ok(text.includes('Filled: 0.000017'));assert.ok(text.includes('Reserved: 1.234567'));
    assert.ok(text.includes('venue_unknown_status'));assert.doesNotMatch(text,/twap-B/);
    assert.equal(await page.locator('#activity-body img,#activity-body a').count(),0);
    assert.equal(await page.locator('#activity-body button[data-record-detail]').count(),4,'only local read-detail controls are introduced');
    await page.locator('[data-record-detail="conditional-A"]').click();
    assert.equal(await page.locator('#advanced-record-dialog').evaluate(dialog=>dialog.open),true);
    let detail=await page.locator('#advanced-record-details').innerText();
    assert.match(detail,/child-A · partially_filled/);assert.match(detail,/matched-child-A/);assert.match(detail,/0\.000013/);assert.ok(detail.includes('d'.repeat(64)));
    assert.doesNotMatch(detail,/foreign-order-status|foreign-child-trade|other-B/);
    assert.equal(await page.locator('#advanced-record-details img,#advanced-record-details a,#advanced-record-details button').count(),0);
    assert.equal(await page.locator('#advanced-record-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth),true);
    for(const locale of locales){
      await page.evaluate(({locale,data})=>{YNXExchangeLocale.set(locale);advancedQA.set('A',data)}, {locale,data});
      assert.equal(await page.locator('[data-activity="advanced"]').innerText(),await page.evaluate(()=>YNXExchangeLocale.text('Advanced orders')));
      assert.ok((await page.locator('#activity-body').innerText()).includes(await page.evaluate(()=>YNXExchangeLocale.text('Scheduled quantity is not filled quantity.'))));
      assert.equal(await page.locator('#advanced-record-dialog').evaluate(dialog=>dialog.open),true);
      assert.ok((await page.locator('#advanced-record-details').innerText()).includes(await page.evaluate(()=>YNXExchangeLocale.text('Related orders'))));
      assert.ok((await page.locator('#advanced-record-title').innerText()).startsWith(await page.evaluate(()=>YNXExchangeLocale.text('Task details'))));
      assert.equal(await page.locator('#advanced-record-dialog .close').getAttribute('aria-label'),await page.evaluate(()=>YNXExchangeLocale.text('Close task details')));
    }
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#advanced-record-dialog').open&&document.querySelector('#advanced-record-details').childElementCount===0);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.recordDetail),'conditional-A');
    await page.evaluate(()=>{YNXExchangeLocale.set('en');window.oldDetailButton=document.querySelector('[data-record-detail="conditional-A"]')});
    await page.locator('[data-record-detail="oco-A"]').click();assert.match(await page.locator('#advanced-record-details').innerText(),/No related records in this snapshot/);
    assert.equal(await page.locator('#advanced-record-details img').count(),0);
    await page.evaluate(data=>{YNXExchangeLocale.set('en');advancedQA.set('B',data)},data);text=await page.locator('#activity-body').innerText();
    assert.match(text,/twap-B/);assert.doesNotMatch(text,/conditional-A|oco-A|twap-A|scale-A/);
    assert.equal(await page.locator('#advanced-record-dialog').evaluate(dialog=>dialog.open),false);assert.equal(await page.locator('#advanced-record-details').innerText(),'');
    await page.evaluate(()=>window.oldDetailButton.click());assert.equal(await page.locator('#advanced-record-dialog').evaluate(dialog=>dialog.open),false);
    await page.evaluate(()=>advancedQA.set('A',{}));text=await page.locator('#activity-body').innerText();assert.equal(await page.locator('#activity-body tr').count(),4);assert.match(text,/Collection not reported; not verified/);assert.doesNotMatch(text,/No owned records/);
    await page.evaluate(()=>advancedQA.set('A',{conditionalOrders:[],ocoGroups:[],twapOrders:[],scaleOrders:[]}));assert.equal(await page.locator('#activity-body').innerText(),'No owned records yet.');
    await page.evaluate(data=>advancedQA.set('A',data),data);await page.locator('[data-record-detail="conditional-A"]').click();
    await page.evaluate(()=>advancedQA.retire());assert.equal(await page.locator('#advanced-record-dialog').evaluate(dialog=>dialog.open),false);assert.equal(await page.locator('#advanced-record-details').innerText(),'');assert.equal(await page.locator('#advanced-record-title').innerText(),'');
    await page.evaluate(()=>advancedQA.set(null,null));assert.equal(await page.locator('#activity-body').innerText(),'');
    assert.equal(JSON.stringify(data),original);assert.equal(requests,0);assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});
test('open-order renderer binds rows and action intent to current owner across account loss and switch',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    const renderer=app.slice(app.indexOf('function renderOrders('),app.indexOf('function renderBalances('));
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:null,snapshot:null};const display=${formatMicro.toString()};const intents=[];const cancelOrder=o=>intents.push({id:o.id,account:o.account});${renderer};window.orderOwnerQA={set(account,snapshot){state.account=account;state.snapshot=snapshot;renderOrders()},intents};`});
    const row=(account,id,side,status='open')=>({account,id,side,status,market:'YNXT-YUSD_TEST',type:'limit',priceMicro:2000000,amountMicro:3000000,filledMicro:status==='partially_filled'?1000000:0,createdAt:'2026-10-04T00:00:00Z'});
    const data={orders:[row('A','own-A','buy'),row('B','own-B','sell','partially_filled'),row('A','closed-A','buy','cancelled')]},original=JSON.stringify(data);
    await page.evaluate(data=>window.orderOwnerQA.set('A',data),data);
    assert.equal(await page.locator('#orders button').count(),1);
    assert.match(await page.locator('#orders').innerText(),/buy/);assert.doesNotMatch(await page.locator('#orders').innerText(),/sell/);
    await page.locator('#orders button').click();
    await page.evaluate(()=>{window.oldOrderButton=document.querySelector('#orders button')});
    await page.evaluate(data=>window.orderOwnerQA.set('B',data),data);
    await page.evaluate(()=>window.oldOrderButton.click());
    assert.equal(await page.evaluate(()=>window.orderOwnerQA.intents.length),1,'retired owner button must not forward an action');
    assert.equal(await page.locator('#orders button').count(),1);assert.match(await page.locator('#orders').innerText(),/sell/);
    await page.locator('#orders button').click();
    assert.deepEqual(await page.evaluate(()=>window.orderOwnerQA.intents),[{id:'own-A',account:'A'},{id:'own-B',account:'B'}]);
    await page.evaluate(()=>{window.oldOrderButton=document.querySelector('#orders button')});
    await page.evaluate(data=>window.orderOwnerQA.set(null,data),data);assert.equal(await page.locator('#orders button').count(),0);
    await page.evaluate(()=>window.oldOrderButton.click());assert.equal(await page.evaluate(()=>window.orderOwnerQA.intents.length),2);
    await page.evaluate(()=>window.orderOwnerQA.set(null,null));assert.equal(await page.locator('#orders button').count(),0);
    assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);assert.equal(JSON.stringify(data),original);
  }finally{await browser.close()}
});

test('private account read timestamps follow the chosen language without requests or source mutation',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const context=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];let requests=0;
    page.setDefaultTimeout(3000);
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:null,snapshot:null};let currentRead;const privateAccount={state:()=>currentRead};const languageStorage={getItem:()=>null,setItem(){}};function renderAccount(){}function renderBook(){}function renderPublicMarket(){}function estimate(){}function resumeDeferredBrowserIdentity(){};${ownedTimes};${controls};window.privateTimeQA={set(value){currentRead=value;renderPrivateAccount(value)},source(){return JSON.stringify(currentRead)}};`});
    await page.addScriptTag({type:'module',content:`${localeSource}\nconst commandText=(()=>{${commandCopySource};return commandText})();\n${commandCopyRender}\n${localeSetup}`});
    try{await page.waitForFunction(()=>window.YNXExchangeLocale,{},{timeout:3000})}catch(error){assert.deepEqual(errors,[]);throw error}
    const value={phase:'connected',account:'controlled-A',expiresAt:'2026-10-03T10:00:00+09:00',snapshot:{security:{updatedAt:'2026-10-03T01:00:00Z'},support:[{account:'controlled-A',id:'existing-case',category:'security',status:'open',createdAt:'2026-10-03T01:00:00Z',message:'Existing account-owned case'}],sourceMetadata:{status:'controlled_read',coverage:'owned_records_fixture',asOf:'2026-10-03T01:00:00Z'}}};
    await page.evaluate(value=>window.privateTimeQA.set(value),value);const original=JSON.stringify(value);
    await page.locator('#support-message').fill('Current owner unsubmitted draft');
    for(const language of locales){
      await page.locator('#exchange-language').selectOption(language);
      const expected=await page.evaluate(()=>new Date('2026-10-03T01:00:00Z').toLocaleString(document.documentElement.lang));
      assert.equal(await page.locator('#private-expiry').textContent(),expected);
      assert.equal(await page.locator('#private-source').textContent(),`controlled_read · owned_records_fixture · ${expected}`);
      assert.ok((await page.locator('#security-read-state').textContent()).includes(` · ${expected}`),'security observation time must follow the currently selected language');
      assert.equal(await page.locator('#owned-support-cases article p').first().textContent(),`existing-case · ${expected}`);
      assert.equal(await page.locator('#support-message').inputValue(),'Current owner unsubmitted draft');
      assert.equal(await page.evaluate(()=>window.privateTimeQA.source()),original);
    }
    for(const invalid of [null,'0','2026-02-30T00:00:00Z']){
      value.expiresAt=invalid;value.snapshot.sourceMetadata.asOf=invalid;await page.evaluate(value=>window.privateTimeQA.set(value),value);
      assert.equal(await page.locator('#private-expiry').textContent(),'—');assert.match(await page.locator('#private-source').textContent(),/ · —$/);
    }
    assert.deepEqual(errors,[]);assert.equal(requests,0);assert.equal(context.pages().length,1);
  }finally{await browser.close()}
});

test('owned order timestamps sort by actual instants and missing dates cannot crash open orders',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    const openOrders=app.slice(app.indexOf('function renderOrders('),app.indexOf('function renderBalances('));
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:'A',activity:'orders',snapshot:null};const display=${formatMicro.toString()};const cancelOrder=()=>{throw Error('No write permitted')};${openOrders};${activity};window.timeQA={set(data){state.snapshot=data;renderOrders();renderActivity()},source(){return JSON.stringify(state.snapshot)}};`});
    const row=(id,createdAt)=>({account:'A',id,createdAt,status:'open',market:'YNXT-YUSD_TEST',side:'buy',type:'limit',priceMicro:2000000,amountMicro:1000000,filledMicro:0});
    const data={orders:[row('offset-earlier','2026-10-03T09:00:00+09:00'),row('utc-later','2026-10-03T01:00:00Z')]};
    await page.evaluate(data=>window.timeQA.set(data),data);
    assert.match(await page.locator('#activity-body tr').first().textContent(),/utc-later/);
    data.orders.push(row('missing',undefined),row('numeric-looking','0'),row('impossible','2026-02-30T00:00:00Z'));
    const original=JSON.stringify(data);await page.evaluate(data=>window.timeQA.set(data),data);
    assert.equal(await page.locator('#orders tr').count(),5);
    const rows=await page.locator('#activity-body tr').allTextContents();assert.match(rows[0],/utc-later/);assert.match(rows[1],/offset-earlier/);
    for(const id of ['missing','numeric-looking','impossible'])assert.equal(await page.locator('#activity-body tr').filter({hasText:id}).locator('td').first().textContent(),'—');
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(({language,data})=>{document.documentElement.lang=language;window.timeQA.set(data)},{language,data});
      const expected=await page.evaluate(()=>new Date('2026-10-03T01:00:00Z').toLocaleString(document.documentElement.lang));
      assert.equal(await page.locator('#activity-body tr').first().locator('td').first().textContent(),expected);
      assert.equal(await page.evaluate(()=>window.timeQA.source()),original);
    }
    assert.equal(JSON.stringify(data),original);assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});

test('actual activity renderer exposes existing owned order history and signed ledger changes without write actions',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.evaluate(()=>{document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));document.querySelector('#activity').classList.add('active')});
    assert.ok(activityBinding,'test must execute the actual product tab binding');
    await page.addScriptTag({content:`const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];const state={account:'A',snapshot:null,activity:'orders'};const display=${formatMicro.toString()};${activity};${activityBinding};window.activityQA={set(account,snapshot){state.account=account;state.snapshot=snapshot;renderActivity()}};`});
    const order=(account,id,status,createdAt)=>({account,id,status,createdAt,market:'YNXT-YUSD_TEST',side:'buy',type:'limit',priceMicro:2000000,amountMicro:3000000,filledMicro:status==='filled'?3000000:0,rejectReason:status==='rejected'?'<img src=x onerror=alert(1)> rejected by venue':''});
    const data={orders:[order('A','older-cancelled','cancelled','2026-10-01T00:00:00Z'),order('A','newer-filled','filled','2026-10-02T00:00:00Z'),order('B','foreign-B','open','2026-10-03T00:00:00Z'),order('A','rejected','rejected','2026-10-02T01:00:00Z')],ledger:[{account:'A',id:'ledger-A',asset:'YUSD_TEST',availableDelta:-1234567,reservedDelta:0,sourceType:'order_cancel',sourceId:'older-cancelled',sourceDigest:'a'.repeat(64),createdAt:'2026-10-02T02:00:00Z'},{account:'B',id:'ledger-B',asset:'YNXT',availableDelta:9000000,reservedDelta:0,createdAt:'2026-10-02T03:00:00Z'}]};
    await page.evaluate(data=>window.activityQA.set('A',data),data);
    assert.equal(await page.locator('[data-activity="orders"]').count(),1);
    assert.equal(await page.locator('#activity-body tr').count(),3);
    let text=await page.locator('#activity-body').innerText();assert.match(text,/cancelled/u);assert.match(text,/filled/u);assert.match(text,/rejected/u);assert.doesNotMatch(text,/foreign-B/u);
    assert.equal(await page.locator('#activity-body img').count(),0);assert.equal(await page.locator('#activity-body button').count(),0);
    assert.match(await page.locator('#activity-body tr').first().innerText(),/rejected/u);
    await page.locator('[data-activity="ledger"]').click();text=await page.locator('#activity-body').innerText();
    assert.match(text,/-1\.234567/u);assert.match(text,/0\.00/u);assert.ok(text.includes('a'.repeat(64)));assert.doesNotMatch(text,/ledger-B/u);
    assert.equal(await page.locator('[data-activity="ledger"]').getAttribute('aria-selected'),'true');
    assert.ok((await page.locator('[data-activity="ledger"]').boundingBox()).height>=44);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    data.deposits=[{account:'A',id:'deposit-A',asset:'YNXT',network:'YNX Testnet',amountMicro:1000001,confirmations:2,required:12,status:'pending',txHash:'actual-returned-hash-fixture',sourceDigest:'b'.repeat(64),createdAt:'2026-10-02T03:00:00Z'}];
    data.withdrawals=[{account:'A',id:'withdrawal-A',asset:'YNXT',network:'YNX Testnet',amountMicro:2000000,feeMicro:0,receiveMicro:2000000,status:'pending_wallet',destination:'<script>not markup</script>',sourceDigest:'c'.repeat(64),createdAt:'2026-10-02T04:00:00Z'}];
    await page.evaluate(data=>window.activityQA.set('A',data),data);
    await page.locator('[data-activity="deposits"]').click();text=await page.locator('#activity-body').innerText();
    assert.match(text,/deposit-A/u);assert.match(text,/2 \/ 12/u);assert.match(text,/pending/u);assert.match(text,/actual-returned-hash-fixture/u);assert.doesNotMatch(text,/confirmed|completed/u);
    await page.locator('[data-activity="withdrawals"]').click();text=await page.locator('#activity-body').innerText();
    assert.match(text,/pending_wallet/u);assert.match(text,/0\.00/u);assert.equal(await page.locator('#activity-body script').count(),0);assert.equal(await page.locator('#activity-body button').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    data.trades=[{id:'matched-trade-A-B',buyer:'A',seller:'B',buyOrderId:'buy-order-A',sellOrderId:'sell-order-B',priceMicro:2000000,amountMicro:3000000,buyerFeeMicro:17,sellerFeeMicro:43,sourceType:'deterministic_price_time_match',sourceDigest:'d'.repeat(64),createdAt:'2026-10-02T04:00:00Z'},
      {id:'foreign-trade',buyer:'C',seller:'D',priceMicro:1,amountMicro:1,buyerFeeMicro:1,sellerFeeMicro:1,createdAt:'2026-10-02T04:00:00Z'}];
    await page.evaluate(data=>window.activityQA.set('A',data),data);
    await page.locator('[data-activity="trades"]').click();text=await page.locator('#activity-body').innerText();
    assert.match(text,/matched-trade-A-B/u);assert.match(text,/buy-order-A/u);assert.doesNotMatch(text,/sell-order-B|foreign-trade/u);
    assert.ok(text.includes('d'.repeat(64)));assert.match(text,/deterministic_price_time_match/u);assert.match(text,/0\.000017/u);
    await page.evaluate(data=>window.activityQA.set('B',data),data);text=await page.locator('#activity-body').innerText();
    assert.match(text,/sell-order-B/u);assert.doesNotMatch(text,/buy-order-A|foreign-trade/u);assert.match(text,/0\.000043/u);
    assert.equal(await page.locator('#activity-body a,#activity-body button').count(),0,'venue references must not become invented Explorer links or write actions');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.locator('[data-activity="ledger"]').click();
    const original=JSON.stringify(data);await page.evaluate(data=>window.activityQA.set('B',data),data);
    assert.match(await page.locator('#activity-body').innerText(),/ledger-B/u);assert.doesNotMatch(await page.locator('#activity-body').innerText(),/ledger-A/u);
    await page.evaluate(()=>window.activityQA.set(null,null));assert.equal(await page.locator('#activity-body').innerText(),'');assert.equal(await page.locator('#activity-head').innerText(),'');
    assert.equal(JSON.stringify(data),original,'renderer must not mutate source records');
  }finally{await browser.close();}
});

test('actual identity controls fence late logout outcomes and preserve current logout failure/retry',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    for(const mode of ['chooser-takes-epoch','old-finalizer-new-logout','late-success','late-failure','late-recheck-unavailable','current-success','current-failure-retry','current-timeout-retry','current-unauthorized']){
      const page=await browser.newPage();let owner='A',accountStatus=200;const pending=[],requests=[],arrivals=[];
      const nextRequest=(count=1)=>pending.length>=count?Promise.resolve():new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('isolated logout request did not arrive')),5000);
        arrivals.push(()=>{clearTimeout(timer);resolve()});
      });
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='https://exchange.ynxweb4.com')return route.abort();
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
        if(url.pathname==='/api/v1/sso/config')return route.fulfill({json:{enabled:true,silentRestoreAllowed:false}});
        if(url.pathname==='/api/v1/sso/account')return route.fulfill({status:accountStatus,json:accountStatus===200?{account:owner,csrfToken:'isolated-control-csrf',scopes:['identity:read'],privateWorkspaceAuthorized:false}:{code:'SSO_LOGIN_REQUIRED'}});
        if(url.pathname==='/api/v1/sso/logout'){
          requests.push({method:route.request().method(),csrf:route.request().headers()['x-ynx-sso-csrf'],body:route.request().postData()});
          const result=await new Promise(resolve=>{pending.push(resolve);arrivals.shift()?.()});return route.fulfill(result);
        }
        return route.abort();
      });
      await page.goto('https://exchange.ynxweb4.com/');
      // Exact production identity functions and HTML, controlled HTTP outcomes;
      // this does not simulate a successful Wallet approval or public identity.
      await page.addScriptTag({content:`const $=selector=>document.querySelector(selector);const state={account:null,standardWallet:null};const calls={guest:0,disconnect:0,logoutSettled:0};const privateAccount={state:()=>({phase:'guest'}),guest:async()=>{calls.guest++},disconnect:async()=>{calls.disconnect++}};const originalListener=Element.prototype.addEventListener;Element.prototype.addEventListener=function(type,listener,...options){if(this.id==='browser-identity-logout'&&type==='click'){const wrapped=event=>Promise.resolve(listener.call(this,event)).finally(()=>calls.logoutSettled++);return originalListener.call(this,type,wrapped,...options)}return originalListener.call(this,type,listener,...options)};${identity};function showWalletFallback(show){$('#wallet-fallback').hidden=!show};${chooser};window.identityQA={restore:restoreBrowserIdentity,openChooser:openWalletChooser,current:()=>browserIdentity,calls};initializeBrowserIdentity();`});
      await page.waitForFunction(()=>window.identityQA?.current()?.account==='A');
      const logout=page.locator('#browser-identity-logout');
      await logout.click();await page.waitForFunction(()=>document.querySelector('#browser-identity-logout').disabled);
      await nextRequest();
      if(mode==='chooser-takes-epoch'){
        await page.evaluate(()=>window.identityQA.openChooser());assert.equal(await page.locator('#wallet-dialog').evaluate(element=>element.open),true);
        pending.shift()({status:200,json:{revoked:true}});await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
        assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),'A');assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0);
        assert.equal(await logout.isEnabled(),true,'chooser epoch change must not leave the old logout busy');
      }else if(mode==='old-finalizer-new-logout'){
        owner='B';await page.evaluate(()=>window.identityQA.restore());await logout.click();
        await page.waitForFunction(()=>window.identityQA.calls.guest===2);
        // Both explicit requests are in flight; settle only the old A request.
        await nextRequest(2);
        pending.shift()({status:200,json:{revoked:true}});await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
        assert.equal(await logout.isDisabled(),true,'old finalizer must not enable a newer pending logout');
        assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),'B');assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0);
        pending.shift()({status:200,json:{revoked:true}});await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===2);
        assert.equal(await page.evaluate(()=>window.identityQA.current()),null);assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),1);assert.equal(await logout.isDisabled(),false);
      }else if(mode.startsWith('late-')){
        if(mode==='late-recheck-unavailable')accountStatus=503;else owner='B';await page.evaluate(()=>window.identityQA.restore());
        pending.shift()({status:mode==='late-success'?200:503,json:mode==='late-success'?{revoked:true}:{code:'UNAVAILABLE'}});
        await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
        assert.equal(await logout.isEnabled(),true,mode);
        assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),mode==='late-recheck-unavailable'?'A':'B',mode);
        assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0,mode);
        assert.match(await page.locator('#browser-identity-status').innerText(),mode==='late-recheck-unavailable'?/^Identity recheck unavailable\./u:/^B ·/u,mode);
        assert.equal(await logout.isVisible(),true,mode);
      }else if(mode==='current-timeout-retry'){
        await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1,{},{timeout:7000});
        assert.equal(await logout.isEnabled(),true);assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),'A');assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0);
        assert.match(await page.locator('#browser-identity-status').innerText(),/^Sign-out is not confirmed\./u);assert.equal(requests.length,1);
        pending.shift()({status:200,json:{revoked:true}});
        await logout.click();await nextRequest();pending.shift()({status:200,json:{revoked:true}});
        await page.waitForFunction(()=>window.identityQA.current()===null&&window.identityQA.calls.disconnect===1&&window.identityQA.calls.logoutSettled===2);
        assert.equal(await logout.isVisible(),false);assert.equal(browser.contexts().flatMap(c=>c.pages()).length,1);
      }else{
        pending.shift()({status:mode==='current-failure-retry'?503:200,json:mode==='current-failure-retry'?{code:'UNAVAILABLE'}:{revoked:true}});
        if(mode==='current-failure-retry'){
          await page.waitForFunction(()=>document.querySelector('#browser-identity-status').textContent.startsWith('Sign-out is not confirmed.'));
          assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),'A');assert.equal(await logout.isEnabled(),true);
          assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0);
          await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
          await logout.click();await nextRequest();
          pending.shift()({status:200,json:{revoked:true}});
        }
        await page.waitForFunction(expected=>window.identityQA.current()===null&&window.identityQA.calls.disconnect===1&&window.identityQA.calls.logoutSettled===expected,mode==='current-failure-retry'?2:1);
        assert.match(await page.locator('#browser-identity-status').innerText(),/^Signed out of Exchange\./u);
        assert.equal(await logout.isVisible(),false);
        if(mode==='current-unauthorized'){
          // A fresh authoritative 401 must still clear the current identity.
          owner='A';await page.evaluate(()=>window.identityQA.restore());accountStatus=401;
          await page.evaluate(()=>window.identityQA.restore());assert.equal(await page.evaluate(()=>window.identityQA.current()),null);
          assert.equal(await logout.isVisible(),false);
        }
      }
      assert.ok(requests.every(value=>value.method==='POST'&&value.csrf==='isolated-control-csrf'&&value.body==='{}'));
      assert.equal(requests.length,['current-failure-retry','current-timeout-retry','old-finalizer-new-logout'].includes(mode)?2:1,'no implicit logout retry');
      await page.close();
    }
  }finally{await browser.close();}
});
test('private and browser identity actions use Klein-blue 44px controls without changing disabled or hidden state',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.evaluate(()=>{const panel=document.createElement('div');panel.id='browser-identity';panel.innerHTML='<a href="/sso/start">Sign in across YNX products</a><button hidden>Sign out of Exchange</button><button>Recheck browser identity</button>';document.querySelector('#private-account').append(panel)});
    const button=page.locator('#private-begin');assert.equal(await button.isDisabled(),false);assert.equal(await button.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(0, 47, 167)');
    assert.ok((await button.boundingBox()).height>=44);assert.ok((await page.locator('#browser-identity a').boundingBox()).height>=44);
    assert.equal(await page.locator('#browser-identity button[hidden]').isVisible(),false);assert.equal(await page.locator('#private-open').isVisible(),false);
    await button.focus();assert.ok(await button.evaluate(element=>parseFloat(getComputedStyle(element).outlineWidth)>=3));
    await button.evaluate(element=>element.disabled=true);assert.equal(await button.isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  }finally{await browser.close();}
});
test('verified support reads, local support drafts and security state remain bound to the current native account',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addStyleTag({content:css});await page.evaluate(()=>{document.querySelectorAll('.view').forEach(element=>element.classList.remove('active'));document.querySelector('#controls').classList.add('active')});
    await page.addScriptTag({content:`const $=selector=>document.querySelector(selector);const state={account:null};const resumeDeferredBrowserIdentity=()=>{};const renderAccount=()=>{$('#withdraw-lock').checked=!!state.snapshot.security.withdrawalLock;$('#session-ttl').value=String(state.snapshot.security.sessionTtlMinutes);};${ownedTimes}${controls}`});
    const snapshot=(account,message)=>({phase:'connected',account,expiresAt:new Date(Date.now()+60_000).toISOString(),snapshot:{security:{account,withdrawalLock:true,sessionTtlMinutes:60,updatedAt:new Date().toISOString()},sourceMetadata:{status:'degraded_single_host',coverage:'account-ledger-orders-trades-fees-audit',asOf:new Date().toISOString()},support:[{id:account+'-case',account,category:'security',status:'open',createdAt:new Date().toISOString(),message}]}});
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-A','<img src=x onerror=alert(1)> A case'));
    assert.match(await page.locator('#owned-support-cases').innerText(),/A case/u);assert.equal(await page.locator('#owned-support-cases img').count(),0);
    assert.equal(await page.locator('#withdraw-lock').isChecked(),true);assert.equal(await page.locator('#withdraw-lock').isDisabled(),true);
    await page.locator('#support-message').fill('A unfinished support draft');
    await page.evaluate(()=>renderPrivateAccount({phase:'degraded',account:null,snapshot:null,code:'PRIVATE_API_UNAVAILABLE'}));
    assert.doesNotMatch(await page.locator('#owned-support-cases').innerText(),/A case/u);assert.equal(await page.locator('#support-message').inputValue(),'');assert.match(await page.locator('#security-read-state').innerText(),/No verified/u);
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-B','B case '+ 'long-owned-message'.repeat(50)));
    assert.doesNotMatch(await page.locator('#owned-support-cases').innerText(),/A case/u);assert.match(await page.locator('#owned-support-cases').innerText(),/B case/u);assert.equal(await page.locator('#support-message').inputValue(),'');
    await page.locator('#support-message').fill('B unfinished support draft');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'owned case content must not overflow the mobile page');
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-A','A case'));
    assert.equal(await page.locator('#support-message').inputValue(),'A unfinished support draft');assert.doesNotMatch(await page.locator('#owned-support-cases').innerText(),/B case/u);
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-B','B case'));
    assert.equal(await page.locator('#support-message').inputValue(),'B unfinished support draft');
  }finally{await browser.close();}
});

test('support and settings timestamps use actual source instants, preserve unknown and follow every locale',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:'A',snapshot:null};${ownedTimes}${controls}window.sourceQA={set(value){state.snapshot=value;renderOwnedControls()},source(){return JSON.stringify(state.snapshot)}};`});
    const record=(id,createdAt)=>({id,createdAt,account:'A',category:'security',status:'open',message:id});
    const value={security:{updatedAt:'2026-02-30T00:00:00Z'},support:[record('offset-earlier','2026-10-03T09:00:00+09:00'),record('utc-later','2026-10-03T01:00:00Z'),record('unknown','0')]},original=JSON.stringify(value);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(({language,value})=>{document.documentElement.lang=language;sourceQA.set(value)},{language,value});
      const cases=await page.locator('#owned-support-cases article').allTextContents();assert.match(cases[0],/utc-later/);assert.match(cases[1],/offset-earlier/);assert.match(cases[2],/unknown/);
      assert.equal(await page.locator('#owned-support-cases article').last().locator('p').first().textContent(),'unknown · —');
      assert.equal(await page.locator('#owned-support-cases article').first().locator('p').first().textContent(),await page.evaluate(()=>`utc-later · ${new Date('2026-10-03T01:00:00Z').toLocaleString(document.documentElement.lang)}`));
      assert.match(await page.locator('#security-read-state').textContent(),/Source timestamp unavailable/);assert.equal(await page.evaluate(()=>sourceQA.source()),original);
      const known={...value,security:{updatedAt:'2026-10-03T01:00:00Z'}};
      await page.evaluate(value=>sourceQA.set(value),known);
      assert.ok((await page.locator('#security-read-state').textContent()).includes(await page.evaluate(()=>new Date('2026-10-03T01:00:00Z').toLocaleString(document.documentElement.lang))));
      assert.equal(await page.evaluate(()=>sourceQA.source()),JSON.stringify(known));
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});
