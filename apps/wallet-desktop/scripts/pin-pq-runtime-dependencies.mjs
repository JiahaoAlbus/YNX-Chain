// Mechanical source-manifest generation from the already approved exact
// supplier install. No install scripts, network, ambient dependency fallback.
import {readFileSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const supplier='/Users/huangjiahao/ynx-wallet-pq-sdk-r1-20261018/provider-install/node_modules';
const versions={'@noble/curves':'2.2.0','@noble/hashes':'2.2.0','@noble/ciphers':'2.2.0','@noble/post-quantum':'0.6.1','@ynx/batch-v01-candidate':'0.1.0-candidate.2'};
const sha=b=>createHash('sha256').update(b).digest('hex'),files=[];
const tgz='/Users/huangjiahao/Desktop/YNX Protocol Worktrees/ynx-batch-v01-20261018/ynx-batch-v01-candidate-0.1.0-candidate.2.tgz';
const archive=readFileSync(tgz);if(archive.length!==17804||sha(archive)!=='401eca733083c2ac67998295c54f09f0553760b99eaf0adf9ef1e1a85b4cbd0b')throw Error('PROVIDER_PIN_CHANGED');
function visit(relative){
 const input=path.join(supplier,relative),local=path.join(root,'packages/wallet-auth/node_modules',relative),stat=lstatSync(input),actual=lstatSync(local);
 if(stat.isSymbolicLink()||actual.isSymbolicLink())throw Error('DEPENDENCY_SYMLINK');
 if(stat.isDirectory()){if(!actual.isDirectory())throw Error('DEPENDENCY_TYPE');const names=readdirSync(input).sort();if(JSON.stringify(names)!==JSON.stringify(readdirSync(local).sort()))throw Error('DEPENDENCY_INVENTORY');for(const name of names)visit(relative+'/'+name);}
 else{if(!stat.isFile()||!actual.isFile())throw Error('DEPENDENCY_TYPE');const bytes=readFileSync(input);if(!bytes.equals(readFileSync(local)))throw Error('DEPENDENCY_BYTES');files.push({path:relative,bytes:bytes.length,sha256:sha(bytes)});}
}
for(const [name,version] of Object.entries(versions)){const metadata=JSON.parse(readFileSync(path.join(supplier,name,'package.json')));if(metadata.name!==name||metadata.version!==version)throw Error('DEPENDENCY_VERSION');visit(name);}
if(files.length!==316)throw Error('DEPENDENCY_COUNT_CHANGED');
files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const manifest={schemaVersion:2,sdkCommit:'c9a869ccfb553776ab751ef474408a73a85214ee',provider:{version:versions['@ynx/batch-v01-candidate'],bytes:archive.length,sha256:sha(archive)},versions,files,profile:'Same 316 IDE/PQ dependency bytes as SDK3.9, read back from SDK3.10 clean119 install. Not the complete WalletConnect dependency closure.'};
writeFileSync(path.join(root,'apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({runtimeFiles:files.length,providerSHA256:sha(archive),network:false,scriptsExecuted:false}));
