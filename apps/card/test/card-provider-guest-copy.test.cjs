const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const file=path.resolve(__dirname,'../src/providerGuestCopy.ts');
const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exportsCopy={};vm.runInNewContext(output,{exports:exportsCopy});
const {providerGuestText:text,providerGuestErrorText:error}=exportsCopy;
const locales=['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id'];
for(const locale of locales){
  test(`${locale}: every guest private-service label has explicit copy`,()=>{
    for(const key of ['title','permission','authorize','revoke','unavailable']){
      assert.ok(text(locale,key).length>0);
      if(locale!=='en')assert.notEqual(text(locale,key),text('en',key));
    }
  });
  test(`${locale}: classified error preserves code without replacing locale`,()=>{
    const message=error(locale,'CARD_API_SOURCE_MISMATCH');
    assert.ok(message.startsWith(text(locale,'unavailable')));
    assert.ok(message.endsWith('(CARD_API_SOURCE_MISMATCH)'));
  });
}
test('undefined preference uses English and explicit traditional Chinese is distinct',()=>{
  assert.equal(text(undefined,'permission'),text('en','permission'));
  assert.notEqual(text('zh-TW','authorize'),text('zh-CN','authorize'));
});
test('unbounded or raw errors cannot expose developer details',()=>{
  for(const raw of ['secret bearer token value','<script>bad</script>','A'.repeat(81),{message:'developer secret'},null])assert.equal(error('ar',raw),text('ar','unavailable'));
});
test('locale changes translate the same existing classified failure',()=>{
  const code='CARD_API_TIMEOUT';const en=error('en',code),ar=error('ar',code);
  assert.notEqual(en,ar);assert.equal(error('en',code),en);assert.doesNotMatch(ar,/Card private services are unavailable/);
});
test('Guest consumes locale copy for every wrapper action and error',()=>{
  const guest=fs.readFileSync(path.resolve(__dirname,'../src/GuestExperience.tsx'),'utf8');
  for(const key of ['title','permission','authorize','revoke'])assert.ok(guest.includes(`providerGuestText(locale,'${key}')`));
  assert.ok(guest.includes('providerGuestErrorText(locale,providerClientError)'));
  assert.doesNotMatch(guest,/>\{providerClientError\}</);
});
