import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import {ModuleKind,ScriptTarget,transpileModule,JsxEmit} from "typescript";

const require=createRequire(import.meta.url),Renderer=require("react-test-renderer") as {act:(run:()=>Promise<void>|void)=>Promise<void>;create:(node:React.ReactNode)=>{unmount:()=>void}};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const root=path.dirname(fileURLToPath(new URL("../App.tsx",import.meta.url)));
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail;});return{promise,resolve,reject};};
const callbackURL=`ynxcard://wallet-auth/callback?result=approved&approval=e30&nonce=${"n".repeat(32)}&state=${"s".repeat(32)}`;
const connecting={status:"wallet-opened",sessionState:{status:"connecting"}},rejected={sessionState:{status:"disconnected"}};
const forbidden=()=>{throw new Error("Lifecycle fixture prohibited an OS or network action.");};

function executeApp(modules:Readonly<Record<string,unknown>>){
  const file=path.join(root,"App.tsx"),source=readFileSync(file,"utf8"),js=transpileModule(source,{fileName:file,compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.CommonJS,jsx:JsxEmit.React,esModuleInterop:true}}).outputText,exports:Record<string,unknown>={};
  vm.runInNewContext(js,{exports,module:{exports},require:(name:string)=>{if(name.endsWith(".png"))return name;if(Object.hasOwn(modules,name))return modules[name];throw new Error(`Unexpected lifecycle fixture dependency: ${name}`);},URL,TextEncoder,TextDecoder,Uint8Array,Date,Promise,console,setTimeout,clearTimeout,setImmediate,globalThis},{filename:file});
  return exports.default as React.ComponentType;
}

async function mount(factory:(input:Readonly<Record<string,unknown>>)=>Promise<unknown>,input:Readonly<{initialURL?:string|null;bootstrap?:Readonly<{promise:Promise<Readonly<{locale:string|null;session:unknown}>>}>}>={}){
  let listener:((event:Readonly<{url:string}>)=>void)|null=null,props:Record<string,any>={},renderer:{unmount:()=>void}|null=null,unmounted=false;
  const metrics={adds:0,removes:0,initialReads:0,stateWrites:0,lateStateWrites:0};
  const observedReact={...React,createElement:(type:React.ElementType,...children:unknown[])=>{assert.notEqual(type,undefined,"Lifecycle fixture must explicitly provide every rendered App component.");return React.createElement(type,...children);},useState(initial:unknown){const pair=React.useState(initial);return[pair[0],(value:unknown)=>{metrics.stateWrites++;if(unmounted)metrics.lateStateWrites++;pair[1](value as never);}] as const;}};
  const rn={Platform:{OS:"android"},StyleSheet:{create:(value:unknown)=>value},useColorScheme:()=>"light",Linking:{getInitialURL:()=>{metrics.initialReads++;return Promise.resolve(input.initialURL??null);},addEventListener:(_event:string,handler:(event:Readonly<{url:string}>)=>void)=>{metrics.adds++;listener=handler;return{remove:()=>{metrics.removes++;listener=null;}}},canOpenURL:forbidden,openURL:forbidden},...Object.fromEntries(["ActivityIndicator","Alert","FlatList","Image","Modal","Pressable","ScrollView","Switch","Text","TextInput","View"].map(name=>[name,name]))};
  const secure={loadLocale:async()=>input.bootstrap?(await input.bootstrap.promise).locale:null,loadSession:async()=>input.bootstrap?(await input.bootstrap.promise).session:null,loadSimulationAudit:async()=>[],loadPendingAuthorization:async()=>null,saveLocale:forbidden,saveSession:forbidden,savePendingAuthorization:forbidden,saveSimulationAudit:forbidden};
  const standard={createStandardWalletConnectState:()=>({status:"disconnected",chooserOpen:false}),reduceStandardWalletConnectState:(state:Record<string,unknown>,event:{type:string})=>event.type==="OPEN_CHOOSER"?{...state,chooserOpen:true}:event.type==="CLOSE_CHOOSER"?{...state,chooserOpen:false}:state,discoverWalletProviders:forbidden};
  const wallet={classifyCardWalletError:()=>({code:"SYNTHETIC_ERROR",safeMessage:"synthetic unavailable",userAction:"retry"}),YNX_TESTNET_CHAIN_ID:"0x1917"};
  function Guest(value:Record<string,any>){props=value;return React.createElement("Guest",value);}
  const icons=new Proxy({},{get:(_target,key)=>key==="__esModule"?false:()=>null});
  const App=executeApp({react:observedReact,"react-native":rn,"react-native-safe-area-context":{SafeAreaProvider:"SafeAreaProvider",SafeAreaView:"SafeAreaView"},"expo-status-bar":{StatusBar:"StatusBar"},"expo-local-authentication":{},"lucide-react-native":icons,"./src/api":{state:async()=>null},"./src/i18n":{catalogs:{en:{}},t:(locale:string,key:string)=>`${locale}:${key}`,isRTL:()=>false,isLocale:()=>true},"./src/secureState":secure,"./src/productWalletRuntime":{createRuntimeCardProductWalletConnection:factory},"@ynx-chain/wallet-auth":standard,"./src/wallet":wallet,"./src/simulation":{},"./src/GuestExperience":{GuestExperience:Guest}});
  await Renderer.act(async()=>{renderer=Renderer.create(React.createElement(App));await tick();});
  return {metrics,get props(){return props;},async event(url:string){assert(listener);await Renderer.act(async()=>{listener?.({url});await tick();});},async mutate(run:()=>Promise<void>|void){await Renderer.act(async()=>{await run();await tick();});},async unmount(){await Renderer.act(async()=>{unmounted=true;renderer?.unmount();await tick();});}};
}

