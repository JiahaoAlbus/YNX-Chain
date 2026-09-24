import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const root=join(import.meta.dirname,'..','web');
const html=readFileSync(join(root,'index.html'),'utf8');
const script=readFileSync(join(root,'product-catalog.js'),'utf8');

test('guest Finance exposes four separated product channels without account access',()=>{
  assert.match(html,/id="markets"/);
  assert.match(html,/id="product-channels"/);
  assert.match(html,/Browse the official Broker Sandbox without an account/);
  assert.match(script,/finance-product-catalog-v1/);
  assert.match(script,/never-merge-balances-cost-basis-pnl-or-performance-across-channels/);
  assert.doesNotMatch(script,/eth_requestAccounts|personal_sign|eth_sendTransaction|ynxwallet:/);
});

test('catalog failure remains truthful and never fabricates balances',()=>{
  assert.match(script,/will not merge or infer product balances/);
  assert.match(script,/No enabled capabilities/);
  assert.doesNotMatch(script,/mock|demo balance|sample profit/i);
});
