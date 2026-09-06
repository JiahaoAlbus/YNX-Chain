import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [product,envelopePath,output]=process.argv.slice(2);
if(!['creator','viewer'].includes(product)||!envelopePath)throw Error('Pass creator|viewer frozen-envelope.json [output.json]');
const envelope=JSON.parse(await readFile(envelopePath)),release=envelope.products[product].normal;
const origin=product==='creator'?'https://creator.ynxweb4.com':'https://video.ynxweb4.com',sha=b=>createHash('sha256').update(b).digest('hex');
const require=(x,m)=>{if(!x)throw Error(m)};
async function get(path){let last;for(let i=0;i<3;i++){try{const response=await fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(15000)});return {status:response.status,headers:response.headers,bytes:Buffer.from(await response.arrayBuffer())};}catch(error){last=error;}}throw last;}
const fetched=await get('/'+release.manifest);require(fetched.status===200&&sha(fetched.bytes)===release.manifestSHA256,'Public manifest differs from frozen artifact');require(fetched.headers.get('cache-control')==='no-store','Manifest cache policy');
const manifest=JSON.parse(fetched.bytes);require(manifest.sourceCommit===envelope.sourceCommit,'Wrong public source');
const entries=Array.isArray(manifest.files)?manifest.files:Object.entries(manifest.files).map(([path,x])=>({path,...x}));const files=[];
for(const item of entries){if(['server.mjs','package.json'].includes(item.path)||item.path.startsWith('runtime/'))continue;const response=await get('/'+item.path);require(response.status===200&&sha(response.bytes)===item.sha256,'Public bytes mismatch '+item.path);require(response.headers.get('cache-control')==='no-store','Cache mismatch '+item.path);files.push(item.path);}
const sdk=JSON.parse((await get('/product-session-sdk-source.json')).bytes);require(sdk.sdkSourceCommit===envelope.sdkSourceCommit,'Wrong public SDK');
const callback=await get('/wallet-auth/callback');require(callback.status===200&&sha(callback.bytes)===entries.find(x=>x.path==='wallet-callback.html').sha256,'Callback mismatch');require(callback.headers.get('cache-control')==='no-store','Callback cache mismatch');
const receipt={verifiedAt:new Date().toISOString(),origin,sourceCommit:manifest.sourceCommit,sdkSourceCommit:sdk.sdkSourceCommit,sdkSHA256:sdk.files.find(x=>x.path==='product-session-sdk.js').sha256,artifactSHA256:release.sha256,manifestSHA256:release.manifestSHA256,publicFilesMatched:files.length,files,callbackSHA256:sha(callback.bytes),noStoreVerified:true,installedWalletApprovalVerified:false,browserUIVerified:false,privateBusinessVerified:false};if(output)await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
