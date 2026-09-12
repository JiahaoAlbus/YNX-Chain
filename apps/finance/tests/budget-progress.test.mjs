import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const mobile=await readFile(new URL('../mobile/App.tsx',import.meta.url),'utf8');
function harness(){
  const nodes=new Map(),element=()=>({innerHTML:'',textContent:'',value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},append(){},includePayInStatements:{},allowAiActivityContext:{},alertsEnabled:{}});
  const context={Intl,Date,Number,URL,AbortSignal,console,setTimeout,clearTimeout,setInterval,clearInterval,location:{hash:'#planning'},document:{body:element(),querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector)},querySelectorAll(){return[]},createElement:element},window:{addEventListener(){},YNXFinanceWallet:{ready:new Promise(()=>{})}},fetch(){throw new Error('No network allowed in budget VM fixture')}};
  vm.runInNewContext(source,context,{filename:'actual-finance-app.js'});
  return {context,nodes};
}
const budget={id:'own-budget',name:'Operations',period:'weekly',limitYnxt:100};
const progress={budgetId:budget.id,observedSpentYnxt:12,spentYnxt:null,remainingYnxt:null,coverageComplete:false,calculationStatus:'partial',periodTimezone:'UTC',periodStart:'2026-09-07T00:00:00Z',effectiveFrom:'2026-09-07T00:00:00Z',coverage:'Latest 100 global records only'};
function overview(b=budget,p=progress){return {portfolio:{account:'local-fixture-account',activity:[],payReceipts:[],explorerStatus:{available:false,error:'Explicit offline fixture'},payStatus:{available:false,error:'Explicit offline fixture'}},profile:{categories:[],budgets:[b],reminders:[],privacy:{}},budgetProgress:p?[p]:[],alerts:[],support:{}}}

test('actual Web overview consumes server budget progress and labels observed/full/remaining separately',()=>{
  const {context,nodes}=harness();context.render(overview());
  const html=nodes.get('#budgets').innerHTML;
  assert.match(html,/Observed spending: 12 YNXT/);assert.match(html,/Full-period spending: Unknown/);assert.match(html,/Remaining budget: Unknown/);
  assert.match(html,/2026-09-07T00:00:00Z/);assert.match(html,/Latest 100 global records only/);assert.doesNotMatch(html,/88 YNXT|12%/);
});
test('missing, unavailable, legacy and other-budget progress never become zero spending or zero percent',()=>{
  for(const p of [null,{...progress,calculationStatus:'unknown',observedSpentYnxt:null},{budgetId:budget.id,spentYnxt:0,remainingYnxt:100},{...progress,budgetId:'foreign-budget'}]){
    const {context,nodes}=harness();context.render(overview(budget,p));const html=nodes.get('#budgets').innerHTML;
    assert.match(html,/Observed spending: Unknown/);assert.match(html,/Remaining budget: Unknown/);assert.doesNotMatch(html,/Observed spending: 0|0%|Remaining budget: 100/);
  }
});
test('empty bounded observations show observed zero only; future budget and unsafe values remain unknown',()=>{
  const {context,nodes}=harness();context.render(overview(budget,{...progress,observedSpentYnxt:0}));
  assert.match(nodes.get('#budgets').innerHTML,/Observed spending: 0 YNXT/);assert.match(nodes.get('#budgets').innerHTML,/Full-period spending: Unknown/);
  context.render(overview(budget,{...progress,calculationStatus:'not-started',observedSpentYnxt:null}));assert.match(nodes.get('#budgets').innerHTML,/Budget has not started/);
  for(const value of [null,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'9007199254740993']){
    context.render(overview({...budget,limitYnxt:value},{...progress,observedSpentYnxt:value}));
    assert.match(nodes.get('#budgets').innerHTML,/Limit: Unknown/);assert.match(nodes.get('#budgets').innerHTML,/Observed spending: Unknown/);
  }
});
test('budget names and source coverage are escaped and successive account views do not retain old progress',()=>{
  const {context,nodes}=harness();context.render(overview({...budget,name:'<img src=x>'},{...progress,coverage:'<script>bad</script>'}));
  assert.doesNotMatch(nodes.get('#budgets').innerHTML,/<img|<script>/);assert.match(nodes.get('#budgets').innerHTML,/&lt;script&gt;/);
  context.render(overview({...budget,id:'second-account-budget',name:'Second account'},null));
  assert.doesNotMatch(nodes.get('#budgets').innerHTML,/12 YNXT|Operations/);assert.match(nodes.get('#budgets').innerHTML,/Observed spending: Unknown/);
});
test('native source accepts nullable progress and has no fake percent/zero fallback',async()=>{
  const types=await readFile(new URL('../mobile/src/api.ts',import.meta.url),'utf8');
  assert.match(types,/spentYnxt:number\|null;remainingYnxt:number\|null/);
  const section=mobile.slice(mobile.indexOf('<Heading small>Budget progress'),mobile.indexOf('</Card>',mobile.indexOf('<Heading small>Budget progress')));
  assert.match(section,/coverageComplete===false/);assert.match(section,/Number.isSafeInteger/);
  assert.match(section,/Full-period spending: Unknown · Remaining budget: Unknown/);
  assert.doesNotMatch(section,/spentYnxt\|\|0|pct|st\.track|st\.fill/);
});
test('changed native TSX and API types parse without emitting build artifacts',async()=>{
  const {transform}=await import('../web/node_modules/esbuild/lib/main.js');
  await transform(mobile,{loader:'tsx',target:'es2022'});
  await transform(await readFile(new URL('../mobile/src/api.ts',import.meta.url),'utf8'),{loader:'ts',target:'es2022'});
});