test("Card lifecycle keeps one Linking listener through saved locale and session rerenders",async()=>{
  for(const session of [null,{token:"synthetic",expiresAt:"2099-01-01T00:00:00Z"}]){const bootstrap=deferred<Readonly<{locale:string|null;session:unknown}>>(),counters={factory:0,returns:0,begin:0},app=await mount(async input=>{counters.factory++;assert.equal(input.existingDeviceOnly,true);return{beginYNX:async()=>{counters.begin++;return connecting;},retryYNX:forbidden,handleReturn:async()=>{counters.returns++;return rejected;},disconnect:async()=>rejected};},{bootstrap});await app.mutate(async()=>{bootstrap.resolve({locale:"zh-Hans",session});await tick();});await app.event(callbackURL);assert.equal(app.metrics.adds,1);assert.equal(app.metrics.removes,0);assert.equal(app.metrics.initialReads,1);assert.equal(counters.factory,1);assert.equal(counters.returns,1);assert.equal(counters.begin,0);await app.unmount();}}
);

test("Card lifecycle Close and unmount suppress late cold-recovery delivery",async()=>{
  const gate=deferred<unknown>(),app=await mount(async()=>await gate.promise,{initialURL:callbackURL});await app.mutate(()=>app.props.closeWalletChooser());const before=app.metrics.stateWrites;await app.mutate(()=>gate.resolve({handleReturn:async()=>rejected,beginYNX:async()=>connecting,retryYNX:forbidden,disconnect:async()=>rejected}));assert.equal(app.metrics.stateWrites,before);assert.equal(app.props.nativeAuthorizationPending,false);await app.unmount();
  const late=deferred<unknown>(),unmounted=await mount(async()=>await late.promise,{initialURL:callbackURL});await unmounted.unmount();await Renderer.act(async()=>{late.resolve({handleReturn:async()=>rejected,beginYNX:async()=>connecting,retryYNX:forbidden,disconnect:async()=>rejected});await tick();});assert.equal(unmounted.metrics.removes,1);assert.equal(unmounted.metrics.lateStateWrites,0);
});

test("Card lifecycle never lets an old callback clear a new Begin pending state",async()=>{
  for(const outcome of ["resolve","reject"] as const){const old=deferred<unknown>(),next=deferred<unknown>();let factories=0;const app=await mount(async()=>{factories++;return factories===1?{handleReturn:async()=>await old.promise,beginYNX:async()=>connecting,retryYNX:forbidden,disconnect:async()=>rejected}:{handleReturn:async()=>rejected,beginYNX:async()=>await next.promise,retryYNX:forbidden,disconnect:async()=>rejected};});await app.mutate(()=>app.props.connectYNXWallet());await app.event(callbackURL);await app.mutate(()=>app.props.closeWalletChooser());let begin:Promise<unknown>|undefined;await app.mutate(()=>{begin=app.props.connectYNXWallet();});const before=app.metrics.stateWrites;await app.mutate(()=>outcome==="resolve"?old.resolve(rejected):old.reject(new Error("synthetic old callback failure")));assert.equal(app.metrics.stateWrites,before);assert.equal(app.props.nativeAuthorizationPending,false);assert.equal(app.props.walletBusy,true);await app.mutate(()=>next.resolve(connecting));await app.mutate(async()=>{await begin;});assert.equal(app.props.nativeAuthorizationPending,true);assert.equal(app.props.walletBusy,false);await app.unmount();}}
);
