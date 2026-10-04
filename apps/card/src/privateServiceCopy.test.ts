import test from 'node:test';
import assert from 'node:assert/strict';
import{locales}from './i18n';
import{privateServiceText}from './privateServiceCopy';
test('private service errors render from current locale and never repeat remote messages',()=>{
 const codes=['USER_REJECTED','PRODUCT_SESSION_EXPIRED','PRIVATE_SESSION_REQUIRED','CARD_CONTEXT_CHANGED','PRODUCT_SESSION_GATEWAY_UNREACHABLE','CARD_API_SOURCE_MISMATCH','unknown_remote_message'];
 for(const locale of locales)for(const code of codes){const text=privateServiceText(locale,code);assert.ok(text.length>10);assert.ok(!text.includes(code));if(locale==='en')assert.doesNotMatch(text,/[\u3400-\u9fff]/);if(locale==='zh-CN'||locale==='zh-TW')assert.match(text,/[\u3400-\u9fff]/);}
 assert.notEqual(privateServiceText('en',codes[4]!),privateServiceText('zh-CN',codes[4]!));
});
test('source recovery guidance preserves records and never asks for a second wallet approval',()=>{
 for(const code of ['CARD_API_SOURCE_MISMATCH','CARD_API_SOURCE_UNAVAILABLE']){
  const text=privateServiceText('en',code);
  assert.match(text,/Reload the Card page, then retry/);
  assert.match(text,/Do not clear application records or approve another wallet request/);
  assert.match(text,/Standard Wallet connection remain independent/);
 }
});
