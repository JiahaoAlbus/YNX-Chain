const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mountGuest}=require('./guest-experience-fixture.cjs');

test('Web navigation exposes one selected section before and after local controls change',async()=>{
  const app=await mountGuest({platform:'web',fontScale:1});
  try{
    const tabs=()=>app.renderer.root.findAll(n=>n.type==='Pressable'&&n.props.accessibilityRole==='tab');
    assert.equal(tabs().filter(n=>n.props['aria-selected']===true).length,1);
    await app.tab('Spending Controls');await app.change('Freeze simulated card',true);
    assert.equal(tabs().filter(n=>n.props['aria-selected']===true).length,1);
    assert.equal(tabs().find(n=>n.props['aria-selected']===true).props.accessibilityState.selected,true);
  }finally{await app.unmount()}
});
test('Native sections retain native selection attributes without Web-only aria props',async()=>{
  const app=await mountGuest({platform:'android',fontScale:1});
  try{
    await app.tab('Spending Controls');
    const tabs=app.renderer.root.findAll(n=>n.type==='Pressable'&&n.props.accessibilityRole==='tab');
    assert.equal(tabs.filter(n=>n.props.accessibilityState.selected).length,1);
    assert.ok(tabs.every(n=>!Object.hasOwn(n.props,'aria-selected')));
  }finally{await app.unmount()}
});

test('Guest control changes stay in Controls and preserve their actual local state',async()=>{
  const app=await mountGuest({platform:'web',fontScale:1});
  try{
    await app.tab('Spending Controls');
    for(const [label,value] of [['Freeze simulated card',true],['Online merchant simulation',false],['International merchant simulation',true]]){
      await app.change(label,value);
      const control=app.renderer.root.find(n=>n.type==='Switch'&&n.props.accessibilityLabel===label);
      assert.equal(control.props.value,value);
      assert.equal(app.renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityRole==='tab'&&n.props.accessibilityState?.selected).findAll(n=>n.type==='Text').map(n=>n.children.join('')).join(''),'Spending Controls');
    }
    await app.change('Freeze simulated card',false);
    assert.match(app.text(),/Simulated card unfrozen recorded locally/);
    assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask,0);
  }finally{await app.unmount()}
});
test('local controls audit remains visible through explicit Activity navigation',async()=>{
  const app=await mountGuest({platform:'web',fontScale:1});
  try{
    await app.tab('Spending Controls');await app.change('Freeze simulated card',true);await app.tab('Activity');
    assert.match(app.text(),/Simulated card frozen/);assert.match(app.text(),/Local freeze applied/);assert.match(app.text(),/DEMO/);
    await app.tab('Spending Controls');assert.equal(app.renderer.root.find(n=>n.type==='Switch'&&n.props.accessibilityLabel==='Freeze simulated card').props.value,true);
  }finally{await app.unmount()}
});
test('explicit Virtual Card demos still lead to Activity without creating Wallet or private identity',async()=>{
  const app=await mountGuest({platform:'web',fontScale:1});
  try{
    await app.tab('Virtual Card');await app.press(app.buttons('Simulate authorization')[0]);
    assert.match(app.text(),/Authorization decision prepared locally/);assert.match(app.text(),/They are not chain transactions/);
    assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask,0);
  }finally{await app.unmount()}
});

test('Web guest controls and audit survive a real component cold remount without Wallet authority',async()=>{
 const records=new Map(),guestStorage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)};
 let app=await mountGuest({platform:'web',fontScale:1,guestStorage});
 try{
  await app.tab('Spending Controls');await app.change('Freeze simulated card',true);
  await app.change('Online merchant simulation',false);
  await app.tab('Virtual Card');await app.press(app.buttons('Simulate authorization')[0]);
  await app.unmount();app=await mountGuest({platform:'web',fontScale:1,guestStorage});
  await app.tab('Activity');assert.match(app.text(),/Authorization decision prepared locally/);assert.match(app.text(),/Local freeze applied/);
  await app.tab('Spending Controls');
  assert.equal(app.renderer.root.find(n=>n.type==='Switch'&&n.props.accessibilityLabel==='Freeze simulated card').props.value,true);
  assert.equal(app.renderer.root.find(n=>n.type==='Switch'&&n.props.accessibilityLabel==='Online merchant simulation').props.value,false);
  assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask,0);
  assert.match(app.text(),/Not an account or on-chain history/);
 }finally{await app.unmount()}
});
test('damaged guest storage remains untouched and the rendered UI warns that new changes were not saved',async()=>{
 let raw='{damaged',writes=0;
 const app=await mountGuest({platform:'web',fontScale:1,guestStorage:{getItem:()=>raw,setItem:value=>{writes++;raw=value}}});
 try{
  await app.tab('Virtual Card');await app.press(app.buttons('Simulate refund')[0]);
  assert.match(app.text(),/Existing DEMO storage was preserved/);assert.match(app.text(),/New changes could not be saved/);
  assert.equal(raw,'{damaged');assert.equal(writes,0);assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask,0);
 }finally{await app.unmount()}
});

