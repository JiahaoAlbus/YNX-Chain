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
