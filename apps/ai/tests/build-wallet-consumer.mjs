import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../../..');
const aiEntryCommit='039b1b09465c99ccb1b02d57cee3a0fd875bda37';
const sharedCommit='1a8daf15c92602283c37c975f338fb16b596bb23';
const deps=process.env.YNX_AI_DEPENDENCY_ROOT;
if(!deps)throw new Error('YNX_AI_DEPENDENCY_ROOT must identify an installed locked dependency checkout.');
const nodes=['packages/wallet-auth','apps/wallet-web','apps/finance/web',''].map(value=>path.join(deps,value,'node_modules'));
const require=createRequire(path.join(deps,'apps/finance/web/package.json'));
const {build}=require('esbuild');
const versions={};for(const [name,expected] of Object.entries({'esbuild':'0.25.9','@walletconnect/sign-client':'2.23.10','@walletconnect/core':'2.23.10','qrcode':'1.5.4'})){const location=nodes.map(base=>path.join(base,name,'package.json')).find(file=>fs.existsSync(file));if(!location)throw new Error('Locked dependency missing: '+name);const version=JSON.parse(fs.readFileSync(location)).version;if(version!==expected)throw new Error('Dependency version differs: '+name);versions[name]=version;}
const lockInputs=['packages/wallet-auth/package-lock.json','apps/finance/web/package-lock.json'].map(file=>{const bytes=execFileSync('git',['show',sharedCommit+':'+file],{cwd:root});if(!bytes.equals(fs.readFileSync(path.join(deps,file))))throw new Error('Dependency lock differs from exact shared source: '+file);return {path:file,sourceCommit:sharedCommit,sha256:createHash('sha256').update(bytes).digest('hex')};});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-ai-wallet-build-'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 const archive=execFileSync('git',['archive',sharedCommit,'packages/wallet-auth','sdk/js','apps/wallet-web/src','apps/wallet-web/vendor'],{cwd:root,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','-C',temp],{input:archive});
 const entry='apps/ai/web/wallet-sdk-entry.mjs';
 const entryBytes=execFileSync('git',['show',aiEntryCommit+':'+entry],{cwd:root});
 if(!fs.readFileSync(path.join(root,entry)).equals(entryBytes))throw new Error('AI entry differs from exact reviewed source');
 fs.mkdirSync(path.dirname(path.join(temp,entry)),{recursive:true});fs.writeFileSync(path.join(temp,entry),entryBytes);
 const result=await build({absWorkingDir:temp,entryPoints:[entry],alias:{'@ynx-chain/wallet-auth/central-browser-session-contract':path.join(temp,'packages/wallet-auth/src/central-browser-session-contract.js')},bundle:true,minify:true,platform:'browser',format:'esm',target:'es2022',legalComments:'none',write:false,metafile:true,nodePaths:nodes});
 const bytes=result.outputFiles[0].contents,inputs=[];
 for(const input of Object.keys(result.metafile.inputs)){
  const absolute=path.resolve(temp,input),content=fs.readFileSync(absolute);
  const relative=path.relative(temp,absolute);
  if(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)){
   const commit=relative===entry?aiEntryCommit:sharedCommit;
   const blob=execFileSync('git',['show',commit+':'+relative],{cwd:root});
   if(!content.equals(blob))throw new Error('Source blob differs: '+relative);
   inputs.push({path:relative,bytes:content.length,sha256:digest(content),sourceCommit:commit});
  }else{
   const base=nodes.find(node=>absolute.startsWith(node+path.sep));
   if(!base)throw new Error('Unbound dependency input: '+absolute);
   inputs.push({path:path.relative(deps,base)+'/'+path.relative(base,absolute),bytes:content.length,sha256:digest(content),source:'installed locked dependency'});
  }
 }
 inputs.sort((a,b)=>a.path.localeCompare(b.path));
 if(bytes.length!==562596||digest(bytes)!=='9b55c017830bbfdf67bf4715a00f15f172d596b0a2b22468e8ce4de32ffa1865')throw new Error('Derived bytes differ from reviewed AI039/shared1a8 candidate');
 const output='apps/ai/web/vendor/wallet-connection-ai039-shared1a8.mjs';
 const manifest={schemaVersion:1,aiEntryCommit,sharedCommit,entry,dependencies:versions,lockInputs,output,sha256:digest(bytes),bytes:bytes.length,inputs,command:'YNX_AI_DEPENDENCY_ROOT=<installed locked checkout> node apps/ai/tests/build-wallet-consumer.mjs',publicAccepted:false,privateApproved:false};
 fs.writeFileSync(path.join(root,output),bytes);fs.writeFileSync(path.join(root,output.replace(/\.mjs$/,'.json')),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({output,sha256:manifest.sha256,bytes:bytes.length,inputs:inputs.length}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
