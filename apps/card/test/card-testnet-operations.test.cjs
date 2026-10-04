const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),React=createRequire(require.resolve('react-test-renderer'))('react'),Renderer=require('react-test-renderer');
const {evaluate,textOf}=require('./guest-experience-fixture.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tick=()=>new Promise(setImmediate);
async function mount({storage=new Map(),timeout=false,locale='en',owner='qa-owner-only',events=[],recoveryAvailable=true,silentWrite=false}={}){
  const calls=[],identity={owner,sessionBinding:'qa-session-only',expiresAt:new Date(Date.now()+3600000).toISOString()};
  const statement={card:{id:'card-qa',owner,alias:'Explicit QA fixture',status:'ACTIVE'},events};
  const mutation=async(...args)=>{assert.ok(JSON.parse(storage.get(`ynx-card.testnet-operation.v1.${owner}`)).pending);calls.push(args);if(timeout)throw Error('QA_TIMEOUT')};
  const client={supportsOperationRecovery:recoveryAvailable,changeCard:mutation,updateControls:mutation,createTopupIntent:mutation,confirmTopup:mutation,authorize:mutation,settle:mutation,state:async()=>({intents:[{id:'intent-qa',cardId:'card-qa'}]}),operationResult:async()=>({status:'UNKNOWN'}),statement:async()=>statement};
  const rn={Platform:{OS:'web'},StyleSheet:{create:x=>x},...Object.fromEntries(['Modal','Pressable','ScrollView','TextInput','View'].map(x=>[x,x]))};
  const component=evaluate(path.resolve(__dirname,'../src/TestnetCardOperationsExperience.tsx'),{react:React,'react-native':rn,'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async(_,value)=>crypto.createHash('sha256').update(value).digest('hex'),randomUUID:()=>crypto.randomUUID()},'expo-secure-store':{},'./cardTypography':{CardText:'Text'},'./cardBusinessClient':{},'./cardOperationJournal':require('../src/cardOperationJournal.ts'),'./cardOperationsCopy':require('../src/cardOperationsCopy.ts'),'./cardOperationAvailabilityCopy':require('../src/cardOperationAvailabilityCopy.ts')},undefined,{window:{localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(!silentWrite)storage.set(key,value)}}},globalThis});
  let renderer,props={client,identity,statement,locale,onUpdated:()=>{}};await Renderer.act(async()=>{renderer=Renderer.create(React.createElement(component.TestnetCardOperationsExperience,props));await tick()});
  return {calls,storage,renderer,identity,statement,client,text:()=>textOf(renderer.toJSON()),async update(next){props={...props,...next};await Renderer.act(async()=>{renderer.update(React.createElement(component.TestnetCardOperationsExperience,props));await tick()})},async change(label,value){await Renderer.act(async()=>{renderer.root.find(n=>n.type==='TextInput'&&n.props.accessibilityLabel===label).props.onChangeText(value);await tick()})},async press(label){await Renderer.act(async()=>{const button=renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);assert.equal(button.props.disabled,false);button.props.onPress();await tick()})},async close(){await Renderer.act(async()=>renderer.unmount())}};
}
test('actual operation UI writes journal before explicit API action and never auto-mutates on mount',async()=>{
  const h=await mount();try{assert.equal(h.calls.length,0);await h.press('Freeze');assert.equal(h.calls.length,0);await h.press('Confirm Testnet action');assert.equal(h.calls.length,1);const journal=JSON.parse(h.storage.values().next().value);assert.equal(journal.pending,null);assert.equal(journal.history.length,1);assert.equal(journal.history[0].key,h.calls[0][2]);assert.match(h.text(),/No real payments/);}finally{await h.close()}
});
test('timeout recovery makes no automatic write and explicit retry preserves original body/key',async()=>{
  const first=await mount({timeout:true});await first.press('Freeze');await first.press('Confirm Testnet action');const original=first.calls[0],storage=first.storage;await first.close();
  const recovered=await mount({storage});try{assert.equal(recovered.calls.length,0);assert.match(recovered.text(),/Unknown outcome/);await recovered.press('Read original request result');assert.equal(recovered.calls.length,0);await recovered.press('Retry original request with the same key');assert.deepEqual(recovered.calls[0],original);}finally{await recovered.close()}
});
test('malformed journal remains untouched and disables mutation',async()=>{
  const storage=new Map([['ynx-card.testnet-operation.v1.qa-owner-only','{broken']]),h=await mount({storage});try{assert.equal(storage.values().next().value,'{broken');const button=h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Freeze');assert.equal(button.props.disabled,true);assert.equal(h.calls.length,0);}finally{await h.close()}
});
test('funding intent and transaction verification each require explicit confirmation with exact wei/hash',async()=>{
  const h=await mount();try{
    await h.press('Create YNXT funding intent');await h.change('YNXT amount','0.000000000000000001');assert.equal(h.calls.length,0);
    await h.press('Confirm Testnet action');assert.equal(h.calls[0][0],'card-qa');assert.equal(h.calls[0][1],'1');
    await h.press('Verify funding transaction');await h.change('Reference / transaction hash','intent-qa 0x'+'1'.repeat(64));
    await h.press('Confirm Testnet action');assert.equal(h.calls[1][0],'intent-qa');assert.equal(h.calls[1][1],'0x'+'1'.repeat(64));
    assert.doesNotMatch(h.text(),/credited|balance:|PAN|CVV/);
  }finally{await h.close()}
});
test('authorization is explicitly simulated and settlements require current-card event references',async()=>{
  const h=await mount({events:[{id:'event-qa',name:'card.authorization.approved',occurredAt:'QA-only',details:{authorizationId:'authorization-qa',captureId:'capture-qa'}}]});try{
    await h.press('Simulate authorization');await h.change('YNXT amount','0.1');await h.press('Confirm Testnet action');
    assert.equal(h.calls[0][1].simulation,true);assert.equal(h.calls[0][1].merchant.name,'SIMULATED MERCHANT');assert.equal(h.calls[0][1].amountWei,'100000000000000000');
    for(const [label,reference,operation] of [['Capture','authorization-qa','capture'],['Reverse','authorization-qa','reverse'],['Refund','capture-qa','refund']]){
      await h.press(label);await h.change('YNXT amount','0.01');await h.change('Reference / transaction hash',reference);await h.press('Confirm Testnet action');
      assert.deepEqual(h.calls.at(-1).slice(0,3),[reference,operation,'10000000000000000']);
    }
  }finally{await h.close()}
});
test('foreign settlement reference never reaches mutation endpoint and keeps original unknown request',async()=>{
  const h=await mount();try{
    await h.press('Capture');await h.change('YNXT amount','1');await h.change('Reference / transaction hash','authorization-other-card');await h.press('Confirm Testnet action');
    assert.equal(h.calls.length,0);assert.match(h.text(),/Unknown outcome/);assert.ok(JSON.parse(h.storage.values().next().value).pending);
  }finally{await h.close()}
});
test('switching owner never consumes previous owner pending journal or silently retries it',async()=>{
  const original=await mount({timeout:true});await original.press('Freeze');await original.press('Confirm Testnet action');const storage=original.storage,saved=storage.get('ynx-card.testnet-operation.v1.qa-owner-only');await original.close();
  const next=await mount({storage,owner:'other-qa-owner'});try{assert.equal(next.calls.length,0);assert.doesNotMatch(next.text(),/Unknown outcome/);assert.equal(storage.get('ynx-card.testnet-operation.v1.qa-owner-only'),saved);}finally{await next.close()}
});
test('Chinese operation failure stays in selected locale and disabled controls expose accessibility state',async()=>{
  const h=await mount({locale:'zh-CN',timeout:true});try{await h.press('冻结');await h.press('确认测试网操作');assert.match(h.text(),/结果未知/);assert.doesNotMatch(h.text(),/Unknown outcome|Private action unavailable/);const button=h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='冻结');assert.equal(button.props.accessibilityState.disabled,true);}finally{await h.close()}
});

test('old backend recovery absence disables new private actions without changing the existing statement',async()=>{
 const h=await mount({recoveryAvailable:false,events:[{id:'event-existing',name:'existing.testnet.event',occurredAt:'QA-only',details:{}}]});
 try{
  assert.match(h.text(),/New TEST actions are unavailable/);assert.match(h.text(),/Saved records remain readable/);assert.match(h.text(),/existing.testnet.event/);
  for(const label of ['Freeze','Create YNXT funding intent','Simulate authorization'])assert.equal(h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label).props.disabled,true);
  assert.equal(h.calls.length,0);assert.equal(h.storage.size,0);
 }finally{await h.close()}
});
test('unknown request is retained byte-for-byte when the backend lacks original-key readback',async()=>{
 const first=await mount({timeout:true});await first.press('Freeze');await first.press('Confirm Testnet action');const storage=first.storage,saved=[...storage.values()][0];await first.close();
 const h=await mount({storage,recoveryAvailable:false});
 try{
  assert.match(h.text(),/pending requests are retained/);assert.match(h.text(),/Unknown outcome/);
  assert.equal(h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Read original request result').props.disabled,true);
  assert.equal(h.calls.length,0);assert.equal([...storage.values()][0],saved);
 }finally{await h.close()}
});

test('unconfirmed local write retains reference and never dispatches mutation',async()=>{
 const h=await mount({silentWrite:true});try{await h.press('Freeze');await h.press('Confirm Testnet action');assert.equal(h.calls.length,0);assert.equal(h.storage.size,0);assert.match(h.text(),/Local recovery storage could not be confirmed/);assert.equal(h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Freeze').props.disabled,true);}finally{await h.close()}
});
test('same-owner different-card cannot read or retry another card pending request',async()=>{
 const h=await mount({timeout:true});try{await h.press('Freeze');await h.press('Confirm Testnet action');const saved=[...h.storage.values()][0];await h.update({statement:{...h.statement,card:{...h.statement.card,id:'card-other'}}});assert.match(h.text(),/belongs to another card/);assert.equal(h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Read original request result').props.disabled,true);assert.equal([...h.storage.values()][0],saved);assert.equal(h.calls.length,1);await h.update({statement:h.statement});assert.equal(h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Read original request result').props.disabled,false);}finally{await h.close()}
});
test('locale change translates an existing failure without retrying the request',async()=>{
 const h=await mount({timeout:true});try{await h.press('Freeze');await h.press('Confirm Testnet action');await h.update({locale:'zh-CN'});assert.match(h.text(),/结果未知/);assert.doesNotMatch(h.text(),/Unknown outcome/);assert.equal(h.calls.length,1);}finally{await h.close()}
});
test('expired identity hides stale statement and retains pending bytes',async()=>{
 const h=await mount({timeout:true,events:[{id:'private-event',name:'private.owner.event',occurredAt:'QA',details:{}}]});try{await h.press('Freeze');await h.press('Confirm Testnet action');const saved=[...h.storage.values()][0];await h.update({identity:{...h.identity,expiresAt:'2000-01-01T00:00:00.000Z'}});assert.doesNotMatch(h.text(),/private.owner.event|Unknown outcome/);assert.equal([...h.storage.values()][0],saved);assert.equal(h.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Freeze').props.disabled,true);}finally{await h.close()}
});
test('replacement client with unavailable recovery preserves original pending and closes modal',async()=>{
 const h=await mount({timeout:true});try{await h.press('Freeze');await h.press('Confirm Testnet action');const saved=[...h.storage.values()][0];await h.update({client:{...h.client,supportsOperationRecovery:false}});assert.match(h.text(),/New TEST actions are unavailable/);assert.equal([...h.storage.values()][0],saved);assert.equal(h.calls.length,1);assert.equal(h.renderer.root.find(n=>n.type==='Modal').props.visible,false);}finally{await h.close()}
});
test('closing confirmation and reopening does not submit or create a recovery request',async()=>{
 const h=await mount();try{await h.press('Freeze');await Renderer.act(async()=>{h.renderer.root.find(n=>n.type==='Modal').props.onRequestClose();await tick()});assert.equal(h.calls.length,0);assert.equal(h.storage.size,0);await h.press('Freeze');await h.press('Confirm Testnet action');assert.equal(h.calls.length,1);}finally{await h.close()}
});
