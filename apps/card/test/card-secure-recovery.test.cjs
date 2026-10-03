const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function fixture() {
  const store=new Map(),module={exports:{}};
  const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const registration={exports:{}};
  vm.runInNewContext(compile('registration.ts'),{module:registration,exports:registration.exports});
  const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  vm.runInNewContext(compile('secureState.ts'),{module,exports:module.exports,window:{localStorage:storage},require:name=>{
    if(name==='react-native')return {Platform:{OS:'web'}};
    if(name==='expo-secure-store')return {};
    if(name==='./registration')return registration.exports;
    throw Error('Unexpected test dependency '+name);
  }});
  return {store,state:module.exports,registration:registration.exports};
}
test('malformed original records survive load and automatic rewrite is blocked',async()=>{
  const {store,state}=fixture();
  for(const [key,load,save] of [['registration','loadCardRegistration','saveCardRegistration'],['simulationAudit','loadSimulationAudit','saveSimulationAudit'],['authorization','loadPendingAuthorization','savePendingAuthorization']]) {
    const storageKey='ynx-card.secure.v1.'+key;store.set(storageKey,'{original interrupted record');
    await state[load]();assert.equal(store.get(storageKey),'{original interrupted record');
    await assert.rejects(state[save](null),/CARD_LOCAL_RECOVERY_REQUIRED/);
    assert.equal(store.get(storageKey),'{original interrupted record');
  }
});
test('stored ACTIVE is historical only and raw receipt/details are preserved',async()=>{
  const {store,state,registration:r}=fixture(),wallet='0x'+'a'.repeat(40);
  const draft=r.updateDraft(r.createDraft(wallet),{nickname:'Demo nickname',useCase:'Testnet practice',spendingLimitYnxt:'10',riskAccepted:true,controls:{online:true,international:false,frozen:false}});
  const active=r.completeFromSandboxReceipt(r.submitForBackend(r.requestApproval(draft,'approval-1'),'submit-1'),{approved:true,idempotencyKey:'receipt-1',receipt:'sandbox-receipt-12345678'});
  const raw=JSON.stringify(active);store.set('ynx-card.secure.v1.registration',raw);
  const restored=await state.loadCardRegistration();assert.equal(restored.status,'DEGRADED');
  assert.equal(restored.backendReceipt,active.backendReceipt);assert.equal(store.get('ynx-card.secure.v1.registration'),raw);
});
