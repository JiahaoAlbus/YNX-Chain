// Signed-profile build facts only. No filesystem IO, loader, key or Source.
import {posix} from 'node:path';
import {types} from 'node:util';
import {pathToFileURL} from 'node:url';
import {exactPQRecord} from '../src/pq-wallet-contract.js';
const FINAL='product-session-device-registered-finalization-source-v4';
const HTTP='product-session-device-http-binary-source-v5';
export const ORIGINAL_AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSES=Object.freeze([FINAL,HTTP]);
export const ORIGINAL_AUTH_FIXED_LOADER_SHA256='11f841402ca8e2c2879a840b4f5b5234df153949b65af2f810db3669b3cdb4ec';
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const exact=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_RUNTIME_IMAGE_BINDING_V1_SCHEMA');exactPQRecord(v,keys,'AUTH_RUNTIME_IMAGE_BINDING_V1_SCHEMA');if(Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!d.enumerable))fail('AUTH_RUNTIME_IMAGE_BINDING_V1_SCHEMA');return v;};
function path(v){if(typeof v!=='string'||!v.isWellFormed()||!v.startsWith('/')||v==='/'||v.endsWith('/')||v.includes('\\')||/[\x00-\x1f\x7f]/.test(v)||Buffer.byteLength(v)>4096||posix.normalize(v)!==v)fail('AUTH_RUNTIME_IMAGE_BINDING_V1_PATH');return v;}
function pin(value,expected,max){exact(value,['path','bytes','sha256']);if(path(value.path)!==expected||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>max||typeof value.sha256!=='string'||!/^[0-9a-f]{64}$/.test(value.sha256))fail('AUTH_RUNTIME_IMAGE_BINDING_V1_PIN');return Object.freeze({path:value.path,bytes:value.bytes,sha256:value.sha256});}
export function inspectOriginalAuthRuntimeImageBindingV1DATA(value,purpose){
 if(!ORIGINAL_AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSES.includes(purpose))fail('AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSE');
 exact(value,['version','normalPackageRoot','fixedLoader','runtimeManifest','implementingImage','privateModule']);
 if(value.version!=='1')fail('AUTH_RUNTIME_IMAGE_BINDING_V1_VERSION');
 const root=path(value.normalPackageRoot);if(!root.endsWith('/packages/wallet-auth'))fail('AUTH_RUNTIME_IMAGE_BINDING_V1_ROOT');
 const fixedLoader=pin(value.fixedLoader,root+'/src/original-auth-identity-fixed-native-image.js',16384);
 if(fixedLoader.bytes!==3004||fixedLoader.sha256!==ORIGINAL_AUTH_FIXED_LOADER_SHA256)fail('AUTH_RUNTIME_IMAGE_BINDING_V1_LOADER_CODEPIN');
 const runtimeManifest=pin(value.runtimeManifest,root+'/native/original-ide-auth-runtime-manifest.json',1048576);
 const implementingImage=pin(value.implementingImage,posix.resolve(root,'../../apps/wallet-desktop/native/original-auth-identity.node'),16777216);
 exact(value.privateModule,['path','bytes','sha256','uri']);
 const privatePin=pin({path:value.privateModule.path,bytes:value.privateModule.bytes,sha256:value.privateModule.sha256},root+'/src/original-http-binary-v5-client-private.js',16777216);
 if(value.privateModule.uri!==pathToFileURL(privatePin.path).href)fail('AUTH_RUNTIME_IMAGE_BINDING_V1_MODULE_URI');
 const privateModule=Object.freeze({...privatePin,uri:value.privateModule.uri});
 return Object.freeze({runtimeImageBindingV1:Object.freeze({version:'1',normalPackageRoot:root,fixedLoader,runtimeManifest,implementingImage,privateModule}),dataOnly:true,SourceAdmission:false,NativeAdmission:false,preLoadQualified:false,sameModuleInstanceVerified:false});
}
