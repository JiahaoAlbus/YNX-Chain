import {createRequire} from 'node:module';
import {readFile, writeFile, readdir, mkdir, copyFile, realpath, lstat} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const developer=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(developer,'package.json'));
export async function bundleSolidityFormatRuntime(target, rpcInput) {
  const tools=await realpath(target);
  if(!tools.startsWith(join(developer,'.ynx-developer-candidates')+'/'))throw Error('Use an owned candidate extension.');
  const output=join(tools,'formatter');await mkdir(output);await mkdir(join(output,'node_modules'));
  const packages=[], selected=new Map(), hashes={};
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  async function dependencyRoot(local,name) {
    try{return dirname(local.resolve(name+'/package.json'));}
    catch(error){
      if(!['ERR_PACKAGE_PATH_NOT_EXPORTED','MODULE_NOT_FOUND'].includes(error.code))throw error;
      for(const directory of local.resolve.paths(name)||[]) {
        const candidate=join(directory,name);
        if(!candidate.startsWith(join(developer,'node_modules')+'/'))continue;
        try{const metadata=JSON.parse(await readFile(join(candidate,'package.json'),'utf8'));if(metadata.name===name)return candidate;}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      throw error;
    }
  }
  async function copyTree(source,destination,prefix) {
    await mkdir(destination,{recursive:true});
    for(const name of (await readdir(source)).sort()) {
      if(name==='node_modules')continue;
      const from=join(source,name),to=join(destination,name),key=prefix+'/'+name,stat=await lstat(from);
      if(stat.isDirectory())await copyTree(from,to,key);
      else if(stat.isFile()){await copyFile(from,to);hashes[key]=sha(await readFile(to));}
      else throw Error('Language service inputs must be regular files.');
    }
  }
  async function include(source) {
    source=await realpath(source);
    if(!source.startsWith(join(developer,'node_modules')+'/'))throw Error('Use retained owned dependency inputs.');
    const metadata=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
    if(selected.has(metadata.name)){if(selected.get(metadata.name)!==source)throw Error('Conflicting language service inputs.');return;}
    selected.set(metadata.name,source);
    await copyTree(source,join(output,'node_modules',metadata.name),'node_modules/'+metadata.name);
    packages.push({name:metadata.name,version:metadata.version,license:metadata.license});
    const local=createRequire(join(source,'package.json'));
    for(const name of Object.keys(metadata.dependencies||{}).sort())await include(await dependencyRoot(local,name));
  }
  const serverRoot=dirname(dirname(require.resolve('@nomicfoundation/solidity-language-server')));
  await include(serverRoot);
  await include(dirname(require.resolve(`@nomicfoundation/solidity-analyzer-${process.platform}-${process.arch}/package.json`)));
  const rpcRoot=await realpath(rpcInput || join(developer,'.ynx-developer-candidates/cpp-offline-language-release-inputs-20261004/ynx.ynx-cpp/node_modules/vscode-jsonrpc'));
  if(!rpcRoot.startsWith(join(developer,'.ynx-developer-candidates')+'/'))throw Error('Use the retained owned JSON-RPC input.');
  const rpc=JSON.parse(await readFile(join(rpcRoot,'package.json'),'utf8'));
  if(rpc.name!=='vscode-jsonrpc'||rpc.version!=='8.2.0'||Object.keys(rpc.dependencies||{}).length)throw Error('Unexpected JSON-RPC input.');
  await copyTree(rpcRoot,join(output,'node_modules/vscode-jsonrpc'),'node_modules/vscode-jsonrpc');
  packages.push({name:rpc.name,version:rpc.version,license:rpc.license});
  const entry=join(output,'node_modules/@nomicfoundation/solidity-language-server/out/index.js');
  const original=await readFile(entry,'utf8'),needle='const autoLoadDir = thirdParty.findParentDir(__dirname, "node_modules");';
  if(original.split(needle).length!==2)throw Error('The retained formatter integration changed.');
  // Nomic bundles its formatter and plugin. Prettier's automatic plugin scan
  // otherwise walks the parent's unrelated node_modules in a contained IDE.
  // Keep explicit plugins; remove only that unnecessary directory discovery.
  const derived=original.replace(needle,'const autoLoadDir = undefined;');
  await writeFile(entry,derived);
  const key='node_modules/@nomicfoundation/solidity-language-server/out/index.js';
  const originalSha256=hashes[key];hashes[key]=sha(derived);
  await writeFile(join(output,'distribution.json'),JSON.stringify({packages,files:hashes,originalServerSha256:originalSha256,derivedServerSha256:hashes[key],modification:'Disable automatic Prettier plugin directory scanning; retained bundled plugin is explicit.',downloaded:false,lifecycleScriptsExecuted:false},null,2)+'\n',{flag:'wx'});
  return {output,packages:packages.length,files:Object.keys(hashes).length,originalServerSha256:originalSha256,derivedServerSha256:hashes[key]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await bundleSolidityFormatRuntime(process.argv[2])));
