import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('balance refresh coalesces, retains the last value on failure and fences account switches', async () => {
  const source = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
  const begin = source.indexOf('function clearAssetBalance() {');
  const end = source.indexOf('document.querySelector("#refresh-balance")', begin);
  assert(begin >= 0 && end > begin);
  const nodes = new Map();
  const document = {querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {textContent:''});
    return nodes.get(selector);
  }};
  const waiting = [];
  const wallet = {balance:() => new Promise(resolve => waiting.push(resolve))};
  let tick;
  const create = new Function('document','window','setInterval','copyUI',
    `let activeAccount='A', balanceRevision=0;
    ${source.slice(begin,end)}
    return {refreshAssets,clearAssetBalance,setAccount:value=>{activeAccount=value}};`);
  const ui = create(document,{ynxWallet:wallet},fn=>{tick=fn;},(node,key)=>{node.textContent=key;});
  const balance = account => ({ok:true,value:{account,formatted:'12',transferEnabled:true,checkedAt:'2026-11-14T00:00:00Z'}});
  const first = ui.refreshAssets();
  tick();
  assert.equal(waiting.length,1);
  waiting.shift()(balance('A')); await first;
  assert.equal(nodes.get('#balance-value').textContent,'12');
  const failure = ui.refreshAssets();
  waiting.shift()({ok:false}); await failure;
  assert.equal(nodes.get('#balance-value').textContent,'12');
  assert.match(nodes.get('#balance-status').textContent,/Last updated/);
  const old = ui.refreshAssets();
  ui.clearAssetBalance(); ui.setAccount('B'); ui.refreshAssets();
  waiting.shift()(balance('A')); await old;
  assert.equal(nodes.get('#balance-value').textContent,'—');
  assert.equal(waiting.length,1);
  waiting.shift()(balance('B')); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('#balance-value').textContent,'12');
});

