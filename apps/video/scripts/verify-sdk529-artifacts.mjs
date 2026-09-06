import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const [directory,output,source]=process.argv.slice(2);
if(!directory||!output||!/^[a-f0-9]{40}$/.test(source))throw Error('Pass frozen artifact directory, output receipt and exact source');
const sha=b=>createHash('sha256').update(b).digest('hex');const require=(x,m)=>{if(!x)throw Error(m)};
const results=[];
for(const name of (await readdir(directory)).filter(x=>new RegExp('^ynx-(creator|viewer)-'+source.slice(0,9)+'-(normal|recovery)\\.tar\\.gz$').test(x)).sort()){
 const recovery=name.includes('-recovery'),creator=name.includes('creator'),stage=await mkdtemp(join(tmpdir(),'ynx-sdk529-verify-'));
 let child;try{
  execFileSync('tar',['-xzf',join(directory,name),'-C',stage]);const root=recovery||!creator?join(stage,'runtime'):stage;
  const manifestName=creator&&!recovery?'creator-studio.manifest.json':'runtime-manifest.json';
  const raw=await readFile(join(root,manifestName)),manifest=JSON.parse(raw),entries=Array.isArray(manifest.files)?manifest.files:Object.entries(manifest.files).map(([path,v])=>({path,...v}));
  require(manifest.sourceCommit===source,'Wrong source');
  for(const item of entries){const b=await readFile(join(root,item.path));require(b.length===item.bytes&&sha(b)===item.sha256,'Local file mismatch '+item.path)}
  const sdk=JSON.parse(await readFile(join(root,'product-session-sdk-source.json')));require(sdk.sdkSourceCommit==='529471f3822d2bac43ea47a1ab8004fa2ae79885','Wrong SDK');require(sdk.sourceArchive.sha256==='68a4d192c2a7d82d1ea3f69fe6fe6e7d9c670ce7e4ca29b06fea0341ca4e0e18','Wrong full archive');
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','ignore','pipe']});let logs='';child.stderr.on('data',b=>logs+=b);
  const url='http://127.0.0.1:'+port;for(let i=0;i<60;i++){try{await fetch(url+'/'+manifestName);break}catch(e){if(i===59)throw Error(logs||e.message);await new Promise(r=>setTimeout(r,50));}}
  const served=[];
  for(const item of [...entries,{path:manifestName,bytes:raw.length,sha256:sha(raw)}]){
   const internal=item.path==='server.mjs'||item.path==='package.json'||item.path.startsWith('runtime/');
   if(internal)continue;
   const response=await fetch(url+'/'+item.path),bytes=Buffer.from(await response.arrayBuffer());
   require(response.status===(recovery&&item.path==='index.html'?503:200),'HTTP status '+item.path);require(response.headers.get('cache-control')==='no-store','Cache '+item.path);require(sha(bytes)===item.sha256,'HTTP bytes '+item.path);
   if(recovery){require(response.headers.get('x-ynx-source')===source,'Recovery source header');require(response.headers.get('x-ynx-mode')==='compatible-recovery','Recovery mode header');}
   served.push(item.path);
  }
  for(const path of (creator&&!recovery?['/wallet-auth/callback?result=approved&request=fixture']:['/wallet-auth/callback?result=approved&request=fixture','/video/wallet-auth/callback?result=rejected'])){
   const response=await fetch(url+path),bytes=Buffer.from(await response.arrayBuffer()),expected=await readFile(join(root,recovery?'index.html':'wallet-callback.html'));
   require(response.status===(recovery?503:200),'Callback HTTP');require(sha(bytes)===sha(expected),'Callback file');require(response.headers.get('cache-control')==='no-store','Callback cache');
  }
  if(recovery){for(const path of ['/app.js','/wallet-callback.js','/server.mjs'])require((await fetch(url+path)).status===404,'Recovery exposes normal entry');for(const path of ['/v1/studio','/video/api/v1/history'])require((await fetch(url+path)).status===503,'Recovery private admission');require((await fetch(url+'/',{method:'POST',body:'fixture'})).status===503,'Recovery POST admission');}
  const archive=await readFile(join(directory,name));results.push({archive:name,bytes:archive.length,sha256:sha(archive),sourceCommit:source,mode:recovery?'compatible-recovery':'normal',product:creator?'creator':'viewer',manifestName,manifestSHA256:sha(raw),filesVerified:entries.length,publicFilesVerified:served,callbackNoStore:true,localNode:process.version,localPlatform:process.platform,installedWalletApprovalVerified:false,browserUIVerified:false});
 }finally{if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}await rm(stage,{recursive:true,force:true});}
}
require(results.length===4,'Expected four frozen packages');await writeFile(output,JSON.stringify({testedAt:new Date().toISOString(),results},null,2)+'\n');console.log(JSON.stringify(results.map(x=>({artifact:x.archive,sha256:x.sha256,publicFiles:x.publicFilesVerified.length})),null,2));
