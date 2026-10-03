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
