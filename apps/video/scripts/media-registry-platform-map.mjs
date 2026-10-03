// Read-only inventory from an explicitly verified frozen shared SDK package.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
if(!process.argv[2])throw Error('Explicit frozen Central source directory required');
const commits={'16195c6663525b0965725a922f46f38cf7b0a004':'13c7016a8bbb13cc61912633f9787ef9fc9b69d2','5c5e8a234206e306b6044deb6e938c1763ac7005':'4742a47562040898a503702f413fd4a87a3d38c0'};
const sharedCommit=process.argv[3];if(!commits[sharedCommit])throw Error('Explicit supported frozen source commit required');
const base=pathToFileURL(process.argv[2]+'/packages/wallet-auth/');
const raw=readFileSync(new URL('product-session-registry.json',base));
const registry=JSON.parse(raw);
const {productPlatformBinding,PRODUCT_SESSION_PLATFORMS}=await import(new URL('src/product-session-registry.js',base));
const rows=[];
for(const productId of ['video','creator-studio','music']){
 const product=registry.products.find(p=>p.productId===productId);
 for(const platform of PRODUCT_SESSION_PLATFORMS){
  try{
   const binding=productPlatformBinding(registry,productId,platform);
   rows.push({productId,platform,registered:true,binding,scopes:[...product.scopes],sessionTTLSeconds:product.sessionDurationSeconds,actualInstalledOrPublicAcceptance:false});
  }catch(error){rows.push({productId,platform,registered:false,code:typeof error?.code==='string'?error.code:'REGISTRY_REJECTED',actualInstalledOrPublicAcceptance:false})}
 }
}
console.log(JSON.stringify({schema:'ynx.media.actual-frozen-registry-platform-map.v1',sharedCommit,sharedTree:commits[sharedCommit],registrySHA256:createHash('sha256').update(raw).digest('hex'),rows,notes:['Registry bindings only; OS enrollment, current actor/CSRF, installed app and public business flow remain separate',productPlatformBindingSafeNote(registry),'Music existing Android/iOS native callback is ynxmusic://auth/callback; do not substitute wallet-auth/callback','Creator native binding in the shared registry alone does not prove an installed Creator native app']},null,2));

function productPlatformBindingSafeNote(registry){const music=registry.products.find(p=>p.productId==='music');return music.platforms.includes('web')&&music.platforms.includes('macos')?'Music Web/macOS are source-registered in this exact successor; production activation remains unverified':'Music Web/macOS are unregistered in this exact frozen source'}
