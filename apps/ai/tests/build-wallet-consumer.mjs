import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../../..');
const frozen='a32a48283bd13c4d15aeaeb4a093322556abe778';
const deps=process.env.YNX_AI_DEPENDENCY_ROOT;
if(!deps)throw new Error('YNX_AI_DEPENDENCY_ROOT must identify an installed frozen dependency checkout.');
const require=createRequire(path.join(deps,'apps/wallet-web/package.json'));
const {build}=require('esbuild');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-ai-wallet-build-'));
const archive=execFileSync('git',['archive',frozen,'packages/wallet-auth','sdk/js','apps/wallet-web/src','apps/wallet-web/vendor/product-session-registry-123016847.json'],{cwd:root,maxBuffer:64*1024*1024});
execFileSync('tar',['-xf','-','-C',temp],{input:archive});
for(const relative of ['apps/ai/web/wallet-sdk-entry.mjs','packages/wallet-auth/src/central-browser-session-registry.js','packages/wallet-auth/src/walletconnect-dapp-connection.js']){fs.mkdirSync(path.dirname(path.join(temp,relative)),{recursive:true});fs.copyFileSync(path.join(root,relative),path.join(temp,relative));}
const nodes=[path.join(deps,'packages/wallet-auth/node_modules'),path.join(deps,'apps/wallet-web/node_modules'),path.join(deps,'node_modules')];
const result=await build({absWorkingDir:temp,entryPoints:['apps/ai/web/wallet-sdk-entry.mjs'],bundle:true,minify:true,platform:'browser',format:'esm',target:'es2022',legalComments:'none',write:false,metafile:true,nodePaths:nodes});
const bytes=result.outputFiles[0].contents;
const output='apps/ai/web/vendor/wallet-connection-a32-ai-v1.mjs';
fs.writeFileSync(path.join(root,output),bytes);
const versions={};for(const [name,expected] of Object.entries({'esbuild':'0.25.9','@walletconnect/sign-client':'2.23.10','@walletconnect/core':'2.23.10','qrcode':'1.5.4'})){const location=nodes.map(base=>path.join(base,name,'package.json')).find(file=>fs.existsSync(file));if(!location)throw new Error('Locked dependency missing: '+name);const version=JSON.parse(fs.readFileSync(location)).version;if(version!==expected)throw new Error('Dependency version differs: '+name);versions[name]=version;}
const digest=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const manifest={schemaVersion:1,inputCommit:frozen,hostedInputCommit:'52cce2ef8b24050c8eed47dd57529bf5624e3d36',socialRegistryInput:'e351175fe967f30089dd0c516f7d70f46966bbe1',aiOverlays:Object.fromEntries(['apps/ai/web/wallet-sdk-entry.mjs','packages/wallet-auth/src/central-browser-session-registry.js','packages/wallet-auth/src/walletconnect-dapp-connection.js'].map(file=>[file,digest(file)])),dependencies:versions,output,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,command:'YNX_AI_DEPENDENCY_ROOT=<frozen installed checkout> node apps/ai/tests/build-wallet-consumer.mjs',publicAccepted:false};
fs.writeFileSync(path.join(root,'apps/ai/web/vendor/wallet-connection-a32-ai-v1.json'),JSON.stringify(manifest,null,2)+'\n');
fs.rmSync(temp,{recursive:true,force:true});console.log(JSON.stringify(manifest));
