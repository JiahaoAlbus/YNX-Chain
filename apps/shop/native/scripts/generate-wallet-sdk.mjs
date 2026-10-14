import {readFile,writeFile,mkdir,mkdtemp,copyFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareCurrentWalletSDK,CURRENT_WALLET_SDK} from '../../../seller-console/scripts/current-wallet-sdk.mjs';

const native=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const nativeSources=Object.freeze({android:join(native,'android/app/src/main/assets/native-session'),apple:join(native,'ios/YNXShop/native-session')});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const historicalSDK='a7d0f2a8bac2780f3b4db39a904245947cf5ed7a20ea62933b18e7e5369c8f82';
export async function nativeSDKInput(platform) {
    if(!Object.hasOwn(nativeSources,platform))throw new Error('Choose android or apple Native generation');
    const sdk=await prepareCurrentWalletSDK({dependencies:resolve(native,'../node_modules')});
    const constructor=sdk.entry('./product-session-native');
    // Both implementations are from the verified same-copy package, not a browser factory.
    const gateway=join(sdk.root,'src/product-session-gateway-client.js');
    return {sdk,constructor,gateway,entry:`export {createNativeProductSessionClient} from ${JSON.stringify(constructor)};\nexport {ProductSessionGatewayFetchAdapter} from ${JSON.stringify(gateway)};\n`};
}
export function nativePinSource(platform,sha256) {
    if(!/^[a-f0-9]{64}$/.test(sha256)||sha256===historicalSDK)throw new Error('An actual current module SHA-256 is required');
    if(platform==='android')return `package com.ynxweb4.shop;\nfinal class NativeSDKPin { static final String SHA256="${sha256}"; static final String ARCHIVE_SHA256="${CURRENT_WALLET_SDK.sha256}"; static final String SOURCE_HEAD="${CURRENT_WALLET_SDK.sourceHead}"; static final String SOURCE_TREE="${CURRENT_WALLET_SDK.sourceTree}"; }\n`;
    if(platform==='apple')return `enum NativeSDKPin { static let sha256="${sha256}"; static let archiveSHA256="${CURRENT_WALLET_SDK.sha256}"; static let sourceHead="${CURRENT_WALLET_SDK.sourceHead}"; static let sourceTree="${CURRENT_WALLET_SDK.sourceTree}" }\n`;
    throw new Error('Unsupported Native pin platform');
}
export function validateNativeSDKManifest(manifest,bytes,platform) {
    if(!['android','apple'].includes(platform)||!bytes.length||bytes.length>2_097_152||manifest?.schemaVersion!==1||manifest.platform!==platform||manifest.archiveSHA256!==CURRENT_WALLET_SDK.sha256||manifest.sourceHead!==CURRENT_WALLET_SDK.sourceHead||manifest.sourceTree!==CURRENT_WALLET_SDK.sourceTree||manifest.constructor!=='createNativeProductSessionClient'||manifest.sha256===historicalSDK||manifest.sha256!==hash(bytes)||manifest.bytes!==bytes.length)
        throw new Error('Generated Native SDK provenance or bytes mismatch');
    return manifest.sha256;
}
export async function generateNativeSDK(platform,output) {
    const repository=resolve(native,'../../..');output=resolve(output);
    if(output.startsWith(repository+sep)&&!output.includes(sep+'build'+sep))throw new Error('Native SDK generation must not overwrite source assets');
    const input=await nativeSDKInput(platform);
    const {build}=await import('esbuild');
    const result=await build({...input.sdk.buildOptions,stdin:{contents:input.entry,resolveDir:input.sdk.root,sourcefile:'commerce-native-r9-entry.mjs'},outfile:'wallet-auth-native-consumer.mjs',write:false,bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],legalComments:'none'});
    const bytes=result.outputFiles[0].contents;
    if(!bytes.length||bytes.length>2_097_152||/node:crypto|node:fs|node:path|createBrowserProductSessionClient/.test(new TextDecoder().decode(bytes)))throw new Error('Native projection includes a forbidden dependency or constructor');
    const manifest={schemaVersion:1,platform,archiveSHA256:CURRENT_WALLET_SDK.sha256,sourceHead:CURRENT_WALLET_SDK.sourceHead,sourceTree:CURRENT_WALLET_SDK.sourceTree,constructor:'createNativeProductSessionClient',bytes:bytes.length,sha256:hash(bytes)};
    validateNativeSDKManifest(manifest,bytes,platform);
    await mkdir(dirname(output),{recursive:true});
    const staged=await mkdtemp(join(dirname(output),'.native-sdk-staging-'));
    const assets=join(staged,platform==='android'?'assets/native-session':'native-session');
    await mkdir(assets,{recursive:true});
    for(const name of ['client.mjs','index.html','registry.json'])await copyFile(join(nativeSources[platform],name),join(assets,name));
    await writeFile(join(assets,'wallet-auth-native-consumer.mjs'),bytes);
    await writeFile(join(assets,'sdk-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    const pin=join(staged,platform==='android'?'sources/com/ynxweb4/shop/NativeSDKPin.java':'NativeSDKPin.swift');
    await mkdir(dirname(pin),{recursive:true});await writeFile(pin,nativePinSource(platform,manifest.sha256));
    const readback=await readFile(join(assets,'wallet-auth-native-consumer.mjs'));
    validateNativeSDKManifest(JSON.parse(await readFile(join(assets,'sdk-manifest.json'),'utf8')),readback,platform);
    // Retain a prior generated directory; never delete frozen source modules or user data.
    try{await rename(output,output+'.previous-'+Date.now())}catch(error){if(error.code!=='ENOENT')throw error}
    await rename(staged,output);return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
    const [platform,output,...extra]=process.argv.slice(2);
    if(!output||extra.length)throw new Error('Usage: generate-wallet-sdk.mjs android|apple GENERATED_OUTPUT');
    console.log(JSON.stringify(await generateNativeSDK(platform,output)));
}
