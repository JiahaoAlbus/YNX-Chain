const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module'),React=createRequire(require.resolve('react-test-renderer'))('react'),Renderer=require('react-test-renderer');
const {evaluate,textOf}=require('./guest-experience-fixture.cjs');
const {cardFundingSendCopy}=require('../src/cardFundingSendCopy.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tick=()=>new Promise(setImmediate),hash='0x'+'a'.repeat(64);
async function mount({unknown=false,locale='en',storage=new Map(),lockAvailable=true,platform='web'}={}){
  const calls=[],discovery=[],verified=[];
  const owner='0x'+'1'.repeat(40),identity={owner,sessionBinding:'test-only-binding',expiresAt:'2099-01-01T00:00:00Z'};
  const intent={id:'intent_fixture',cardId:'card_fixture',owner,sender:owner,recipient:'0x'+'2'.repeat(40),amountWei:'1000000000000000001',chainId:'0x1917',minConfirmations:2,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2098-01-01T00:00:00Z',status:'pending'};
  const client={sourceCommit:'a'.repeat(40),async confirmTopup(...args){verified.push(args)}};
  const provider=kind=>({kind,async request(input){calls.push({kind,...input});if(input.method==='eth_accounts')return [owner];if(input.method==='eth_chainId')return '0x1917';assert.equal(input.method,'eth_sendTransaction');assert.equal(JSON.parse([...storage.values()][0]).status,'PENDING');if(unknown)throw Error('TEST_ONLY_NETWORK_LOSS');return hash}});
  const providers={ynx:provider('ynx-wallet'),metamask:provider('metamask')};
  const sdk={async discoverWalletProviders(){discovery.push(true);return {ynx:{provider:providers.ynx},metamask:{provider:providers.metamask},ambiguities:[]}},standardWalletConnection(p){return {async restore(){return {approved:true}},request:input=>p.request(input)}}};
  const rn={Platform:{OS:platform},StyleSheet:{create:x=>x},View:'View',Pressable:'Pressable'};
  const globals={window:{localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}},navigator:{locks:lockAvailable?{async request(_key,_options,operation){return operation({fixtureLock:true})}}:undefined}};
  const component=evaluate(path.resolve(__dirname,'../src/CardFundingSendExperience.tsx'),{react:React,'react-native':rn,'./cardTypography':{CardText:'Text'},'./standardWalletSdk':sdk,'./cardFundingSend':require('../src/cardFundingSend.ts'),'./cardFundingSendCopy':require('../src/cardFundingSendCopy.ts')},undefined,globals).CardFundingSendExperience;
  let renderer,props={client,identity,intent,locale,onVerified:()=>{}};
  await Renderer.act(async()=>{renderer=Renderer.create(React.createElement(component,props));await tick()});
  return {calls,discovery,verified,storage,renderer,text:()=>textOf(renderer.toJSON()),async press(index){await Renderer.act(async()=>{const copy=cardFundingSendCopy[props.locale];const button=renderer.root.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===copy[index]);assert.equal(button.props.disabled,false);button.props.onPress();await tick()})},async update(next){props={...props,...next};await Renderer.act(async()=>{renderer.update(React.createElement(component,props));await tick()})},async close(){await Renderer.act(async()=>renderer.unmount())}};
}
test('new private intent widget uses explicit distinct wallet selection, then send, then Card verification',async()=>{
  for(const index of [1,2]){
    const h=await mount();try{
      assert.equal(h.calls.length,0);assert.equal(h.discovery.length,0);assert.equal(h.verified.length,0);
      await h.press(index);assert.equal(h.calls.length,0);
      await h.press(3);assert.equal(h.calls.filter(c=>c.method==='eth_sendTransaction').length,1);assert.ok(h.calls.every(c=>c.kind===(index===1?'ynx-wallet':'metamask')));
      assert.equal(h.calls.some(c=>c.method==='eth_requestAccounts'||c.method.includes('sign')),false);
      assert.equal(h.verified.length,0);assert.match(h.text(),/No Card credit yet/);
      await h.press(5);assert.deepEqual(h.verified[0],['intent_fixture',hash,'card-funding-confirm-'+hash.slice(2)]);
    }finally{await h.close()}
  }
});
test('unknown wallet outcome survives cold start with no rediscovery or automatic send',async()=>{
  const first=await mount({unknown:true});await first.press(2);await first.press(3);const storage=first.storage,saved=[...storage.values()][0];await first.close();
  const h=await mount({storage});try{assert.match(h.text(),/unknown outcome/);assert.equal(h.calls.length,0);assert.equal(h.discovery.length,0);assert.equal([...storage.values()][0],saved);assert.equal(h.renderer.root.findAll(n=>n.type==='Pressable').length,0);}finally{await h.close()}
});
test('unsupported native platform and missing browser locks disable actions with translated feedback',async()=>{
  for(const options of [{lockAvailable:false},{platform:'ios'},{platform:'android'}]){
    const h=await mount(options);try{
      const buttons=h.renderer.root.findAll(n=>n.type==='Pressable');assert.equal(buttons.length,3);
      assert.ok(buttons.every(n=>n.props.disabled&&n.props.accessibilityState.disabled));
      await Renderer.act(async()=>{for(const button of buttons)button.props.onPress();await tick()});
      assert.equal(h.calls.length,0);assert.equal(h.discovery.length,0);assert.equal(h.storage.size,0);
      assert.match(h.text(),/Sending is unavailable/);await h.update({locale:'zh-CN'});
      assert.match(h.text(),/当前平台暂不支持发送/);assert.doesNotMatch(h.text(),/Sending is unavailable/);
    }finally{await h.close()}
  }
});
