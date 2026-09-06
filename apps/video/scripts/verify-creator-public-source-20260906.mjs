import {createHash} from 'node:crypto';
const origin='https://creator.ynxweb4.com';
const expected='29896f10c5e59fc17590dd3697d6e7af3d34a809';
const get=async path=>{const r=await fetch(origin+'/'+path,{redirect:'error',signal:AbortSignal.timeout(15000)});const bytes=Buffer.from(await r.arrayBuffer());return{status:r.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:r.headers.get('content-type'),body:bytes}};
const result=await get('creator-studio.manifest.json');const manifest=JSON.parse(result.body);if(result.status!==200||manifest.sourceCommit!==expected)throw Error('Creator source mismatch');
const files=[];
for(const item of manifest.files){const actual=await get(item.path);const matched=actual.status===200&&actual.bytes===item.bytes&&actual.sha256===item.sha256;files.push({path:item.path,status:actual.status,bytes:actual.bytes,sha256:actual.sha256,contentType:actual.contentType,matched});if(!matched)throw Error('Creator runtime bytes mismatch: '+item.path);}
const callback=await get('wallet-auth/callback');if(callback.status!==200||callback.sha256!==files.find(f=>f.path==='wallet-callback.html').sha256)throw Error('Callback route mismatch');
console.log(JSON.stringify({observedAt:new Date().toISOString(),origin,source:expected,publicFilesMatched:files.length,files,callback:{status:callback.status,sha256:callback.sha256},browserApprovalVerified:false},null,2));
