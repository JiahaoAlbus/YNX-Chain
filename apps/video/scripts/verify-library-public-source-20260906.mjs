import {createHash} from 'node:crypto';
const origin='https://video.ynxweb4.com';
const source='48fe3824cc6a38ba944427776e48d076f27f54f5';
const get=async path=>{const r=await fetch(origin+'/'+path,{redirect:'error',signal:AbortSignal.timeout(15000)});const body=Buffer.from(await r.arrayBuffer());return{status:r.status,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),contentType:r.headers.get('content-type'),cacheControl:r.headers.get('cache-control'),body};};
const response=await get('runtime-manifest.json');
const manifest=JSON.parse(response.body);
if(response.status!==200||manifest.sourceCommit!==source)throw Error('Viewer source mismatch');
const nonPublic=new Set(['server.mjs','package.json','runtime/topology.json','runtime/post-p0239-recovery-baseline.json']);
const files=[];
for(const [path,expected]of Object.entries(manifest.files)){
 const actual=await get(path);
 if(nonPublic.has(path)){if(actual.status!==404)throw Error('Private runtime file exposed: '+path);files.push({path,status:404,public:false});continue;}
 const matched=actual.status===200&&actual.bytes===expected.bytes&&actual.sha256===expected.sha256;
 files.push({path,status:actual.status,bytes:actual.bytes,sha256:actual.sha256,contentType:actual.contentType,matched,public:true});
 if(!matched)throw Error('Public file mismatch: '+path);
}
const callback=await get('wallet-auth/callback');
if(callback.status!==200||callback.sha256!==manifest.files['wallet-callback.html'].sha256)throw Error('Callback route mismatch');
const version=await get('video/api/version');
if(version.status!==200||JSON.parse(version.body).build.commit!==source)throw Error('API version mismatch');
const videoId='vid_037cc8f97abd9a6dff7a4e74';
const videoResponse=await get('video/api/v1/videos/'+videoId),video=JSON.parse(videoResponse.body);
if(videoResponse.status!==200||video.sha256!=='be414db1d01558b11c7592b7d4dc69d0fee8da158997dc477e2fdaf6b9e3ee39')throw Error('Owned QA media source mismatch');
const media=[];
for(const asset of video.variants){
 const actual=await get('video/api/media/'+asset.object_key);
 const expectedType=asset.mime;
 if(actual.status!==200||actual.sha256!==asset.sha256||actual.bytes!==asset.bytes||actual.contentType!==expectedType||actual.cacheControl!=='no-store')throw Error('Media integrity/type/cache mismatch: '+asset.object_key);
 media.push({path:asset.object_key,status:actual.status,bytes:actual.bytes,sha256:actual.sha256,contentType:actual.contentType,cacheControl:actual.cacheControl});
}
console.log(JSON.stringify({observedAt:new Date().toISOString(),source,origin,manifestFiles:files.length,publicFilesMatched:files.filter(x=>x.public).length,privateFilesRejected:files.filter(x=>!x.public).length,files,callback:{status:callback.status,sha256:callback.sha256},apiSource:source,media,browserPlaybackVerified:false,installedWalletApprovalVerified:false},null,2));
