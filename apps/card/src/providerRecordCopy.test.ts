import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {locales} from './i18n';
import {providerActionText} from './providerActionCopy';
import {providerRecordKeys,providerSupplementalKeys,providerRecordText,providerStatusText,providerTransactionText} from './providerRecordCopy';
test('every static application label and recovery explanation is covered in twelve locales',()=>{
 const source=fs.readFileSync(new URL('./ProviderExperience.tsx',import.meta.url),'utf8');
 const keys=[...source.matchAll(/label\(locale,'([^']+)'/g)].map(match=>match[1]!);
 for(const locale of locales){for(const key of [...providerRecordKeys,...providerSupplementalKeys])assert.ok(providerRecordText(locale,key)?.trim(),`${locale}: ${key}`);for(const key of keys)assert.ok(providerActionText(locale,key)??providerRecordText(locale,key),`${locale}: missing ${key}`);}
 assert.doesNotMatch(providerRecordKeys.join(' '),/[\u3400-\u9fff]/);
 assert.equal(providerRecordText('en','missing'),null);
});
test('known transaction labels localize without promoting unknown transactions',()=>{
 for(const locale of locales){assert.equal(providerTransactionText(locale,'cleared'),providerRecordText(locale,'Cleared'));assert.equal(providerTransactionText(locale,'REFUND'),providerRecordText(locale,'Refund'));assert.equal(providerTransactionText(locale,'APPROVED_REAL_PAYMENT'),`${providerRecordText(locale,'Not verified')} [APPROVED_REAL_PAYMENT]`);assert.equal(providerTransactionText(locale,'unsafe remote message'),providerRecordText(locale,'Not verified'));}
});
test('provider states are TEST-labelled and unknown states never become verified or active',()=>{
 for(const locale of locales){assert.equal(providerStatusText(locale,'ACTIVE_SANDBOX'),providerRecordText(locale,'Active TEST record'));assert.equal(providerStatusText(locale,'ACTIVE_REAL'),providerRecordText(locale,'Not verified'));assert.equal(providerStatusText(locale,undefined),providerRecordText(locale,'Not verified'));assert.equal(providerStatusText(locale,'CANCELLED'),providerRecordText(locale,'Cancelled locally'));}
});
