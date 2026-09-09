const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createRequire}=require('node:module');
const rendererRequire=createRequire(require.resolve('react-test-renderer'));
const React=rendererRequire('react'),Renderer=require('react-test-renderer'),ts=require('typescript');
const root=path.resolve(process.env.CARD_SOURCE_ROOT||path.join(__dirname,'..'));
const hashes={};
function execute(file,modules){
 const source=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(source,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const exports={};
 vm.runInNewContext(js,{exports,module:{exports},require(name){if(name.endsWith('.png'))return name;if(Object.hasOwn(modules,name))return modules[name];throw Error('Unexpected fixture dependency: '+name)},URL,TextEncoder,TextDecoder,Uint8Array,Date,Promise,console,setTimeout,clearTimeout,fetch:()=>{throw Error('network prohibited')}},{filename:file});
 return exports;
}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {act}=Renderer,result=[];
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const url='ynxcard://wallet-auth/callback?result=approved&approval=e30&nonce='+'n'.repeat(32)+'&state='+'s'.repeat(32);
const connecting={status:'wallet-opened',sessionState:{status:'connecting'}};
const rejected={sessionState:{status:'disconnected'}};
function makeController(overrides={}){return{beginYNX:async()=>connecting,retryYNX:async()=>{throw Error('retry prohibited')},handleReturn:async()=>rejected,restore:async()=>{throw Error('restore prohibited')},...overrides}}
function wrapActualController(observer){
 const storage=execute(path.join(root,'src/productWalletStorage.ts'),{});
 class Delegate { get current(){return observer.current||{sessionState:{status:'disconnected'}}} beginYNX(){return observer.beginYNX()} retryYNX(){return observer.retryYNX()} handleReturn(url){return observer.handleReturn(url)} disconnect(){return observer.disconnect()} }
 const composition=execute(path.join(root,'src/productWalletConnection.ts'),{'./productWalletStorage':storage,'@ynx-chain/wallet-auth-product-session-943':{ProductSessionGatewayFetchAdapter:class{},RecoverableProductSessionClient:class{},WalletConnectionCoordinator:Delegate},'../vendor/product-session-registry-943a1693.json':JSON.parse(fs.readFileSync(path.join(root,'vendor/product-session-registry-943a1693.json')))});
 return composition.createCardProductWalletConnection({platform:'android',device:{},storage:{},fetch:()=>{throw Error('network prohibited')}});
}
async function makeMounted(factory,{initialURL=null,bootstrap=null}={}){
 const metrics={adds:0,removes:0,initialReads:0,stateReads:0,stateWrites:0,lateStateWrites:0};let event,props,renderer,unmounted=false;const observed=[];
 // Keep actual React state/effects/dependency reconciliation. Record setter calls only to catch forbidden late writes.
 const observedReact={...React,useState(initial){const pair=React.useState(initial);return[pair[0],v=>{metrics.stateWrites++;if(unmounted)metrics.lateStateWrites++;pair[1](v)}]}};
 function Guest(p){props=p;return React.createElement('Guest',p)}
 const forbidden=()=>{throw Error('real network/OS operation prohibited')};
 const rn={Platform:{OS:'android'},StyleSheet:{create:x=>x},useColorScheme:()=> 'light',Linking:{getInitialURL:()=>{metrics.initialReads++;return Promise.resolve(initialURL)},addEventListener:(_name,cb)=>{metrics.adds++;event=cb;return{remove:()=>{metrics.removes++;event=null}}},canOpenURL:forbidden,openURL:forbidden},...Object.fromEntries(['ActivityIndicator','Alert','FlatList','Image','Modal','Pressable','ScrollView','Switch','Text','TextInput','View'].map(x=>[x,x]))};
 const store={loadLocale:async()=>bootstrap?(await bootstrap.promise).locale:null,loadSession:async()=>bootstrap?(await bootstrap.promise).session:null,loadSimulationAudit:async()=>[],loadPendingAuthorization:async()=>null,saveLocale:forbidden,saveSession:forbidden,savePendingAuthorization:forbidden,saveSimulationAudit:forbidden};
 const standard={createStandardWalletConnectState:()=>({status:'disconnected',chooserOpen:false}),reduceStandardWalletConnectState:(s,e)=>e.type==='OPEN_CHOOSER'?{...s,chooserOpen:true}:e.type==='CLOSE_CHOOSER'?{...s,chooserOpen:false}:s,discoverWalletProviders:forbidden};
 const wallet={classifyCardWalletError:()=>({code:'SYNTHETIC_ERROR',safeMessage:'synthetic unavailable',userAction:'retry'}),YNX_TESTNET_CHAIN_ID:'0x1917'};
 const i18n={catalogs:{en:{}},t:(l,k)=>l+':'+k,isRTL:l=>l==='ar',isLocale:l=>['en','zh-Hans','ar'].includes(l)};
 const icons=new Proxy({},{get:(_,k)=>k==='__esModule'?false:()=>null});
 const App=execute(path.join(root,'App.tsx'),{'react':observedReact,'react-native':rn,'react-native-safe-area-context':{SafeAreaProvider:'SafeAreaProvider',SafeAreaView:'SafeAreaView'},'expo-status-bar':{StatusBar:'StatusBar'},'expo-local-authentication':{},'lucide-react-native':icons,'./src/api':{state:async()=>{metrics.stateReads++;return null}},'./src/i18n':i18n,'./src/secureState':store,'./src/productWalletRuntime':{createRuntimeCardProductWalletConnection:async input=>wrapActualController(await factory(input))},'@ynx-chain/wallet-auth':standard,'./src/wallet':wallet,'./src/simulation':{},'./src/GuestExperience':{GuestExperience:Guest}}).default;
 await act(async()=>{renderer=Renderer.create(React.createElement(App));await tick()});
 return {get props(){return props},metrics,observed,get renderer(){return renderer},async event(value){assert(event);await act(async()=>{event({url:value});await tick()})},async mutate(fn){await act(async()=>{await fn();await tick()})},async unmount(){await act(async()=>{unmounted=true;renderer.unmount();await tick()})}};
}

module.exports={makeMounted,makeController,deferred,url,connecting,rejected,act,tick};
