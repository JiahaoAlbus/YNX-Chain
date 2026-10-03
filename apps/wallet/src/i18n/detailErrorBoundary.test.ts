import test from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LOCALES,walletCopy,walletDetailError,walletAccessibilitySummary,type WalletDetailMessage,type WalletLocale} from './i18n';

const inheritedNames=['__proto__','constructor','toString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','toLocaleString','__defineGetter__'];

test('unknown remote errors never become inherited catalog entries or crash any selected locale',()=>{
  for(const locale of SUPPORTED_LOCALES)for(const original of [...inheritedNames,' Session revoked ','Auth could not complete the request (unsafe code). Review and retry.','RPC_UNKNOWN_ORIGINAL']){
    assert.equal(walletDetailError(locale,original),walletCopy(locale,'The result could not be verified. Review and retry.')+'\n'+original,locale+': '+original);
  }
});

test('accessibility summaries translate only own catalog entries while preserving exact unknown status',()=>{
  for(const locale of SUPPORTED_LOCALES)for(const original of inheritedNames){
    const summary='Session revoked · '+original+' · The result could not be verified. Review and retry.';
    assert.equal(walletAccessibilitySummary(locale,summary),walletCopy(locale,'Session revoked')+' · '+original+' · '+walletCopy(locale,'The result could not be verified. Review and retry.'));
  }
});

test('direct catalog lookup uniformly refuses unknown names and unsupported locales without echoing input',()=>{
  for(const locale of SUPPORTED_LOCALES)for(const original of [...inheritedNames,'uncatalogued_detail_payload']){
    assert.throws(()=>walletCopy(locale,original as WalletDetailMessage),(error:unknown)=>error instanceof Error&&error.message==='Unsupported Wallet detail copy');
  }
  for(const locale of ['xx','constructor','__proto__'])assert.throws(()=>walletCopy(locale as WalletLocale,'Session revoked'),/^Error: Unsupported Wallet detail copy$/);
});

test('exact known revocation and Auth codes still use their real localized meaning without normalization',()=>{
  for(const locale of SUPPORTED_LOCALES){
    assert.equal(walletDetailError(locale,'Session revoked'),walletCopy(locale,'Session revoked'));
    assert.equal(walletDetailError(locale,'Auth could not complete the request (SESSION_NOT_REVOKED). Review and retry.'),walletCopy(locale,'Auth could not complete the request ({code}). Review and retry.',{code:'SESSION_NOT_REVOKED'}));
    assert.notEqual(walletDetailError(locale,'Revocation is not confirmed. Retry this same session to check the outcome.'),walletCopy(locale,'Session revoked'));
  }
});
