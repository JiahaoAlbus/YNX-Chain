import test from 'node:test';
import assert from 'node:assert/strict';
import { privacyLanguages, privacyText } from '../privacy-i18n.js';

const expected=['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id'];
const keys=['label','title','description','exportButton','deleteLabel','deleteButton','activeBoundary','exported','exportFailed','exactRequired','deleted','deleteFailed'];

test('privacy copy covers all twelve product locales',()=>{
  assert.deepEqual([...privacyLanguages].sort(),[...expected].sort());
  for(const language of expected){
    for(const key of keys){
      const value=privacyText(language,key,{orders:2,ai:1,notice:'notice',error:'error',receipt:'receipt'});
      assert.ok(value.trim(),`${language}:${key}`);
      assert.equal(value.includes('{'),false,`${language}:${key} unresolved placeholder`);
    }
  }
});

test('non-English privacy controls do not silently use English copy',()=>{
  for(const language of expected.filter(value=>value!=='en')){
    for(const key of ['label','title','description','exportButton','deleteButton','activeBoundary','exactRequired']){
      assert.notEqual(privacyText(language,key),privacyText('en',key),`${language}:${key}`);
    }
  }
});
