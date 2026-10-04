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

test('actual planning rejects ambiguous duplicate identities and duplicate spending observations without losing valid neighbors',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.setContent('<div id="categories"></div><form id="budget-form"><select name="categoryId"></select></form><div id="budgets"></div><div id="reminders"></div>');
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),financeText=k=>window.YNXFinanceLocale?window.YNXFinanceLocale.text(k):k,esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');${formatters}\n${planning}\nwindow.renderPlanningQA=renderPlanning;`});
    const profile={categories:[{id:'dup',name:'Ambiguous category A'},{id:'dup',name:'Ambiguous category B'},{id:'known',name:'Known category'}],budgets:[{id:'dup',name:'Ambiguous budget A',period:'monthly',limitYnxt:1},{id:'dup',name:'Ambiguous budget B',period:'monthly',limitYnxt:2},{id:'known',name:'Known budget',period:'monthly',limitYnxt:100}],reminders:[{id:'dup',title:'Ambiguous reminder A',schedule:'weekly'},{id:'dup',title:'Ambiguous reminder B',schedule:'weekly'},{id:'known',title:'Known reminder',schedule:'weekly'}]};
    const progress=[{budgetId:'known',calculationStatus:'partial',coverageComplete:false,observedSpentYnxt:7},{budgetId:'known',calculationStatus:'partial',coverageComplete:false,observedSpentYnxt:9}];
    await page.evaluate(({profile,progress})=>renderPlanningQA(profile,progress),{profile,progress});
    assert.equal(await page.locator('option[value="dup"]').count(),0);
    for(const id of ['categories','budgets','reminders']){const text=await page.locator('#'+id).textContent();assert.doesNotMatch(text,/Ambiguous/);assert.match(text,/Known/);assert.match(text,/unavailable/);}
    const budget=await page.locator('#budgets').textContent();assert.doesNotMatch(budget,/7 YNXT|9 YNXT|partialObservation/);assert.match(budget,/calculationUnavailable/);
    await page.selectOption('select','known');await page.evaluate(p=>renderPlanningQA(p,[{budgetId:'known',calculationStatus:'partial',coverageComplete:false,observedSpentYnxt:7}]),profile);
    assert.equal(await page.locator('select').inputValue(),'known');assert.match(await page.locator('#budgets').textContent(),/7 YNXT/);
    await page.addScriptTag({content:locale});
    for(const language of await page.evaluate(()=>YNXFinanceLocale.supported)){
      const observed=await page.evaluate(({language,profile,progress})=>{
        YNXFinanceLocale.set(language);renderPlanningQA(profile,progress);
        return {sections:['categories','budgets','reminders'].map(id=>document.querySelector('#'+id).textContent),unavailable:YNXFinanceLocale.text('unavailable'),calculation:YNXFinanceLocale.text('calculationUnavailable'),selected:document.querySelector('select').value};
      },{language,profile,progress});
      for(const text of observed.sections){assert.ok(text.includes(observed.unavailable),language);assert.doesNotMatch(text,/Ambiguous/);}
      assert.ok(observed.sections[1].includes(observed.calculation),language);assert.doesNotMatch(observed.sections[1],/7 YNXT|9 YNXT/);assert.equal(observed.selected,'known');
    }
    assert.equal(page.context().pages().length,1);
  }finally{await browser.close()}
});
