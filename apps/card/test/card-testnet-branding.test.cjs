const {test}=require('node:test'),assert=require('node:assert/strict');
const {catalogs}=require('../src/i18n.ts');
test('all existing locales describe the product network as YNX Testnet, not a provider sandbox',()=>{
  for(const [locale,copy] of Object.entries(catalogs)){
    assert.match(copy.sandbox,/YNX/,locale);
    assert.doesNotMatch(copy.sandbox,/sandbox|沙盒|サンドボックス|샌드박스|BAC À SABLE|ПЕСОЧНИЦА|بيئة تجريبية/i,locale);
  }
  assert.equal(Object.keys(catalogs).length,12);
  assert.equal(catalogs.en.sandbox,'YNX TESTNET');
});
test('English card lifecycle copy remains Testnet without claiming real issuance',()=>{
  assert.equal(catalogs.en.issued,'Testnet card created');
  assert.equal(catalogs.en.spendLimit,'Testnet spending limit');
  assert.equal(catalogs.en.confirmClose,'Close this Testnet card? This cannot be undone.');
});
