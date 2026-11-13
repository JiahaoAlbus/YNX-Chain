// Fixed Node-only two-stage normal composition. No URI/provider/Source setter.
import {types} from 'node:util';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';
const flights=new WeakMap();
const apply=Reflect.apply;
function fixed(image,name){
 if(!image||types.isProxy(image))throw new Error('SHOP_NORMAL_NAMESPACE_NOT_SUPPLIED');
 const d=Object.getOwnPropertyDescriptor(image,name);
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))throw new Error('SHOP_NORMAL_NAMESPACE_NOT_SUPPLIED');
 return d.value;
}
function owned(value){
 if(!value||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('SHOP_NORMAL_SLOT_OUTCOME_INVALID');
 const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(keys.some(k=>!['owner','errorPresent','error'].includes(k)||!Object.hasOwn(d[k],'value'))||!d.owner||!d.errorPresent||typeof d.errorPresent.value!=='boolean'||d.errorPresent.value&&!d.error)throw new Error('SHOP_NORMAL_SLOT_OUTCOME_INVALID');
 if(d.owner.value!==null&&(typeof d.owner.value!=='object'&&typeof d.owner.value!=='function'||types.isProxy(d.owner.value)))throw new Error('SHOP_NORMAL_SLOT_OWNER_INVALID');
 return {owner:d.owner.value,errorPresent:d.errorPresent.value,...(d.error?{error:d.error.value}:{})};
}
/** Parent is already held by the original caller. Native owns namespace import
 * and physical debt. Initialization never calls the old no-namespace factory.
 * Returned nonnull partial must be adopted before errorPresent is interpreted.
 * prepare rejection is raw, including undefined/null/false/0; cleanup remains
 * on SAME parent using Auth's retire/close/isClosed methods, independently. */
export function initializeOriginalShopRegisteredReadForProductSource(parent,genuineRead){
 if(arguments.length!==2||!parent||(typeof parent!=='object'&&typeof parent!=='function'))throw new Error('SHOP_NORMAL_PARENT_REQUIRED');
 const old=flights.get(parent);if(old){if(old.read!==genuineRead)throw new Error('SHOP_NORMAL_READ_CHANGED');return old.flight;}
 const record={read:genuineRead,flight:null};flights.set(parent,record);
 record.flight=Promise.resolve().then(async()=>{
  const image=loadOriginalAuthIdentityNativeImage();
  // Both exact capabilities before prepare; old Native cannot ignore a scope arg.
  const prepare=fixed(image,'prepareOriginalShopV4Namespace'),initialize=fixed(image,'initializeOriginalShopV4ReadSlot');
  const pending=apply(prepare,image,[parent]);
  if(!pending||types.isProxy(pending)||!(pending instanceof Promise))throw new Error('SHOP_NORMAL_PREPARE_PROMISE_REQUIRED');
  const completed=await pending;if(completed!==undefined)throw new Error('SHOP_NORMAL_PREPARE_RESULT_INVALID');
  const outcome=apply(initialize,image,[parent,genuineRead]);
  // Capture original output first; malformed envelopes keep their partial output.
  try{return Object.freeze(owned(outcome));}catch(error){throw Object.assign(error,{partialOutcome:outcome});}
 });
 return record.flight;
}
