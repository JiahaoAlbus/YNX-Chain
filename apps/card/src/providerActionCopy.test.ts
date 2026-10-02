import test from 'node:test';
import assert from 'node:assert/strict';
import {locales} from './i18n';
import {providerActionKeys,providerActionText} from './providerActionCopy';
test('TEST actions and cancellation review have distinct complete strings in all twelve locales',()=>{
 for(const locale of locales)for(const key of providerActionKeys){const value=providerActionText(locale,key);assert.ok(value&&value.trim(),`${locale}: ${key}`);if(locale!=='en'&&!(locale==='fr'&&key==='Transactions'))assert.notEqual(value,key,`${locale}: untranslated ${key}`);}
 assert.equal(providerActionText('en','unknown'),null);
 assert.match(providerActionText('en',providerActionKeys[23])!,/does not confirm upstream cancellation or revoke Wallet access/);
 assert.doesNotMatch(providerActionKeys.join(' '),/[\u3400-\u9fff]/);
});
