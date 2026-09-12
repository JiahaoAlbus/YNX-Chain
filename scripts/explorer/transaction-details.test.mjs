import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../internal/explorer/web.go', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const next = source.indexOf('\n    }', start);
  assert.ok(next >= 0, name + ' end');
  return source.slice(start, next + 6);
}
const hash = '0x' + 'd1'.repeat(32);
const blockHash = '85'.repeat(32);
const detail = { hash, blockHash, blockNumber: 1476389, type: 'transfer', from:'alice', to:'bob', amount:10, fee:1, nonce:1, timestamp:'2026-09-12T10:24:20Z', logs:[{data:'0x0a'}] };
function rows(value) {
  const context = vm.createContext({t:x=>x,number:String,nativeAddress:x=>x,exactTime:x=>x});
  vm.runInContext(declaration('detailRows'), context);
  return Object.fromEntries(context.detailRows('transaction', value));
}
test('indexed transfer shows its transaction hash separately from block hash and real logs', () => {
  const actual = rows(detail);
  assert.equal(actual.transactionHash, hash);
  assert.equal(actual.blockHash, blockHash);
  assert.equal(actual.status, 'indexedInBlock');
  assert.equal(actual.includedBlock, '#1476389');
  assert.equal(actual.events, JSON.stringify(detail.logs));
});
test('missing block does not imply transaction success or finality', () => {
  const actual = rows({...detail,blockNumber:0,blockHash:'',logs:[]});
  assert.equal(actual.status, 'notIndexedInBlock');
  assert.equal(actual.includedBlock, 'unavailable');
  assert.equal(actual.events, 'none');
});
test('deep link starts even when overview never resolves', () => {
  const calls=[];
  const context=vm.createContext({language:'en',applyLanguage:()=>calls.push('language'),openDeepLink:()=>calls.push('detail'),load:()=>{calls.push('overview');return new Promise(()=>{});},showLoadError:()=>{},connectLiveStream:()=>calls.push('stream')});
  vm.runInContext(declaration('startExplorer'),context);
  context.startExplorer();
  assert.deepEqual(calls,['language','detail','overview','stream']);
});
test('canonical transaction lookup makes one request and keeps hash route', async () => {
  const nodes=new Map();const requests=[];const pushed=[];let shown;
  const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',classList:{add(){}},setAttribute(){}});return nodes.get(id);};
  const context=vm.createContext({$,t:x=>x,compact:x=>x,escapeHTML:x=>x,document:{body:{style:{}}},get:async path=>{requests.push(path);return detail;},showDrawer:(...args)=>{shown=args;},history:{pushState:(...args)=>pushed.push(args)},encodeURIComponent});
  vm.runInContext('async '+declaration('search'),context);
  await context.search(hash.toUpperCase());
  assert.deepEqual(requests,['/api/txs/'+hash]);
  assert.equal(shown[0],'transaction');assert.equal(shown[2].hash,hash);
  assert.equal(pushed[0][2],'/tx/'+hash);
});