test('source mismatch task dialog preserves guest access and does not request any Wallet permission',async()=>{
 const app=await mountGuest({platform:'web',fontScale:1,props:{businessClientError:'CARD_API_SOURCE_MISMATCH'}});
 try{
  assert.equal(app.renderer.root.findAll(n=>n.type==='Modal'&&n.props.visible).length,1);
  assert.match(app.text(),/Card service verification/);assert.match(app.text(),/Do not clear application records/);
  await app.press(app.buttons('Continue as guest')[0]);
  assert.equal(app.renderer.root.findAll(n=>n.type==='Modal').length,0);
  assert.match(app.text(),/Understand card flows/);
  assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask+app.calls.pageReloads,0);
  await app.update({businessClientError:undefined});await app.update({businessClientError:'CARD_API_SOURCE_MISMATCH'});
  assert.equal(app.renderer.root.findAll(n=>n.type==='Modal'&&n.props.visible).length,1);
 }finally{await app.unmount()}
});
test('page reload is an explicit two-step recovery action, not a private authorization retry',async()=>{
 const app=await mountGuest({platform:'web',fontScale:1,props:{businessClientError:'CARD_API_SOURCE_UNAVAILABLE'}});
 try{
  await app.press(app.buttons('Reload Card page')[0]);assert.equal(app.calls.pageReloads,0);
  assert.match(app.text(),/Unsaved form edits may be lost/);assert.match(app.text(),/does not approve Wallet access/);
  await app.press(app.buttons('Keep this page')[0]);assert.equal(app.calls.pageReloads,0);
  await app.press(app.buttons('Reload Card page')[0]);await app.press(app.buttons('Confirm page reload')[0]);
  assert.equal(app.calls.pageReloads,1);assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask,0);
  assert.equal(app.calls.writes,0);
 }finally{await app.unmount()}
});
test('native source recovery never pretends it can reload or authorize a standard Web wallet',async()=>{
 const app=await mountGuest({platform:'ios',fontScale:1,props:{businessClientError:'CARD_API_SOURCE_MISMATCH'}});
 try{
  assert.equal(app.buttons('Reload Card page').length,0);
  const modal=app.renderer.root.find(n=>n.type==='Modal');
  assert.equal(typeof modal.props.onRequestClose,'function');
  await app.press(app.buttons('Keep this page')[0]);
  assert.equal(app.calls.native+app.calls.pageReloads,0);
 }finally{await app.unmount()}
});

test('every source dialog locale uses local safe error copy and scalable 48px actions',async()=>{
 const {locales}=require('../src/i18n.ts');
 const {privateServiceText}=require('../src/privateServiceCopy.ts');
 const {flattenStyle,textOf}=require('./guest-experience-fixture.cjs');
 for(const locale of locales){
  const app=await mountGuest({platform:'web',locale,fontScale:2,props:{businessClientError:'CARD_API_SOURCE_MISMATCH'}});
  try{
   const modal=app.renderer.root.find(n=>n.type==='Modal');
   assert.ok(textOf(modal).includes(privateServiceText(locale,'CARD_API_SOURCE_MISMATCH')));
   if(locale==='en')assert.doesNotMatch(textOf(modal),/[\u3400-\u9fff]/);
   for(const button of modal.findAll(n=>n.type==='Pressable'))assert.ok(flattenStyle(button.props.style).minHeight>=48);
   for(const text of modal.findAll(n=>n.type==='Text')){assert.notEqual(text.props.allowFontScaling,false);assert.equal(text.props.numberOfLines,undefined)}
   assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask,0);
  }finally{await app.unmount()}
 }
});

test('all saved DEMO audit entries are reachable after cold remount without modifying history or contacting a wallet',async()=>{
 const {GuestSandboxJournal}=require('../src/guestSandboxJournal.ts');
 const {textOf}=require('./guest-experience-fixture.cjs');
 const records=new Map(),guestStorage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)};
 const journal=new GuestSandboxJournal(guestStorage);
 assert.equal(journal.save({...journal.snapshot,events:Array.from({length:12},(_,index)=>({id:12-index,label:'Simulate authorization',detail:'Authorization decision prepared locally'}))}),true);
 const original=[...records.values()][0];
 const app=await mountGuest({platform:'web',fontScale:2,guestStorage});
 try{
  await app.tab('Activity');
  const rows=()=>app.renderer.root.findAll(n=>n.type==='Text'&&textOf(n)==='Simulate authorization').length;
  assert.equal(rows(),5);assert.match(app.text(),/Viewing 5 of 12 local DEMO events/);
  await app.press(app.buttons('Show more DEMO events')[0]);assert.equal(rows(),10);
  await app.press(app.buttons('Show more DEMO events')[0]);assert.equal(rows(),12);
  assert.match(app.text(),/Viewing 12 of 12 local DEMO events/);assert.equal(app.buttons('Show more DEMO events').length,0);
  assert.equal([...records.values()][0],original);assert.equal(app.calls.chooser+app.calls.native+app.calls.metamask,0);
 }finally{await app.unmount()}
});
