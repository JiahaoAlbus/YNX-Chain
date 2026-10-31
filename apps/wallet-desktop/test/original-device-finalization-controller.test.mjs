import {registerHooks} from 'node:module';
const controller=new URL('../src/original-device-finalization-controller.mjs',import.meta.url).href;
const fixture=new URL('./public-device-finalization-native.fixture.mjs',import.meta.url).href;
const preload=new URL('../src/original-runtime-image-preload.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===controller&&specifier==='../../../packages/wallet-auth/src/original-auth-identity-fixed-native-image.js')return{url:fixture,shortCircuit:true};
 if(context.parentURL===preload&&specifier==='../../../packages/wallet-auth/src/original-auth-runtime-image-source-v1.js')return{url:fixture,shortCircuit:true};
 return next(specifier,context);
}});
await import('./public-device-finalization-controller.fixture.mjs');
