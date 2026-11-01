import {initializeOriginalAuthIdentityIDEPrivateStartup,originalAuthIdentityIDEStartupStatus} from '../../../packages/wallet-auth/src/original-auth-identity-private-joint-registration.js';
import {loadOriginalAuthIdentityNativeImage} from '../../../packages/wallet-auth/src/original-auth-identity-fixed-native-image.js';
import {types} from 'node:util';
let productFactories=null;
export function captureOriginalProductSourceFactories(){
 const image=loadOriginalAuthIdentityNativeImage();
 if(!image||types.isProxy(image))throw Object.assign(Error('NATIVE_PAY_PRODUCT_SOURCE_FACTORY_UNAVAILABLE'),{code:'NATIVE_PAY_PRODUCT_SOURCE_FACTORY_UNAVAILABLE'});
 if(productFactories){if(productFactories.image!==image)throw Error('NATIVE_PAY_PRODUCT_NATIVE_IMAGE_CHANGED');return productFactories.factories;}
 const a=Object.getOwnPropertyDescriptor(image,'acquireOriginalProductSource'),r=Object.getOwnPropertyDescriptor(image,'isOriginalProductSource');
 if(!a||!r||!Object.hasOwn(a,'value')||!Object.hasOwn(r,'value')||typeof a.value!=='function'||typeof r.value!=='function'||types.isProxy(a.value)||types.isProxy(r.value))throw Object.assign(Error('NATIVE_PAY_PRODUCT_SOURCE_FACTORY_UNAVAILABLE'),{code:'NATIVE_PAY_PRODUCT_SOURCE_FACTORY_UNAVAILABLE'});
 const factories=Object.freeze({acquireOriginalProductSource:()=>Reflect.apply(a.value,image,[]),isOriginalProductSource:value=>Reflect.apply(r.value,image,[value])});
 productFactories=Object.freeze({image,factories});return factories;
}
// Normal main supplies only the original same Vault, never a path, key,
// approving callback, renderer DTO or alternative module constructor.
export function initializeOriginalAuthIdentityStartup(vault){
 try{initializeOriginalAuthIdentityIDEPrivateStartup(vault);return originalAuthIdentityIDEStartupStatus(vault);}
 catch(error){if(error?.code!=='AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED')throw error;return originalAuthIdentityIDEStartupStatus(vault);}
}
