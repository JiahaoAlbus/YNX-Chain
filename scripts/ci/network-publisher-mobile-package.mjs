// Fresh production installation; no source-tree or development module borrowing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),pkg=path.join(root,'packages/wallet-auth');
const temp=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP??os.tmpdir(),'publisher-mobile-package-'));
const env={...process.env,NPM_CONFIG_CACHE:path.join(temp,'cache'),NPM_CONFIG_USERCONFIG:path.join(temp,'npmrc'),NPM_CONFIG_GLOBALCONFIG:path.join(temp,'global-npmrc')};
delete env.NODE_OPTIONS;delete env.NODE_PATH;
fs.writeFileSync(env.NPM_CONFIG_USERCONFIG,'registry=https://registry.npmjs.org\n');fs.writeFileSync(env.NPM_CONFIG_GLOBALCONFIG,'');
function run(command,args,cwd){const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:600000,maxBuffer:10485760});if(r.error)throw r.error;if(r.status!==0)throw Error(JSON.stringify({command,args,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr}));return r.stdout;}
const digest=b=>createHash('sha256').update(b).digest('hex');
try{
 const packed=JSON.parse(run('npm',['pack','--workspaces=false','--ignore-scripts','--json','--pack-destination',temp],pkg))[0];
 const consumer=path.join(temp,'consumer');fs.mkdirSync(consumer);fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'publisher-mobile-production-consumer',private:true,type:'module'}));
 run('npm',['install','--workspaces=false','--omit=dev','--ignore-scripts','--audit=false','--fund=false',path.join(temp,packed.filename)],consumer);
 const installed=path.join(consumer,'node_modules/@ynx-chain/wallet-auth');
 const leaves=JSON.parse(fs.readFileSync(path.join(pkg,'package.json'))).files.filter(p=>/original-network-current-publisher|original-network-resource-current-witness|original-p09-current-snapshot|wallet-mobile-qualified|original-auth-identity-source-v2-verifier|original-auth-source-v2-dispatch|original-auth-source-current-v2|original-auth-source-issuance-v2/.test(p));
 for(const p of leaves){const file=path.join(installed,p);if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||digest(fs.readFileSync(file))!==digest(fs.readFileSync(path.join(pkg,p))))throw Error('INSTALLED_BYTES_DIFFER:'+p);}
 const output=run(process.execPath,['--input-type=module','-e',`
 import assert from 'node:assert/strict';import {realpathSync} from 'node:fs';import {pathToFileURL} from 'node:url';
 const name='@ynx-chain/wallet-auth/network-resource-current-publisher',url=import.meta.resolve(name),prefix=pathToFileURL(realpathSync('node_modules/@ynx-chain/wallet-auth')+'/').href;
 assert.ok(url.startsWith(prefix));const m=await import(name),r=await m.acquireOriginalNetworkResourceCurrentPublisherV1();
 assert.equal(r.errorPresent,true);assert.equal(r.owner,null);assert.equal(r.error.code,'NETWORK_CURRENT_NO_ROOT_SELECTION');assert.equal(r.RootAdmission,false);
 const base=new URL('../',url),load=p=>import(new URL(p,base).href);
 await import('@ynx-chain/wallet-auth/auth-source-verification');
 const mobile=await load('native/original-wallet-mobile-qualified-source-contract.mjs');assert.equal(mobile.WALLET_MOBILE_QUALIFIED_SOURCE_PURPOSE,'wallet-mobile-qualified-source-v1');
 const current=await load('src/original-auth-source-current-v2.js'),issuance=await load('src/original-auth-source-issuance-v2.js');
 const policy={signatureContract:{purpose:mobile.WALLET_MOBILE_QUALIFIED_SOURCE_PURPOSE}};
 await assert.rejects(current.loadReleaseSelectedOriginalSourceV2({policy},()=>{throw Error('UNEXPECTED_PUBLIC_OR_PRIVATE_IO')}),{code:'MOBILE_SOURCE_NATIVE_LOADER_REQUIRED'});
 await assert.rejects(issuance.loadReleaseSelectedOriginalSourceIssuanceV2({plan:{policy}}),{code:'MOBILE_SOURCE_NATIVE_LOADER_REQUIRED'});
 console.log(JSON.stringify({installedPublicPublisher:true,mobileBothNodeLoadersRefusedBeforeIO:true,RootAdmission:false,NativeAdmission:false,realLogin:false,node:process.version}));
 `],consumer);
 const browser=spawnSync(process.execPath,['--conditions=browser','--input-type=module','-e',"await import('@ynx-chain/wallet-auth/network-resource-current-publisher')"],{cwd:consumer,env,encoding:'utf8'});
 if(browser.status===0||!browser.stderr.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'))throw Error('BROWSER_NODE_ONLY_BOUNDARY_FAILED');
 console.log(JSON.stringify({productionOnly:true,borrowedDevModules:false,exactInstalledLeaves:leaves.length,tgzSHA256:digest(fs.readFileSync(path.join(temp,packed.filename))),normal:JSON.parse(output.trim()),browserRefused:true}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
