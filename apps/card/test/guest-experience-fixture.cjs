const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const {createRequire} = require("node:module");
const rendererRequire = createRequire(require.resolve("react-test-renderer"));
const React = rendererRequire("react"), Renderer = require("react-test-renderer"), ts = require("typescript");
const {act} = Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.join(__dirname, "..");
function evaluate(file, modules, source=fs.readFileSync(file, "utf8")) {
  const js = ts.transpileModule(source, {fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const exports = {};
  vm.runInNewContext(js, {exports,module:{exports},require(name){if(name.endsWith(".png"))return name;if(Object.hasOwn(modules,name))return modules[name];throw Error("Unexpected Guest dependency: "+name)},console,Date,Promise,setTimeout,clearTimeout,requestAnimationFrame:callback=>{callback();return 1},cancelAnimationFrame:()=>{},fetch:()=>{throw Error("Network prohibited in Guest fixture")}}, {filename:file});
  return exports;
}
const tick = () => new Promise(setImmediate);
function flattenStyle(style) {return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));}
function textOf(node) {if(typeof node === "string"||typeof node === "number")return String(node);return (node.children||[]).map(textOf).join("");}
async function mountGuest({platform="android",locale="en",width=412,fontScale=2,props={},storageOptions={}}={}) {
  const calls={native:0,chooser:0,metamask:0,retry:0,disconnectNative:0,scroll:[],reads:0,writes:0};
  const storage={record:storageOptions.record??null,...storageOptions};
  const secureState={async loadCardRegistration(){calls.reads++;if(storage.load) return storage.load(storage);if(storage.readError)throw Error("UNTRUSTED read secret");return storage.record},async saveCardRegistration(value){calls.writes++;if(storage.save)return storage.save(value,storage);if(storage.writeError)throw Error("UNTRUSTED write secret");if(!storage.silentWriteFailure)storage.record=value}};
  const dimensions={width,height:915,fontScale};
  const rn={Platform:{OS:platform},StyleSheet:{create:x=>x},useWindowDimensions:()=>dimensions,Linking:{openURL:()=>{throw Error("Real OS operation prohibited")}},...Object.fromEntries(["Image","Pressable","ScrollView","Switch","Text","TextInput","View"].map(x=>[x,x]))};
  const icons=new Proxy({},{get:(_,k)=>k==="__esModule"?false:()=>null});
  const registration=evaluate(path.join(root,"src/RegistrationExperience.tsx"),{"react":React,"react-native":rn,"./i18n":require("../src/i18n.ts"),"./registration":require("../src/registration.ts"),"./registrationCopy":require("../src/registrationCopy.ts"),"./secureState":secureState});
  const component=evaluate(path.join(root,"src/GuestExperience.tsx"),{"react":React,"react-native":rn,"lucide-react-native":icons,"./wallet":{METAMASK_CARD_DEEP_LINK:"https://example.invalid/metamask",METAMASK_INSTALL_URL:"https://example.invalid/install"},"./i18n":require("../src/i18n.ts"),"./guestCopy":require("../src/guestCopy.ts"),"./RegistrationExperience":registration,"@ynx-chain/wallet-auth":{createStandardWalletConnectState:()=>({status:"disconnected",chooserOpen:false})}}).GuestExperience;
  const initial={locale,connectWallet:async()=>{calls.chooser++},connectMetaMaskWallet:async()=>{calls.metamask++},connectYNXWallet:async()=>{calls.native++;return "wallet-opened"},enablePrivateServices:async()=>{},retryNativeWallet:async()=>{calls.retry++},disconnectNativeWallet:async()=>{calls.disconnectNative++},nativeAuthorizationPending:false,walletSession:null,walletBusy:false,walletError:"",privateSession:null,standardWalletState:{status:"disconnected",chooserOpen:false},selectedWalletKind:null,closeWalletChooser:()=>{},disconnectWallet:async()=>{},switchWalletAccount:async()=>{},...props};
  let renderer;const commits=[];
  function CommitObserver(){React.useLayoutEffect(()=>{if(renderer)commits.push({owner:initial.walletSession?.address??null,values:renderer.root.findAll(n=>n.type==="TextInput").map(n=>({value:n.props.value,editable:n.props.editable})),text:textOf(renderer.toJSON())})});return null}
  function Envelope(){return React.createElement(React.Fragment,null,React.createElement(component,initial),React.createElement(CommitObserver))}
  await act(async()=>{renderer=Renderer.create(React.createElement(Envelope),{createNodeMock:element=>element.type==="ScrollView"?{scrollTo:arg=>calls.scroll.push(arg)}:null});await tick()});
  return {calls,storage,commits,get renderer(){return renderer},text(){return textOf(renderer.toJSON())},buttons(label){return renderer.root.findAll(n=>n.type==="Pressable"&&(n.props.accessibilityLabel===label||n.findAll(child=>child.type==="Text").some(child=>textOf(child)===label)))},async press(node){if(!node)throw Error("Missing button");if(node.props.disabled)throw Error("Disabled button");await act(async()=>{node.props.onPress();await tick()})},async change(label,value){const node=renderer.root.find(n=>["TextInput","Switch"].includes(n.type)&&n.props.accessibilityLabel===label);await act(async()=>{(node.props.onChangeText??node.props.onValueChange)(value);await tick()})},async layoutSection(y){const node=renderer.root.find(n=>n.props.testID==="guest-section-content");await act(async()=>{node.props.onLayout({nativeEvent:{layout:{x:0,y,width:dimensions.width,height:1000}}});await tick()})},async resize(next){Object.assign(dimensions,next);await act(async()=>{renderer.update(React.createElement(Envelope));await tick()})},async update(props){Object.assign(initial,props);await act(async()=>{renderer.update(React.createElement(Envelope));await tick()})},async flush(){await act(async()=>{await tick()})},async tab(label){const found=renderer.root.findAll(n=>n.type==="Pressable"&&n.props.accessibilityRole==="tab"&&textOf(n)===label);if(found.length!==1)throw Error("Expected one tab: "+label);await this.press(found[0])},async unmount(){await act(async()=>{renderer.unmount();await tick()})}};
}
async function mountLanguage(locale="en") {
  const file=path.join(root,"App.tsx"),source=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="Language");
  if(!declaration)throw Error("Actual inline Language component not found");
  const rn={...Object.fromEntries(["SafeAreaView","View","Text","Pressable"].map(name=>[name,name])),FlatList:({data,renderItem})=>React.createElement(React.Fragment,null,...data.map(item=>React.createElement(React.Fragment,{key:item},renderItem({item}))))};
  const i18n=require("../src/i18n.ts");
  const extracted='import React from "react";import {SafeAreaView,View,Text,Pressable,FlatList} from "react-native";import {localeNames,locales} from "./src/i18n";const s={};\n'+declaration.getText(source)+'\nexport {Language};';
  const Language=evaluate(file,{react:React,"react-native":rn,"./src/i18n":i18n},extracted).Language;
  let closes=0,renderer;
  function Envelope(){const[current,setLocale]=React.useState(locale);return React.createElement(Language,{locale:current,setLocale:async value=>setLocale(value),close:()=>closes++,c:{},tr:key=>i18n.catalogs[current][key]})}
  await act(async()=>{renderer=Renderer.create(React.createElement(Envelope));await tick()});
  return {renderer,get closes(){return closes},async press(node){await act(async()=>{node.props.onPress();await tick()})},async unmount(){await act(async()=>{renderer.unmount();await tick()})}};
}
module.exports={mountGuest,mountLanguage,flattenStyle,textOf};