test('synchronous balance bridge failure does not wedge future polling or alter decimal precision',async()=>{
  const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('function clearAssetBalance() {'),end=source.indexOf('document.querySelector("#refresh-balance")',begin);
  assert(begin>=0&&end>begin);
  const nodes=new Map(),document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:''});return nodes.get(selector);}};
  const exact='9007199254740993.123456789012345678';let calls=0,tick;
  const wallet={balance(){calls++;if(calls===1||calls===3)throw Error('PUBLIC synchronous bridge failure');return Promise.resolve({ok:true,value:{account:'A',formatted:exact,transferEnabled:true,checkedAt:'2026-11-14T00:00:00Z'}});}};
  const create=new Function('document','window','setInterval','copyUI',`let activeAccount='A', balanceRevision=0; ${source.slice(begin,end)} return {refreshAssets};`);
  const ui=create(document,{ynxWallet:wallet},fn=>{tick=fn;},(node,key)=>{node.textContent=key});
  await ui.refreshAssets();assert.equal(calls,1);tick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2,'next three-second tick must start a new read');
  assert.equal(nodes.get('#balance-value').textContent,exact);assert.equal(nodes.get('#asset-balance').textContent,`${exact} YNXT`);
  await ui.refreshAssets();assert.equal(calls,3);assert.equal(nodes.get('#balance-value').textContent,exact);
  assert.match(nodes.get('#balance-status').textContent,/Last updated/);
  tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);assert.equal(nodes.get('#balance-value').textContent,exact);
});
test('new account refresh is not blocked by an earlier account that never returns',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),begin=source.indexOf('function clearAssetBalance() {'),end=source.indexOf('document.querySelector("#refresh-balance")',begin),nodes=new Map(),waiting=[];
 const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:''});return nodes.get(selector);}};
 const wallet={balance:()=>new Promise(resolve=>waiting.push(resolve))};let tick;
 const create=new Function('document','window','setInterval','copyUI',`let activeAccount='A', balanceRevision=0;${source.slice(begin,end)}return {refreshAssets,clearAssetBalance,setAccount:value=>{activeAccount=value}};`);
 const ui=create(document,{ynxWallet:wallet},fn=>tick=fn,(node,key)=>node.textContent=key);
 void ui.refreshAssets();assert.equal(waiting.length,1);ui.clearAssetBalance();ui.setAccount('B');const current=ui.refreshAssets();assert.equal(waiting.length,2,'B must not wait for A');tick();assert.equal(waiting.length,2,'one in-flight read per current account');
 waiting[1]({ok:true,value:{account:'B',formatted:'9007199254740993',transferEnabled:true,checkedAt:'2026-11-14T00:00:00Z'}});await current;
 assert.equal(nodes.get('#balance-value').textContent,'9007199254740993');
});
test('late retired account cannot clear the current flight or publish stale balance',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),begin=source.indexOf('function clearAssetBalance() {'),end=source.indexOf('document.querySelector("#refresh-balance")',begin),nodes=new Map(),waiting=[];
 const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:''});return nodes.get(selector);}};let tick;
 const ui=new Function('document','window','setInterval','copyUI',`let activeAccount='A', balanceRevision=0;${source.slice(begin,end)}return {refreshAssets,clearAssetBalance,setAccount:value=>{activeAccount=value}};`)(document,{ynxWallet:{balance:()=>new Promise(resolve=>waiting.push(resolve))}},fn=>tick=fn,(node,key)=>node.textContent=key);
 const original=ui.refreshAssets();ui.clearAssetBalance();ui.setAccount('B');const current=ui.refreshAssets();
 const value=(account,formatted)=>({ok:true,value:{account,formatted,transferEnabled:true,checkedAt:'2026-11-14T00:00:00Z'}});
 waiting[0](value('A','123'));await original;assert.equal(nodes.get('#balance-value').textContent,'—');tick();assert.equal(waiting.length,2,'retired completion must not clear B flight');
 waiting[1](value('B','9007199254740993.123456789012345678'));await current;assert.equal(nodes.get('#balance-value').textContent,'9007199254740993.123456789012345678');
 ui.clearAssetBalance();ui.setAccount('A');assert.equal(nodes.get('#balance-value').textContent,'—');const restored=ui.refreshAssets();assert.equal(waiting.length,3);waiting[2](value('A','1'));await restored;assert.equal(nodes.get('#balance-value').textContent,'1');
});
test('returning to a still-pending account does not start a duplicate account read',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),begin=source.indexOf('function clearAssetBalance() {'),end=source.indexOf('document.querySelector("#refresh-balance")',begin),nodes=new Map(),pending=[];
 const doc={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:''});return nodes.get(selector);}};
 const ui=new Function('document','window','setInterval','copyUI',`let activeAccount='A', balanceRevision=0;${source.slice(begin,end)}return {refreshAssets,clearAssetBalance,setAccount:value=>{activeAccount=value}};`)(doc,{ynxWallet:{balance:()=>new Promise(resolve=>pending.push(resolve))}},()=>{},(node,key)=>node.textContent=key);
 const old=ui.refreshAssets();ui.clearAssetBalance();ui.setAccount('B');const other=ui.refreshAssets();ui.clearAssetBalance();ui.setAccount('A');const returning=ui.refreshAssets();assert.equal(pending.length,2);
 const value=(account,formatted)=>({ok:true,value:{account,formatted,transferEnabled:true,checkedAt:'2026-11-14T00:00:00Z'}});
 pending[1](value('B','2'));await other;assert.equal(nodes.get('#balance-value').textContent,'—');
 pending[0](value('A','1'));await Promise.all([old,returning]);assert.equal(pending.length,3,'new A read follows stale A completion');assert.equal(nodes.get('#balance-value').textContent,'—');
 pending[2](value('A','3'));await new Promise(resolve=>setImmediate(resolve));assert.equal(nodes.get('#balance-value').textContent,'3');
});
test('a timed-out old A may recover once without creating unbounded real IPCs',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),begin=source.indexOf('function clearAssetBalance() {'),end=source.indexOf('document.querySelector("#refresh-balance")',begin),nodes=new Map(),requests=[],timers=[];
 const doc={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:''});return nodes.get(selector);}};
 const timer=(fn,ms)=>{const item={fn,ms,active:true};timers.push(item);return item},clear=item=>item.active=false;
 const ui=new Function('document','window','setInterval','copyUI','setTimeout','clearTimeout',`let activeAccount='A', balanceRevision=0;${source.slice(begin,end)}return {refreshAssets,clearAssetBalance,setAccount:value=>{activeAccount=value}};`)(doc,{ynxWallet:{balance:()=>new Promise(resolve=>requests.push(resolve))}},()=>{},(node,key)=>node.textContent=key,timer,clear);
 const stale=ui.refreshAssets();ui.clearAssetBalance();ui.setAccount('B');const b=ui.refreshAssets();ui.clearAssetBalance();ui.setAccount('A');const returning=ui.refreshAssets();assert.equal(requests.length,2);
 const value=(account,formatted)=>({ok:true,value:{account,formatted,transferEnabled:true,checkedAt:'2026-11-14T00:00:00Z'}});
 requests[1](value('B','2'));await b;assert.ok(timers.some(t=>t.active&&t.ms===75000),'a logical deadline must exist');
 timers.find(t=>t.active&&t.ms===75000).fn();await Promise.all([stale,returning]);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,3,'second A read may start when a real slot is free');
 for(let i=0;i<5;i++){const running=timers.find(t=>t.active&&t.ms===75000);if(running){running.active=false;running.fn();await new Promise(resolve=>setImmediate(resolve));}await ui.refreshAssets();assert.equal(requests.length,3,'two hung underlying calls must cap further attempts');}
 requests[2](value('A','9007199254740993.123456789012345678'));await new Promise(resolve=>setImmediate(resolve));const fresh=ui.refreshAssets();assert.equal(requests.length,4);requests[3](value('A','9007199254740993.123456789012345678'));await fresh;assert.equal(nodes.get('#balance-value').textContent,'9007199254740993.123456789012345678');
});
test('late timed-out reads cannot overwrite or clear newer account reads; real slots remain capped',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),begin=source.indexOf('function clearAssetBalance() {'),end=source.indexOf('document.querySelector("#refresh-balance")',begin),nodes=new Map(),requests=[],timers=[];
 const doc={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:''});return nodes.get(selector);}};
 const timer=(fn,ms)=>{const item={fn,ms,active:true};timers.push(item);return item},clear=item=>item.active=false;
 const ui=new Function('document','window','setInterval','copyUI','setTimeout','clearTimeout',`let activeAccount='A', balanceRevision=0;${source.slice(begin,end)}return {refreshAssets,clearAssetBalance,setAccount:value=>{activeAccount=value}};`)(doc,{ynxWallet:{balance:()=>new Promise(resolve=>requests.push(resolve))}},()=>{},(node,key)=>node.textContent=key,timer,clear);
 const a=ui.refreshAssets();ui.clearAssetBalance();ui.setAccount('B');const b=ui.refreshAssets();timers[0].fn();await a;assert.equal(nodes.get('#balance-value').textContent,'—');
 ui.clearAssetBalance();ui.setAccount('C');await ui.refreshAssets();assert.equal(requests.length,2);assert.match(nodes.get('#balance-status').textContent,/earlier requests/);
 const value=(account,formatted)=>({ok:true,value:{account,formatted,transferEnabled:true,checkedAt:'2026-11-14T00:00:00Z'}});
 requests[0](value('A','55'));await new Promise(resolve=>setImmediate(resolve));assert.equal(nodes.get('#balance-value').textContent,'—');const c=ui.refreshAssets();assert.equal(requests.length,3);
 requests[1](value('B','66'));await b;assert.equal(nodes.get('#balance-value').textContent,'—');ui.refreshAssets();assert.equal(requests.length,3,'old B completion cannot clear the C flight');
 requests[2](value('C','9007199254740993'));await c;assert.equal(nodes.get('#balance-value').textContent,'9007199254740993');
});
