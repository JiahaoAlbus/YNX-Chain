import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';

// Actual product HTML/render functions, controlled account read input only.
// No Wallet approval, authenticated API or public acceptance is claimed here.
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
const controls=app.slice(app.indexOf('function renderPrivateAccount('),app.indexOf('function renderBook('));
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
    await page.addScriptTag({content:`const $=selector=>document.querySelector(selector);const state={account:null};const resumeDeferredBrowserIdentity=()=>{};const renderAccount=()=>{$('#withdraw-lock').checked=!!state.snapshot.security.withdrawalLock;$('#session-ttl').value=String(state.snapshot.security.sessionTtlMinutes);};${controls}`});
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
