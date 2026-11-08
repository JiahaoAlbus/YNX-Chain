// Private Shop code-import evidence only. Native ProductRoot selects the exact
// reviewed SDK URI and owns admission. No caller URI/callback/provider or TLA.
import {types} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const attempts=new WeakMap(),inventory=new WeakMap();
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,apply=Reflect.apply;
let binding;
const weakKey=value=>value!==null&&(typeof value==='object'||typeof value==='function');
function evidence(owner,namespace){if(!weakKey(owner))return null;const record=apply(weakGet,inventory,[owner]);return record&&record.valid&&record.namespace===namespace?record:null;}
export function isOriginalShopRegisteredReadNamespaceImportDATA(...args){return args.length===2&&evidence(args[0],args[1])!==null;}
export function consumeOriginalShopRegisteredReadNamespaceImportDATA(...args){
 if(args.length!==2)return false;const record=evidence(args[0],args[1]);
 if(!record||!record.accepting||record.consumed)return false;record.consumed=true;return true;
}
function fields(value){
 const keys=['version','sdkURI','assertCurrent','acceptCompleted'];
 if(!value||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('SHOP_REGISTERED_READ_LOADER_PORT_INVALID');
 const d=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(d);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('SHOP_REGISTERED_READ_LOADER_PORT_INVALID');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function fixedPort(owner){
 const image=loadOriginalAuthIdentityNativeImage();if(!image||types.isProxy(image))fail('SHOP_REGISTERED_READ_LOADER_NOT_SUPPLIED');
 const d=Object.getOwnPropertyDescriptor(image,'openOriginalShopRegisteredReadLoaderV1');
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail('SHOP_REGISTERED_READ_LOADER_NOT_SUPPLIED');
 if(binding&&(binding.image!==image||binding.open!==d.value))fail('SHOP_REGISTERED_READ_LOADER_BINDING_CHANGED');
 binding??=Object.freeze({image,open:d.value});
 return apply(binding.open,binding.image,[owner]);
}
export function startOriginalShopRegisteredReadNodeLoadV1(...args){
 if(args.length!==1||!weakKey(args[0]))fail('SHOP_REGISTERED_READ_LOADER_ONE_OWNER');
 const owner=args[0],previous=apply(weakGet,attempts,[owner]);if(previous)return previous;
 let retired=false,complete=false,portOriginal,namespaceOriginal,record;
 let portPresent=false,namespacePresent=false,accepted=false,errorPresent=false,error;
 const completion=Promise.resolve().then(async()=>{
  try{
   if(retired)fail('SHOP_REGISTERED_READ_LOADER_RETIRED');
   portOriginal=fixedPort(owner);portPresent=true; // adopt before inspecting
   const port=fields(portOriginal);
   if(port.version!==1||typeof port.sdkURI!=='string'||!port.sdkURI||port.sdkURI.length>8192||!port.sdkURI.isWellFormed())fail('SHOP_REGISTERED_READ_LOADER_PORT_INVALID');
   for(const k of ['assertCurrent','acceptCompleted'])if(typeof port[k]!=='function'||types.isProxy(port[k]))fail('SHOP_REGISTERED_READ_LOADER_PORT_INVALID');
   try{const u=new URL(port.sdkURI);if(u.protocol!=='file:'||u.host||u.search||u.hash||pathToFileURL(fileURLToPath(u)).href!==port.sdkURI)fail('SHOP_REGISTERED_READ_LOADER_URI_INVALID');}catch{fail('SHOP_REGISTERED_READ_LOADER_URI_INVALID');}
   const current=()=>{if(apply(port.assertCurrent,portOriginal,[])!==undefined)fail('SHOP_REGISTERED_READ_LOADER_CURRENT_INVALID');if(retired)fail('SHOP_REGISTERED_READ_LOADER_RETIRED');};
   current();namespaceOriginal=await import(port.sdkURI);namespacePresent=true; // retain late namespace before fences
   if(retired)fail('SHOP_REGISTERED_READ_LOADER_RETIRED');current();
   record={namespace:namespaceOriginal,valid:true,accepting:true,consumed:false};apply(weakSet,inventory,[owner,record]);
   try{
    if(apply(port.acceptCompleted,portOriginal,[namespaceOriginal])!==undefined)fail('SHOP_REGISTERED_READ_LOADER_ACCEPT_INVALID');
    if(!record.consumed)fail('SHOP_REGISTERED_READ_LOADER_PROVENANCE_NOT_CONSUMED');
    accepted=true;
   }finally{record.accepting=false;}
   current();
  }catch(cause){if(record)record.valid=false;errorPresent=true;error=cause;}
  finally{complete=true;}
  return Object.freeze({portPresent,portOriginal,namespacePresent,namespaceOriginal,accepted,errorPresent,error,dataOnly:true,SourceAdmission:false,NativeAdmission:false,NativeSlotEnabled:false});
 });
 const joined=completion.then(()=>undefined);
 const attempt=Object.freeze({completion,
  retire(){retired=true;if(record)record.valid=false;},
  join(){return joined;},
  statusDATA(){return Object.freeze({retired,complete,portPresent,namespacePresent,accepted,errorPresent,error,dataOnly:true,SourceAdmission:false,NativeAdmission:false,NativeSlotEnabled:false});}
 });
 apply(weakSet,attempts,[owner,attempt]);return attempt;
}
