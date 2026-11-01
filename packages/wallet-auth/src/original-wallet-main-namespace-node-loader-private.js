// Private Node producer. Root-owned Native port chooses URI and owns acceptance.
// Not a public setter/Source factory. Caller cannot supply URI or callbacks.
import {types} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
let selected,loaderBinding;
// Import provenance only. Root/Source admission remains in the fixed Native
// owner. These captured intrinsics neither inspect a caller object nor brand it.
const importInventory=new WeakMap(),weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,apply=Reflect.apply;
function imported(owner,namespace){
 if((typeof owner!=='object'&&typeof owner!=='function')||owner===null)return null;
 const record=apply(weakGet,importInventory,[owner]);
 return record&&record.valid&&record.namespace===namespace?record:null;
}
export function isOriginalWalletMainNamespaceImportDATA(...args){
 return args.length===2&&imported(args[0],args[1])!==null;
}
export function consumeOriginalWalletMainNamespaceImportDATA(...args){
 if(args.length!==2)return false;
 const record=imported(args[0],args[1]);
 if(!record||!record.accepting||record.consumed)return false;
 record.consumed=true;return true;
}
function fields(value,keys){
 if(!value||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('WALLET_MAIN_LOADER_PORT_INVALID');
 const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(descriptors);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))fail('WALLET_MAIN_LOADER_PORT_INVALID');
 return Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
}
// Same-package fixed snapshot, captured before initialization. Not a setter.
export function captureOriginalWalletMainNamespaceLoaderBindingV1(...args){
 if(args.length)fail('WALLET_MAIN_LOADER_ZERO_INPUT');
 if(loaderBinding)return loaderBinding;
 const image=loadOriginalAuthIdentityNativeImage();
 if(!image||types.isProxy(image))fail('WALLET_MAIN_LOADER_NOT_SUPPLIED');
 const d=Object.getOwnPropertyDescriptor(image,'openOriginalWalletMainNamespaceLoaderV1');
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail('WALLET_MAIN_LOADER_NOT_SUPPLIED');
 loaderBinding=Object.freeze({image,open:d.value});return loaderBinding;
}
function fixedPort(owner){
 const native=captureOriginalWalletMainNamespaceLoaderBindingV1();
 return Reflect.apply(native.open,native.image,[owner]);
}
export function startOriginalWalletMainNamespaceNodeLoadV1(...args){
 if(args.length!==1)fail('WALLET_MAIN_LOADER_ARGUMENTS');
 if(selected){if(selected.owner!==args[0])fail('WALLET_MAIN_LOADER_ALREADY_SELECTED');return selected.attempt;}
 const owner=args[0];
 let retired=false,complete=false,portOriginal,namespaceOriginal,importRecord;
 let portPresent=false,namespacePresent=false,errorPresent=false,error;
 const completion=Promise.resolve().then(async()=>{
  try{
   if(retired)fail('WALLET_MAIN_LOADER_RETIRED');
   portOriginal=fixedPort(owner);portPresent=true; // Retain before inspecting.
   const port=fields(portOriginal,['version','mainURI','assertCurrent','acceptCompleted']);
   if(port.version!==1||typeof port.mainURI!=='string'||!port.mainURI||port.mainURI.length>8192||!port.mainURI.isWellFormed())fail('WALLET_MAIN_LOADER_PORT_INVALID');
   for(const k of ['assertCurrent','acceptCompleted'])if(typeof port[k]!=='function'||types.isProxy(port[k]))fail('WALLET_MAIN_LOADER_PORT_INVALID');
   let url;try{url=new URL(port.mainURI);if(url.protocol!=='file:'||url.host||url.search||url.hash||pathToFileURL(fileURLToPath(url)).href!==port.mainURI)fail('WALLET_MAIN_LOADER_URI_INVALID');}catch{fail('WALLET_MAIN_LOADER_URI_INVALID');}
   const current=()=>{if(Reflect.apply(port.assertCurrent,portOriginal,[])!==undefined)fail('WALLET_MAIN_LOADER_CURRENT_INVALID');if(retired)fail('WALLET_MAIN_LOADER_RETIRED');};
   current();
   // Real Node ESM loader, exact Root-selected URI, no appended search/hash.
   // Auth must establish completed normal boot before opening this port.
   namespaceOriginal=await import(port.mainURI);namespacePresent=true;
   // Adopt the late namespace before retirement/current checks. Retain it even
   // if accept/current throws false; original startup owner still owns cleanup.
   if(retired)fail('WALLET_MAIN_LOADER_RETIRED');current();
   // Only this actual import path can write provenance. It is visible at
   // Native's synchronous acceptance boundary after the late-current fence.
   importRecord={namespace:namespaceOriginal,valid:true,accepting:true,consumed:false};
   apply(weakSet,importInventory,[owner,importRecord]);
   try{if(Reflect.apply(port.acceptCompleted,portOriginal,[namespaceOriginal])!==undefined)fail('WALLET_MAIN_LOADER_ACCEPT_INVALID');}
   finally{importRecord.accepting=false;}
   current();
  }catch(cause){if(importRecord)importRecord.valid=false;errorPresent=true;error=cause;}
  finally{complete=true;}
  return Object.freeze({portPresent,portOriginal,namespacePresent,namespaceOriginal,
   errorPresent,error,dataOnly:true,SourceAdmission:false,NativeAdmission:false,MainRegistered:false});
 });
 const joined=completion.then(()=>undefined);
 const attempt=Object.freeze({completion,retire(){retired=true;if(importRecord)importRecord.valid=false;},join(){return joined;},statusDATA(){return Object.freeze({retired,complete,portPresent,namespacePresent,errorPresent,error,dataOnly:true,SourceAdmission:false,NativeAdmission:false,MainRegistered:false});}});
 selected={owner,attempt};return attempt;
}
