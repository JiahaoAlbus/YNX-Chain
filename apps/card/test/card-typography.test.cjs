const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),Renderer=require('react-test-renderer'),{act}=Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
function mount({platform='web',initial=null,load,save,blocked=false,settings=false}={}){
  let stored=initial,renderer;const writes=[],keys=[];
  const rn={Platform:{OS:platform},Text:'Text',TextInput:'TextInput',View:'View',Pressable:'Pressable',StyleSheet:{create:x=>x,flatten:style=>Array.isArray(style)?Object.assign({},...style.flat(Infinity).filter(Boolean)):style}};
  const storage={getItem:key=>{keys.push(key);if(blocked)throw Error('blocked');return stored},setItem:(key,value)=>{keys.push(key);if(blocked)throw Error('blocked');writes.push(value);stored=value}};
  const modules={react:React,'react-native':rn,'expo-secure-store':{getItemAsync:async key=>{keys.push(key);return load?load():stored},setItemAsync:async(key,value)=>{keys.push(key);writes.push(value);if(save)await save(value);stored=value}},'./cardTypographyCopy':{cardTypographyCopy:()=>['Text size','Compact','Standard','Larger','Device text size','Save unavailable']}};
  const js=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/cardTypography.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const api={};vm.runInNewContext(js,{exports:api,require:name=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name]},window:{localStorage:storage},Promise,console});
  function Probe(){const context=api.useCardTypography();return React.createElement('Probe',{context},React.createElement(api.CardText,{style:{fontSize:16,lineHeight:22}},'Sample'),React.createElement(api.CardTextInput,{style:{fontSize:16}}),settings?React.createElement(api.CardTextSizeSettings,{locale:'en'}):null)}
  return{keys,writes,get stored(){return stored},get context(){return renderer.root.findByType('Probe').props.context},get text(){return renderer.root.findAllByType('Text')[0]},get input(){return renderer.root.findByType('TextInput')},get radios(){return renderer.root.findAllByType('Pressable')},async start(){await act(async()=>{renderer=Renderer.create(React.createElement(api.CardTypographyProvider,null,React.createElement(Probe)));await tick()});return this},async choose(size){await act(async()=>{this.context.setSize(size);await tick()})},async press(index){await act(async()=>{this.radios[index].props.onPress();await tick()})},async settle(fn){await act(async()=>{fn();await tick()})},async close(){await act(async()=>renderer.unmount())}};
}
test('Web radios expose exactly one explicit aria-checked value and update on selection',async()=>{
  const app=await mount({settings:true}).start();
  assert.deepEqual(app.radios.map(r=>r.props['aria-checked']),[false,true,false]);
  await app.press(2);assert.deepEqual(app.radios.map(r=>r.props['aria-checked']),[false,false,true]);
  await app.press(0);assert.deepEqual(app.radios.map(r=>r.props['aria-checked']),[true,false,false]);
  assert.ok(app.radios.every(r=>r.props.accessibilityRole==='radio'));await app.close();
});
test('Native radios preserve accessibilityState without injecting Web-only aria props',async()=>{
  const app=await mount({platform:'ios',settings:true}).start();
  assert.deepEqual(app.radios.map(r=>r.props.accessibilityState.checked),[false,true,false]);
  assert.ok(app.radios.every(r=>!Object.hasOwn(r.props,'aria-checked')));
  await app.press(2);assert.deepEqual(app.radios.map(r=>r.props.accessibilityState.checked),[false,false,true]);await app.close();
});
test('standard is default and system font scaling remains enabled for labels and inputs',async()=>{
  const app=await mount().start();assert.equal(app.context.size,'standard');assert.equal(app.text.props.style[1].fontSize,16);assert.equal(app.text.props.allowFontScaling,true);assert.equal(app.input.props.allowFontScaling,true);await app.close();
});
test('larger text scales declared font and line height and saves only its owned preference',async()=>{
  const app=await mount().start();await app.choose('larger');assert.equal(app.context.size,'larger');assert.equal(app.text.props.style[1].fontSize,19.2);assert.equal(app.text.props.style[1].lineHeight,26.4);assert.equal(app.input.props.style[1].fontSize,19.2);assert.equal(app.stored,'larger');assert.ok(app.keys.every(key=>key==='ynx.card.text-size.v1'));await app.close();
});
test('late native preference read cannot undo an explicit new choice',async()=>{
  const old=deferred();let reads=0;const app=await mount({platform:'android',load:()=>++reads===1?old.promise:Promise.resolve('larger')}).start();await app.choose('larger');await app.settle(()=>old.resolve('compact'));assert.equal(app.context.size,'larger');await app.close();
});
test('native writes are serialized so an old save cannot overwrite the newest size',async()=>{
  const old=deferred();const app=await mount({platform:'ios',save:value=>value==='compact'?old.promise:Promise.resolve()}).start();await app.choose('compact');await app.choose('larger');assert.deepEqual(app.writes,['compact']);await app.settle(()=>old.resolve());assert.deepEqual(app.writes,['compact','larger']);assert.equal(app.stored,'larger');assert.equal(app.context.size,'larger');await app.close();
});
test('invalid saved values fail to standard without a storage write',async()=>{
  const app=await mount({initial:'not-a-size'}).start();assert.equal(app.context.size,'standard');assert.deepEqual(app.writes,[]);await app.close();
});
test('blocked storage keeps chosen size in memory and exposes truthful save failure',async()=>{
  const app=await mount({blocked:true}).start();await app.choose('compact');assert.equal(app.context.size,'compact');assert.equal(app.context.saveFailed,true);await app.close();
});
test('text size settings have explicit six-key copy in all twelve Card locales',()=>{
  const js=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/cardTypographyCopy.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const copy={};vm.runInNewContext(js,{exports:copy});
  for(const locale of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id'])assert.equal(copy.cardTypographyCopy(locale).filter(Boolean).length,6);
});
test('all five product text surfaces consume scalable typography; root and settings connect it',()=>{
  for(const file of ['App.tsx','src/GuestExperience.tsx','src/ProviderExperience.tsx','src/RegistrationExperience.tsx','src/CardBusinessExperience.tsx'])assert.match(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),/CardText as (Text|NativeText)/);
  assert.match(fs.readFileSync(path.resolve(__dirname,'../index.ts'),'utf8'),/registerRootComponent\(CardRoot\)/);
  assert.match(fs.readFileSync(path.resolve(__dirname,'../App.tsx'),'utf8'),/<CardTextSizeSettings locale=\{locale\}\/>/);
});
