import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const planning=app.slice(app.indexOf('function budgetAmount('),app.indexOf('function renderPrivacy('));
const formatters=app.slice(app.indexOf('const fmt='),app.indexOf('\n\nconst wait='));
const locale=await readFile(new URL('../web/finance-locale.js',import.meta.url),'utf8');
test('actual planning page preserves readable records, selection and truthful missing-source recovery',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.setContent('<div id="categories"></div><form id="budget-form"><select name="categoryId"></select></form><div id="budgets"></div><div id="reminders"></div>');
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),financeText=k=>k,esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');${formatters}\n${planning}\nwindow.renderPlanningQA=renderPlanning;`});
    const profile={categories:[null,{id:'food',name:'Food',color:'#123456'},{}],budgets:[null,{id:'budget',name:'Food budget',period:'monthly',limitYnxt:0},{id:'bad',name:'Wrong period',period:'daily'}],reminders:[null,{id:'reminder',title:'Check balance',schedule:'weekly',amountYnxt:0,nextDueAt:'2026-10-03T00:00:00Z'},{}]};
    await page.evaluate(p=>renderPlanningQA(p,[null,{}, {budgetId:'budget',calculationStatus:'partial',coverageComplete:false,observedSpentYnxt:0}]),profile);
    assert.match(await page.locator('#budgets').textContent(),/Food budget/);
    assert.doesNotMatch(await page.locator('#budgets').textContent(),/Wrong period/);
    assert.match(await page.locator('#reminders').textContent(),/Check balance/);
    assert.match(await page.locator('#reminders').textContent(),/0 YNXT/);
    assert.equal(await page.locator('#budget-form option').count(),2);
    await page.selectOption('select','food');
    await page.evaluate(p=>renderPlanningQA(p),profile);
    assert.equal(await page.locator('select').inputValue(),'food');
    for(const missing of [null,{}, {categories:null,budgets:'wrong',reminders:{}}]){
      await page.evaluate(p=>renderPlanningQA(p),missing);
      for(const id of ['categories','budgets','reminders'])assert.match(await page.locator('#'+id).textContent(),/unavailable/);
      assert.equal(await page.locator('select').inputValue(),'');
      assert.equal(await page.locator('option').count(),1);
    }
    await page.evaluate(()=>renderPlanningQA({categories:[],budgets:[],reminders:[]}));
    assert.match(await page.locator('#categories').textContent(),/noCategories/);
    assert.match(await page.locator('#budgets').textContent(),/createBudget/);
    assert.match(await page.locator('#reminders').textContent(),/noReminders/);
    await page.evaluate(p=>renderPlanningQA(p),profile);
    assert.equal(await page.locator('option').count(),2);
    assert.equal(page.url(),'about:blank');assert.equal(page.context().pages().length,1);
  }finally{await browser.close()}
});
test('actual planning reminders and unavailable data follow all twelve selected languages',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.setContent('<div id="categories"></div><form id="budget-form"><select name="categoryId"></select></form><div id="budgets"></div><div id="reminders"></div>');
    await page.addScriptTag({content:locale});
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),financeText=k=>YNXFinanceLocale.text(k),esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');${formatters}\n${planning}\nwindow.renderPlanningQA=renderPlanning;`});
    for(const language of await page.evaluate(()=>YNXFinanceLocale.supported)){
      const result=await page.evaluate(language=>{
        YNXFinanceLocale.set(language);
        renderPlanningQA({categories:[],budgets:[],reminders:['weekly','monthly','custom'].map((schedule,i)=>({id:String(i),title:'Owned reminder',schedule,amountYnxt:0}))});
        const reminders=document.querySelector('#reminders').textContent,labels=['weeklyLabel','monthlyLabel','customLabel'].map(key=>YNXFinanceLocale.text(key));
        renderPlanningQA(null);
        return {reminders,labels,missing:document.querySelector('#budgets').textContent,expected:YNXFinanceLocale.text('unavailable'),dir:document.documentElement.dir};
      },language);
      for(const label of result.labels)assert.ok(result.reminders.includes(label),`${language}:${label}`);
      assert.equal(result.missing,result.expected);assert.equal(result.dir,language==='ar'?'rtl':'ltr');
    }
  }finally{await browser.close()}
});
