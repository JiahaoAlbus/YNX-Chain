// Owning Media composition only. Frozen SDK source is never edited or executed
// by selection; generated modules require a separate normal build allocation.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
export const CURRENT_MEDIA_SDK_HEAD='2689bece12fddd991c2ecd7a024f6aa4e8b1afbd';
export const CURRENT_MEDIA_SDK_TREE='4b0af59f43c1283054c3d33af1d4c84bd36ecd2a';
export const CURRENT_MEDIA_SDK_VENDOR='apps/music/web/vendor/wallet-auth-r9-2689bece';
const manifestSHA='bf6104ab63231bbd6981ef31e265f1d9910495a4a373a6cee0765e585b532ebe';
const sha=b=>createHash('sha256').update(b).digest('hex');
const exportsFor={
 browser:[['createBrowserProductSessionClient','product-session-browser.js'],['ProductSessionGatewayFetchAdapter','product-session-gateway-client.js'],['encodeProductSessionWalletURL','product-session-router.js'],['WalletAuthError','canonical.js'],['createProductWalletConnection','product-wallet-connection.js']],
 native:[['createNativeProductSessionClient','product-session-native.js'],['ProductSessionGatewayFetchAdapter','product-session-gateway-client.js'],['productPlatformBinding','product-session-registry.js'],['WalletAuthError','canonical.js'],['createProductWalletConnection','product-wallet-connection.js']],
};
export function selectCurrentMediaSdk(root,profile='browser'){
 if(!Object.hasOwn(exportsFor,profile))throw Error('Unknown Media SDK entry');
 const vendor=join(resolve(root),CURRENT_MEDIA_SDK_VENDOR),bytes=readFileSync(join(vendor,'SOURCE_MANIFEST.json'));
 if(sha(bytes)!==manifestSHA)throw Error('Current Media SDK full source manifest changed');
 const manifest=JSON.parse(bytes),pins=new Map();
 if(manifest.head!==CURRENT_MEDIA_SDK_HEAD||manifest.tree!==CURRENT_MEDIA_SDK_TREE||manifest.rows.length!==276)throw Error('Current Media SDK identity changed');
 for(const row of manifest.rows){
  if(!row.path.startsWith('packages/wallet-auth/')||row.path.split('/').some(p=>p==='..')||pins.has(row.path))throw Error('Invalid current SDK source path');
  const data=readFileSync(join(vendor,'source',row.path));if(data.length!==row.bytes||sha(data)!==row.sha256)throw Error('Current Media SDK source changed: '+row.path);pins.set(row.path,row);
 }
 const packageRoot=join(vendor,'source/packages/wallet-auth');
 const entry=exportsFor[profile].map(([name,path])=>`export {${name}} from "./source/packages/wallet-auth/src/${path}";`).join('\n')+`\nexport const MEDIA_SDK_SOURCE_COMMIT=${JSON.stringify(CURRENT_MEDIA_SDK_HEAD)};\n`;
 const entryPath=join(vendor,profile+'-entry.mjs');if(readFileSync(entryPath,'utf8')!==entry)throw Error('Current Media SDK entry changed');
 return {vendor,packageRoot,profile,entry,entryPath,pins,sourceCommit:manifest.head,sourceTree:manifest.tree,sourceManifestSHA256:manifestSHA,registry:join(packageRoot,'product-session-registry.json')};
}
export async function buildCurrentMediaSdk(root,output,profile='browser',{esbuildModule,dependencyRoot,filename:requestedName,registryFilename='product-session-registry.json',sourceFilename='product-session-sdk-source.json'}={}){
 const selected=selectCurrentMediaSdk(root,profile),metadata=JSON.parse(readFileSync(join(selected.vendor,'media-source.json')));
 const dependencies=resolve(dependencyRoot||process.env.YNX_MEDIA_SDK_DEPENDENCY_ROOT||metadata.dependencyCache);
 // Existing locked current dependencies only; no install, scripts or upgrade.
 for(const [name,version] of [['@noble/curves','2.2.0'],['@noble/hashes','2.2.0']]){
  if(JSON.parse(readFileSync(join(dependencies,name,'package.json'))).version!==version)throw Error('Current Media SDK dependency mismatch: '+name);
 }
 const modulePath=resolve(esbuildModule||process.env.YNX_MEDIA_ESBUILD_MODULE||join(dependencies,'esbuild/lib/main.js'));
 const esbuild=createRequire(import.meta.url)(modulePath);if(esbuild.version!=='0.25.9')throw Error('Use the recorded Media esbuild0.25.9');
 const result=await esbuild.build({entryPoints:[selected.entryPath],absWorkingDir:resolve(root),nodePaths:[dependencies],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',target:'es2022',minify:true,logLevel:'silent'});
 const inputs=[];
 for(const name of Object.keys(result.metafile.inputs)){
  if(name==='<stdin>'||name==='media-current-sdk-entry.mjs')continue;
  const path=resolve(root,name),data=readFileSync(path),rel=relative(selected.packageRoot,path).replaceAll('\\','/');
  if(path===selected.entryPath){if(data.toString()!==selected.entry)throw Error('Current Media SDK entry changed');}
  else if(!rel.startsWith('../')){const pin=selected.pins.get('packages/wallet-auth/'+rel);if(!pin||data.length!==pin.bytes||sha(data)!==pin.sha256)throw Error('Unpinned current SDK input: '+rel);}
  else if(!path.startsWith(dependencies+'/'))throw Error('Unexpected current SDK graph input');
  inputs.push({path,bytes:data.length,sha256:sha(data)});
 }
 mkdirSync(output,{recursive:true});const filename=requestedName||(profile==='browser'?'product-session-sdk.js':'product-session-native.mjs'),bundle=result.outputFiles[0].contents;
 writeFileSync(join(output,filename),bundle);writeFileSync(join(output,registryFilename),readFileSync(selected.registry));
 const source={sdkSourceCommit:selected.sourceCommit,sdkSourceTree:selected.sourceTree,sourceManifestSHA256:selected.sourceManifestSHA256,profile,bundlerVersion:esbuild.version,verifiedGraphInputs:inputs,files:[{path:filename,bytes:bundle.length,sha256:sha(bundle)},{path:registryFilename,bytes:readFileSync(selected.registry).length,sha256:sha(readFileSync(selected.registry))}],securityLevel:profile==='browser'?'webcrypto-nonextractable':'requires-genuine-protected-native-runtime',osProtected:false,hardwareBacked:false,installedWalletApprovalVerified:false,productionInstalled:false};
 writeFileSync(join(output,sourceFilename),JSON.stringify(source,null,2)+'\n');return {selected,source,output,filename,esbuildModule:modulePath};
}
export async function prepareCurrentNativeSdk(root){
 const output=mkdtempSync(join(tmpdir(),'ynx-media-r9-native-sdk-'));const built=await buildCurrentMediaSdk(root,output,'native');
 return {directory:output,esbuildModule:built.esbuildModule,manifest:{sourceCommit:built.source.sdkSourceCommit,sourceTree:built.source.sdkSourceTree,artifacts:Object.fromEntries(built.source.files.map(f=>[f.path,f]))}};
}
