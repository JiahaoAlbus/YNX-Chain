import {createHash} from 'node:crypto';
const mode='viewer';
if(!['creator','viewer'].includes(mode))throw Error('Choose creator or viewer');
const origin=mode==='creator'?'https://creator.ynxweb4.com':'https://video.ynxweb4.com';
const source='91bad5347d4fa8ef17ca7ce962ad7d0d1d6cb810';
const sdkSource='ff68d6d1c81708bd0144016750002a87d50bb5f9';
const sdkSHA='dbbd61d824646c989e875eda8b620400b46ed4fdf36e98e8f3a507578ed31329';
const manifestName=mode==='creator'?'creator-studio.manifest.json':'runtime-manifest.json';
const get=async path=>{const response=await fetch(`${origin}/${path}`,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});const body=Buffer.from(await response.arrayBuffer());return {status:response.status,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),cacheControl:response.headers.get('cache-control'),body};};
const result=await get(manifestName),manifest=JSON.parse(result.body);
if(result.status!==200||manifest.sourceCommit!==source)throw Error('Public frontend source mismatch');
const files=Array.isArray(manifest.files)?manifest.files:Object.entries(manifest.files).map(([path,value])=>({path,...value}));
const internal=mode==='viewer'?['server.mjs','package.json','runtime/topology.json','runtime/post-p0239-recovery-baseline.json']:[];
const observed=[];
for(const expected of files){
 const actual=await get(expected.path);
 if(internal.includes(expected.path)){if(actual.status!==404)throw Error(`Internal file exposed: ${expected.path}`);}
 else if(actual.status!==200||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256||!actual.cacheControl?.includes('no-store'))throw Error(`Public bytes or caching mismatch: ${expected.path}`);
 observed.push({path:expected.path,status:actual.status,bytes:actual.bytes,sha256:actual.sha256});
}
if(observed.find(f=>f.path==='product-session-sdk.js')?.sha256!==sdkSHA)throw Error('Public SDK byte mismatch');
const sdk=JSON.parse((await get('product-session-sdk-source.json')).body);
if(sdk.sdkSourceCommit!==sdkSource)throw Error('Public SDK source mismatch');
const callback=await get('wallet-auth/callback');
if(callback.status!==200||callback.sha256!==files.find(f=>f.path==='wallet-callback.html').sha256)throw Error('Public callback route mismatch');
console.log(JSON.stringify({observedAt:new Date().toISOString(),mode,origin,source,sdkSource,sdkSHA,files:observed,publicFilesMatched:files.length-internal.length,internal404:internal.length,callbackSHA:callback.sha256,installedWalletApprovalVerified:false,browserUIVerified:false},null,2));
