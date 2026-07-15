import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../',import.meta.url);
const html=await readFile(new URL('web/index.html',base),'utf8');
const js=await readFile(new URL('web/app.js',base),'utf8');
const css=await readFile(new URL('web/styles.css',base),'utf8');

test('product states its non-bank and non-custodial boundary',()=>{
  for(const phrase of ['No custody','bank account','No fiat conversion inferred','Finance cannot freeze assets']) assert.ok(html.includes(phrase),phrase);
  assert.ok(js.includes('This is not a bank statement'));
  for(const disclosure of ['Counterparty','Custody','Contract','Principal-loss risk','Fee','Liquidity risk','Jurisdiction risk','Signature boundary']) assert.ok(html.includes(disclosure),disclosure);
  for(const prohibited of ['APY 8%','Guaranteed return','Visa card balance']) assert.equal(html.includes(prohibited),false);
});
test('wallet, real-source, export and AI review paths are wired',()=>{
  for(const path of ['/api/auth/request','/api/auth/session','/api/overview','/api/statements','/api/export?format=json','/api/ai/jobs']) assert.ok(js.includes(path),path);
  assert.ok(js.includes("sessionStorage"));
  assert.ok(js.includes("crypto.randomUUID()"));
  assert.ok(js.includes("No receipt placeholders are shown"));
  assert.ok(js.includes("data-ai=apply"));
  assert.ok(js.includes("Delete draft data"));
  assert.ok(js.includes("window.confirm"));
});
test('responsive and accessibility contracts exist',()=>{
  assert.ok(html.includes('class="skip"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(css.includes('@media(max-width:720px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes('#002FA7'));
});
