import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=process.argv[2];
if(!output||!path.isAbsolute(output))throw Error('Explicit absolute QA output required.');
await fs.mkdir(path.join(output,'bin'),{recursive:true});await fs.mkdir(path.join(output,'lib'),{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const files=[];
for(const name of ['cli.mjs','pay-business-client.mjs','merchant-invoice-approval.mjs','notification-inbox.mjs']){const raw=await fs.readFile(path.join(root,name));await fs.writeFile(path.join(output,'lib',name),raw);files.push({path:'lib/'+name,sha256:createHash('sha256').update(raw).digest('hex')});}
const originalNode=await fs.realpath(process.execPath);
if(process.platform==='darwin'){
 const linkage=execFileSync('otool',['-L',originalNode],{encoding:'utf8'});
 for(const match of linkage.matchAll(/@rpath\/(libnode\.[^\s/]+\.dylib)/g)){
  const name=match[1],source=path.resolve(path.dirname(originalNode),'../lib',name),raw=await fs.readFile(source);
  await fs.writeFile(path.join(output,'lib',name),raw);files.push({path:'lib/'+name,sha256:createHash('sha256').update(raw).digest('hex')});
 }
 await fs.writeFile(path.join(output,'NODE_LINKAGE.txt'),linkage);
}
await fs.copyFile(originalNode,path.join(output,'bin','node'));await fs.chmod(path.join(output,'bin','node'),0o755);
const nodeRaw=await fs.readFile(path.join(output,'bin','node'));files.push({path:'bin/node',sha256:createHash('sha256').update(nodeRaw).digest('hex')});
await fs.writeFile(path.join(output,'ynx-pay-native'),'#!/bin/sh\nset -eu\nclient_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$client_dir/bin/node" "$client_dir/lib/cli.mjs" "$@"\n',{mode:0o755});
await fs.copyFile(path.join(root,'README.md'),path.join(output,'README.md'));
await fs.writeFile(path.join(output,'BUILD.json'),JSON.stringify({head,builtAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,entry:'ynx-pay-native',files,kind:'standalone native-service business QA module/CLI; not a mobile GUI installer',sourceRuntimeBundled:false,mainOrSDKImageBundled:false,privateKeys:false,productionFunds:false,installed:false,deployed:false},null,2)+'\n');
console.log(JSON.stringify({output,head,entry:path.join(output,'ynx-pay-native')}));
