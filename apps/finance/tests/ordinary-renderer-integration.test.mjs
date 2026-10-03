import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';
import {gitApp,PUBLIC_BASE,OWNER_SOURCE,frozenRendererCapsule,integrateOrdinaryRenderers} from '../scripts/ordinary-renderer-integration.mjs';
const base=gitApp(PUBLIC_BASE),capsule=frozenRendererCapsule(),hash=value=>createHash('sha256').update(value).digest('hex');

test('frozen ordinary capsule patches exact public source and preserves every unrelated byte',()=>{
  assert.equal(readFileSync(new URL('../evidence/ordinary-renderer-integration-capsule-20261004.json',import.meta.url),'utf8'),JSON.stringify(capsule,null,2)+'\n');
  assert.equal(capsule.publicBase,PUBLIC_BASE);assert.equal(capsule.ownerSource,OWNER_SOURCE);assert.equal(capsule.baseAppSha256,hash(base));
  let expected=base;for(const change of capsule.changes){assert.equal(hash(change.before),change.beforeSha256);assert.equal(hash(change.after),change.afterSha256);assert.equal(Buffer.byteLength(change.after),change.afterBytes);expected=expected.replace(change.before,change.after)}
  const integrated=integrateOrdinaryRenderers(base);assert.equal(integrated,expected);new Script(integrated);
  const beforeAuthority=base.slice(0,base.indexOf('function renderReceipts('));assert.ok(integrated.startsWith(beforeAuthority));
  const unrelated='\n// Unique release-owner authority changes must be preserved.\n';assert.equal(integrateOrdinaryRenderers(unrelated+base),unrelated+integrated);
});

test('changed, missing, duplicated ordinary ranges, helper collisions and tampered capsule fail without writes',()=>{
  for(const value of [base.replace(capsule.changes[0].before,'// separately changed receipt renderer\n'),base+capsule.changes[0].before,base+'\nfunction financeNavigationURL(value){}',base+'\nfunction readablePlanningRecord(value){}'])assert.throws(()=>integrateOrdinaryRenderers(value));
  const tampered=structuredClone(capsule);tampered.changes[0].after+='\nfetch("https://attacker.invalid");';assert.throws(()=>integrateOrdinaryRenderers(base,tampered),/ORDINARY_CAPSULE_UNTRUSTED/);
  assert.throws(()=>integrateOrdinaryRenderers(integrateOrdinaryRenderers(base)),/ORDINARY_MARKER_NOT_UNIQUE/);
});

test('actual Chrome renders the merged public graph ordinary functions without malformed-source crash or unsafe navigation',async()=>{
  const merged=integrateOrdinaryRenderers(base),browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[];let requests=0;
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent('<div id="recent-receipts"></div><div id="support-links"></div><div id="categories"></div><form id="budget-form"><select name="categoryId"></select></form><div id="budgets"></div><div id="reminders"></div>');
    const start=merged.indexOf('function financeNavigationURL('),end=merged.indexOf('function renderPrivacy('),supportStart=merged.indexOf('function renderSupport('),supportEnd=merged.indexOf('\n',supportStart);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),financeText=k=>k,fmt=v=>v==null?'unknown':String(v),date=v=>v||'unknown',short=v=>String(v),esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');${merged.slice(start,end)}\n${merged.slice(supportStart,supportEnd)}\nwindow.mergedQA={renderReceipts,renderPlanning,renderSupport};`});
    await page.evaluate(()=>{mergedQA.renderReceipts(null,null);mergedQA.renderPlanning(null,[null]);mergedQA.renderSupport(null)});
    for(const id of ['recent-receipts','categories','budgets','reminders','support-links'])assert.match(await page.locator('#'+id).textContent(),/unavailable/);
    await page.evaluate(()=>{
      mergedQA.renderReceipts([null,{id:'owned',amountYnxt:0,status:'returned',disputeUrl:'javascript:alert(1)'}],{available:true});
      mergedQA.renderSupport({helpUrl:'javascript:alert(1)',privacyUrl:'//attacker.invalid',disputeUrl:null});
      mergedQA.renderPlanning({categories:[null,{id:'food',name:'Food'}],budgets:[null,{id:'budget',name:'Owned budget',period:'monthly',limitYnxt:0}],reminders:[null,{id:'reminder',title:'Owned reminder',schedule:'weekly',amountYnxt:0}]},[null]);
    });
    assert.match(await page.locator('#recent-receipts').textContent(),/0 YNXT/);assert.equal(await page.locator('#recent-receipts a,#support-links a').count(),0);
    assert.match(await page.locator('#budgets').textContent(),/Owned budget/);assert.match(await page.locator('#reminders').textContent(),/Owned reminder/);
    await page.selectOption('select','food');await page.evaluate(()=>mergedQA.renderPlanning({categories:[{id:'food',name:'Food'}],budgets:[],reminders:[]}));assert.equal(await page.locator('select').inputValue(),'food');
    assert.equal(requests,0);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);assert.equal(page.url(),'about:blank');
  }finally{await browser.close()}
});
