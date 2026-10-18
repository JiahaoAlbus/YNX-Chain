import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {originalPQVerifierReceipt} from '../src/wallet-pq-verifier-receipt.mjs';
const helper=new URL('../scripts/packaged-proof-verifier.mjs',import.meta.url);
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'wallet-proof-package-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const stage=path.join(root,'stage'),resources=path.join(root,'Resources'),files={'SOURCE.json':'PUBLIC source','manifest.json':'PUBLIC manifest','darwin-arm64/ynx-consensus-proof-verify':'PUBLIC not executable'};
 await fs.mkdir(path.join(stage,'consensus-proof-verifier/darwin-arm64'),{recursive:true});await fs.mkdir(resources);
 for(const [name,body]of Object.entries(files))await fs.writeFile(path.join(stage,'consensus-proof-verifier',name),body);
 const checked=[],validator=async(p,receipt)=>{assert.equal(receipt,originalPQVerifierReceipt);checked.push(p);for(const [name,body]of Object.entries(files))assert.equal(await fs.readFile(path.join(p,'consensus-proof-verifier',name),'utf8'),body);};
 const source=(await fs.readFile(helper,'utf8')).replace(/^import .*;$/mg,'').replace(/^export /mg,'');
 const context={fs,constants,path,verifyPackagedPQVerifierAssets:validator,originalPQVerifierReceipt};runInNewContext(source+'\nthis.install=installPackagedPQVerifierAssets;',context);
 return {root,stage,resources,files,checked,install:context.install};
}
test('source-owned independent receipt retains original signed identity, not the CI raw signature',()=>{
 assert.equal(originalPQVerifierReceipt.bundled.bytes,34223248);assert.equal(originalPQVerifierReceipt.bundled.sha256,'5e90e692f2ee84ebcf9db88b7a160eb544e8d82321eb059ebf2b5c332fb0aea8');assert.equal(originalPQVerifierReceipt.manifest.sha256,'459278dd4689724b251f0ddce764a86c76bbe89d6c7eea54f2cf7d323c312140');assert.equal(Object.isFrozen(originalPQVerifierReceipt),true);assert.equal(Object.isFrozen(originalPQVerifierReceipt.manifest),true);
});
test('PUBLIC copy-policy seam copies three fixed paths exclusively and verifies both sides after copy, without signing',async t=>{
 const f=await fixture(t),result=await f.install(f.resources,f.stage);assert.deepEqual(f.checked,[f.stage,f.stage,f.resources]);assert.equal(result.bundledSha256,originalPQVerifierReceipt.bundled.sha256);assert.equal(result.outerSealed,false);
 assert.equal((await fs.stat(path.join(f.resources,'consensus-proof-verifier/darwin-arm64/ynx-consensus-proof-verify'))).mode&0o777,0o755);assert.equal((await fs.stat(path.join(f.resources,'consensus-proof-verifier/SOURCE.json'))).mode&0o777,0o644);
});
test('existing candidate assets are preserved rather than overwritten by a repeated stage copy',async t=>{
 const f=await fixture(t);await f.install(f.resources,f.stage);const before=await fs.readFile(path.join(f.resources,'consensus-proof-verifier/manifest.json'));await assert.rejects(f.install(f.resources,f.stage));assert.deepEqual(await fs.readFile(path.join(f.resources,'consensus-proof-verifier/manifest.json')),before);
});
test('invalid stage bytes, symlink root and noncanonical stage are rejected before candidate files exist',async t=>{
 const f=await fixture(t);await assert.rejects(f.install(f.resources,'relative'));await fs.symlink(f.stage,path.join(f.root,'alias'));await assert.rejects(f.install(f.resources,path.join(f.root,'alias')));await fs.writeFile(path.join(f.stage,'consensus-proof-verifier/SOURCE.json'),'altered');await assert.rejects(f.install(f.resources,f.stage));await assert.rejects(fs.stat(path.join(f.resources,'consensus-proof-verifier')),{code:'ENOENT'});
});
test('normal Mac hook installs fixed assets before outer signing and skip-sign pattern matches only that executable',async()=>{
 const source=await fs.readFile(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8'),stripped=source.replace(/^import .*;$/mg,'').replace('export default async function afterPack','async function afterPack').replace(/^export /mg,'');
 const calls=[],context={path,process:{env:{YNX_WALLET_PROOF_VERIFIER_RESOURCES_STAGE:'/PUBLIC/independent-stage'}},desktopReleaseIdentity:()=>({PUBLIC:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage:()=>{},buildPublicWalletConnectConfig:()=>({}),WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',installPackagedPQVerifierAssets:async(...args)=>{calls.push(args);throw Error('PUBLIC stop before plist/outer signing');}};
 runInNewContext(stripped+'\nthis.hook=afterPack;',context);
 await assert.rejects(context.hook({electronPlatformName:'darwin',arch:3,appOutDir:'/PUBLIC/output',packager:{projectDir:'/PUBLIC/source',appInfo:{productFilename:'Wallet',version:'0.6.10'}}}),/PUBLIC stop/);
 assert.deepEqual(calls,[['/PUBLIC/output/Wallet.app/Contents/Resources','/PUBLIC/independent-stage']]);
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url))),patterns=pkg.build.mac.signIgnore;assert.equal(patterns.length,1);const re=new RegExp(patterns[0]);assert(re.test('/PUBLIC/Wallet.app/Contents/Resources/consensus-proof-verifier/darwin-arm64/ynx-consensus-proof-verify'));assert(!re.test('/PUBLIC/Wallet.app/Contents/MacOS/Wallet'));assert(!re.test('/PUBLIC/Wallet.app/Contents/Resources/app.asar.unpacked/native/original-auth-identity.node'));
});
test('normal Main and preload consume only independent source receipt and expose no resource path or caller-selected receipt',async()=>{
 const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await fs.readFile(new URL('../src/preload.cjs',import.meta.url),'utf8'),handlers=new Map(),calls=[];
 const factory=main.split('\n').find(s=>s.startsWith('const createOriginalPQFinalityVerifier=')),route=main.split('\n').find(s=>s.startsWith("handleWalletIPC('wallet:pq-finality-verifier-status'"));
 const context={app:{PUBLIC:true},originalPQVerifierReceipt,createPackagedPQFinalityVerifier:input=>{assert.equal(input.independentReceipt,originalPQVerifierReceipt);return{verifyAssets:async()=>({available:true,nativeGrant:false,independentFinality:false})};},handleWalletIPC:(name,fn)=>handlers.set(name,fn),safeIPC:fn=>fn()};runInNewContext(factory+'\n'+route,context);
 let api;new Function('require',preload)(()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(channel,...args)=>{calls.push(args);return handlers.get(channel)();}}}));
 const result=await api.pqFinalityVerifierStatus();assert.equal(result.available,true);assert.equal(result.nativeGrant,false);assert.deepEqual(calls,[[]]);assert.doesNotMatch(JSON.stringify(result),/path|receipt|root/i);
});
