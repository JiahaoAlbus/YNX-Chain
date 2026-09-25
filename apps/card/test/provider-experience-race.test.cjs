const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {createRequire}=require('node:module');
const React=createRequire(require.resolve('react-test-renderer'))('react');
const Renderer=require('react-test-renderer');
const {act}=Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const tick=()=>new Promise(setImmediate);
const applications=['A','B'].map(id=>({id,nickname:`Card ${id}`,status:'ACTIVE',programId:'test',provider:'immersve',testSpendingLimitMinor:'100',cardAccountCurrency:'USD',minorUnitDigits:2,walletApprovalVerified:false}));
const card=id=>({card:{cardId:id,lastFour:`${id}222`,status:'active',isBlocked:false,sourceAsOf:'2026-09-25T12:00:00Z'}});
const funding=id=>({fundingSourceId:`source-${id}`,balanceMinor:`${id}-funds`,decimals:2,balanceCurrency:'USD',fundingNetwork:'TEST',observedAt:'2026-09-25T12:00:00Z'});

function mount(overrides={}){
  const calls={status:[],funding:[],history:[],control:[]};let unmounted=false,lateWrites=0,renderer;
  const observedReact={...React,useState(initial){const [value,set]=React.useState(initial);return[value,next=>{if(unmounted)lateWrites++;set(next)}]}};
  const rn={Platform:{OS:'web'},StyleSheet:{create:value=>value},Linking:{addEventListener:()=>({remove(){}}),getInitialURL:async()=>null,openURL:async()=>{}},...Object.fromEntries(['ActivityIndicator','Pressable','Switch','Text','TextInput','View'].map(name=>[name,name]))};
  const modules={react:observedReact,'react-native':rn,'expo-secure-store':{},'@ynx-chain/wallet-auth-card-provider-v2':{encodeCardApplicationApprovalWalletURL:()=>{throw Error('wallet launch prohibited')}},'../vendor/product-session-registry-b754ffc42.json':{products:[]},'./providerApplicationClient':{},'./providerAmounts':{formatProviderAmount:value=>value==null?null:String(value),parseProviderLimit:value=>value,providerBlockState:value=>value==null?'unknown':value?'blocked':'unblocked'},'./providerApprovalJournal':{approvalJournalKey:owner=>owner,readApprovalJournal:()=>({}),rememberApproval:()=>({}),savedApproval:()=>null}};
  const sourcePath=path.resolve(__dirname,'../src/ProviderExperience.tsx');
  const js=ts.transpileModule(fs.readFileSync(sourcePath,'utf8'),{fileName:sourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const exports={};
  vm.runInNewContext(js,{exports,module:{exports},require(name){if(Object.hasOwn(modules,name))return modules[name];throw Error('Unexpected dependency '+name)},window:{location:{href:'https://card.ynxweb4.com/'},localStorage:{getItem:()=>null},history:{replaceState(){}}},URL,Uint8Array,Date,Promise,console,setTimeout,clearTimeout,globalThis},{filename:sourcePath});
  const client={currentOwner:()=> 'owner-test',programs:async()=>[],listApplications:async()=>applications,financeConsent:async()=>null,...Object.fromEntries(['status','funding','history','control'].map(name=>[name,(id,...args)=>{calls[name].push({id,args});return overrides[name]?.(id,...args)??Promise.resolve(name==='status'?card(id):name==='funding'?funding(id):name==='history'?{items:[],nextCursor:null}:{status:'CONFIRMED'})}]))};
  const texts=()=>renderer.root.findAllByType('Text').map(node=>node.children.filter(value=>typeof value==='string').join(''));
  const press=async label=>{const node=renderer.root.findAllByType('Pressable').find(item=>item.props.accessibilityLabel===label||item.findAllByType('Text').some(text=>text.children.join('').includes(label)));assert(node,`Missing action ${label}`);assert.notEqual(node.props.disabled,true,`Disabled action ${label}`);await act(async()=>{node.props.onPress();await tick()})};
  return {calls,client,texts,press,get spinning(){return renderer.root.findAllByType('ActivityIndicator').length>0},get lateWrites(){return lateWrites},async start(){await act(async()=>{renderer=Renderer.create(React.createElement(exports.ProviderExperience,{client,locale:'en',platform:'web'}));await tick()});return this},async settle(fn){await act(async()=>{fn();await tick()})},async unmount(){await act(async()=>{unmounted=true;renderer.unmount();await tick()})}};
}

test('A late status and funding cannot replace B under the B heading',async()=>{
  const aStatus=deferred(),aFunding=deferred(),bStatus=deferred(),bFunding=deferred();
  const app=await mount({status:id=>id==='A'?aStatus.promise:bStatus.promise,funding:id=>id==='A'?aFunding.promise:bFunding.promise}).start();
  await app.press('Card B');
  await app.settle(()=>{bStatus.resolve(card('B'));bFunding.resolve(funding('B'))});
  await app.settle(()=>{aStatus.resolve(card('A'));aFunding.resolve(funding('A'))});
  const text=app.texts().join(' ');
  assert.match(text,/Card:.*B222.*active/);
  assert.match(text,/B-funds/);
  assert.doesNotMatch(text,/A222|A-funds/);
  await app.unmount();
});

test('A to B to A rejects the first A generation and keeps the second A readback',async()=>{
  const first=deferred(),second=deferred();let aReads=0;
  const app=await mount({status:id=>id==='A'?(++aReads===1?first.promise:second.promise):Promise.resolve(card('B'))}).start();
  await app.press('Card B');await app.press('Card A');
  await app.settle(()=>second.resolve({card:{...card('A').card,lastFour:'NEW2'}}));
  await app.settle(()=>first.resolve({card:{...card('A').card,lastFour:'OLD1'}}));
  assert.match(app.texts().join(' '),/NEW2/);
  assert.doesNotMatch(app.texts().join(' '),/OLD1/);
  await app.unmount();
});

for(const kind of ['status','funding'])test(`manual A ${kind} readback cannot replace B after selection`,async()=>{
  const old=deferred();let aReads=0;
  const app=await mount({[kind]:id=>id==='A'?(++aReads===1?Promise.resolve(kind==='status'?card('A'):funding('A')):old.promise):Promise.resolve(kind==='status'?card('B'):funding('B'))}).start();
  await app.press(kind==='status'?'Read provider status':'Read funding source');await app.press('Card B');
  await app.settle(()=>old.resolve(kind==='status'?{card:{...card('A').card,lastFour:'OLD1'}}:{...funding('A'),balanceMinor:'OLD-FUNDS'}));
  const text=app.texts().join(' ');
  assert.match(text,/Card:.*B222/);
  assert.match(text,/B-funds/);
  assert.doesNotMatch(text,/OLD1|OLD-FUNDS/);
  await app.unmount();
});

test('late A history cannot replace B or clear B loading state',async()=>{
  const oldPage=deferred(),newPage=deferred();
  const app=await mount({history:id=>id==='A'?oldPage.promise:newPage.promise}).start();
  await app.press('Read history');await app.press('Card B');await app.press('Read history');
  await app.settle(()=>oldPage.resolve({items:[{id:'old-transaction',status:'old',paymentType:'OLD_TX',amountMinor:'1',currency:'USD',minorUnitDigits:2,reconciliation:'old',occurredAt:null}],nextCursor:'old-cursor'}));
  assert.equal(app.spinning,true);
  assert.doesNotMatch(app.texts().join(' '),/OLD_TX/);
  await app.settle(()=>newPage.resolve({items:[{id:'new-transaction',status:'new',paymentType:'NEW_TX',amountMinor:'2',currency:'USD',minorUnitDigits:2,reconciliation:'new',occurredAt:null}],nextCursor:null}));
  assert.match(app.texts().join(' '),/NEW_TX/);
  assert.doesNotMatch(app.texts().join(' '),/OLD_TX/);
  await app.unmount();
});

test('old A error cannot appear under B or stop a pending B request',async()=>{
  const oldStatus=deferred(),newStatus=deferred();let aReads=0,bReads=0;
  const app=await mount({status:id=>id==='A'?(++aReads===1?Promise.resolve(card('A')):oldStatus.promise):(++bReads===1?Promise.resolve(card('B')):newStatus.promise)}).start();
  await app.press('Read provider status');await app.press('Card B');await app.press('Read provider status');
  await app.settle(()=>oldStatus.reject(Error('OLD_CARD_ERROR')));
  assert.equal(app.spinning,true);
  assert.doesNotMatch(app.texts().join(' '),/OLD_CARD_ERROR/);
  await app.settle(()=>newStatus.resolve(card('B')));
  assert.match(app.texts().join(' '),/Card:.*B222/);
  await app.unmount();
});

test('an A load-more page cannot append into B or change B pagination cursor',async()=>{
  const lateA=deferred();
  const item=(id)=>({id,status:'cleared',paymentType:id,amountMinor:'1',currency:'USD',minorUnitDigits:2,reconciliation:'observed',occurredAt:null});
  const app=await mount({history:(id,cursor)=>id==='A'?(cursor?lateA.promise:Promise.resolve({items:[item('A-FIRST')],nextCursor:'A2'})):Promise.resolve(cursor?{items:[item('B-SECOND')],nextCursor:null}:{items:[item('B-FIRST')],nextCursor:'B2'})}).start();
  await app.press('Read history');await app.press('Load more');await app.press('Card B');await app.press('Read history');
  await app.settle(()=>lateA.resolve({items:[item('A-SECOND')],nextCursor:'A3'}));
  assert.match(app.texts().join(' '),/B-FIRST/);
  assert.doesNotMatch(app.texts().join(' '),/A-FIRST|A-SECOND/);
  await app.press('Load more');
  assert.deepEqual(app.calls.history.at(-1),{id:'B',args:['B2']});
  assert.match(app.texts().join(' '),/B-SECOND/);
  await app.unmount();
});

test('a late A freeze response cannot announce or read back A under B',async()=>{
  const lateControl=deferred();
  const app=await mount({control:()=>lateControl.promise}).start();
  await app.press('Freeze');await app.press('Card B');
  await app.settle(()=>lateControl.resolve({status:'CONFIRMED'}));
  assert.match(app.texts().join(' '),/Card:.*B222/);
  assert.doesNotMatch(app.texts().join(' '),/Request recorded/);
  assert.equal(app.calls.status.filter(call=>call.id==='A').length,1);
  await app.unmount();
});

test('unmount prevents pending status and funding from writing state',async()=>{
  const pendingStatus=deferred(),pendingFunding=deferred();
  const app=await mount({status:()=>pendingStatus.promise,funding:()=>pendingFunding.promise}).start();
  await app.unmount();
  await app.settle(()=>{pendingStatus.resolve(card('A'));pendingFunding.resolve(funding('A'))});
  assert.equal(app.lateWrites,0);
});
