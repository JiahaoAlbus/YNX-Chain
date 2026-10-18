import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {originalAuthNativeBuildPlan,validateOriginalMacMinimumSystemVersion} from '../scripts/build-original-auth-identity-native.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('R11r2 PUBLIC every architecture explicitly inherits package minimum system, never host default',()=>{
 const pkg=JSON.parse(read('../package.json')),minimum=pkg.build.mac.minimumSystemVersion;
 assert.equal(minimum,'13.0');
 for(const arch of ['arm64','x64','universal']){
  const plan=originalAuthNativeBuildPlan(arch,'/PUBLIC/headers'),compilers=plan.commands.filter(command=>command.tool==='/usr/bin/clang++');
  assert.equal(compilers.length,arch==='universal'?2:1);
  for(const command of compilers)assert.equal(command.argv.filter(arg=>arg.startsWith('-mmacosx-version-min=')).join(','),'-mmacosx-version-min='+minimum);
  assert.equal(plan.minimumSystemVersion,minimum);
 }
});
test('R11r2 PUBLIC package minimum validator rejects malformed or unsupported deployment targets',()=>{
 for(const value of [undefined,null,13,'13','13.0 -bad','13.00','10.15','100.0','13.0.1.2','13.0\n','13.-1'])assert.throws(()=>validateOriginalMacMinimumSystemVersion(value),/MINIMUM_INVALID/);
 assert.equal(validateOriginalMacMinimumSystemVersion('13.0'),'13.0');assert.equal(validateOriginalMacMinimumSystemVersion('13.0.1'),'13.0.1');
});
test('R11 PUBLIC fixed native build plan uses only local declared sources and explicit headers, no execution',()=>{
 const p=originalAuthNativeBuildPlan('universal','/PUBLIC/headers');assert.equal(p.commands.length,3);assert.equal(p.commands[0].tool,'/usr/bin/clang++');assert.equal(p.commands[2].tool,'/usr/bin/lipo');assert(p.sources.every(v=>v.endsWith('.mm')));assert(p.output.endsWith('/native/original-auth-identity.node'));assert.throws(()=>originalAuthNativeBuildPlan('bogus','/PUBLIC/headers'));assert.throws(()=>originalAuthNativeBuildPlan('arm64','../headers'));
 const pkg=JSON.parse(read('../package.json'));assert(pkg.build.asarUnpack.includes('native/original-auth-identity.node'));assert(pkg.build.files.includes('native/original-auth-identity.node'));
});
test('R11 PUBLIC actual fixed binding loader refuses missing/incomplete module and invokes own capture without provider setter',()=>{
 const text=read('../../../packages/wallet-auth/src/original-wallet-service-private-dispatch.js'),start=text.indexOf('function loadFixedOriginalNativeServiceBinding()'),end=text.indexOf('\nconst originalNativeServiceBinding=',start),body=text.slice(start,end).replaceAll('import.meta.url',JSON.stringify('file:///PUBLIC/packages/wallet-auth/src/module.js'));
 let loads=0,captures=0;const names=['captureOriginalNativePrivateServiceBorrow','assertOriginalNativePrivateServiceCurrent','assertOriginalNativePrivateServiceAdmission','assertOriginalNativePrivateServiceTerminal','retireOriginalNativePrivateService','joinOriginalNativePrivateService','closeOriginalNativePrivateService'];
 const native=Object.fromEntries(names.map(name=>[name,()=>undefined]));native.captureOriginalNativePrivateServiceBorrow=original=>{captures++;if(original!=='PUBLIC_OWNED_REFERENCE')throw Error('PUBLIC_ALIEN');return original;};
 const context={URL,createRequire:url=>path=>{loads++;assert.equal(url.href,'file:///PUBLIC/packages/wallet-auth/src/');assert.equal(path,'/PUBLIC/apps/wallet-desktop/native/original-auth-identity.node');return native;}};vm.createContext(context);vm.runInContext(body+'\nthis.load=loadFixedOriginalNativeServiceBinding;',context);
 const binding=context.load();assert.equal(binding.capture('PUBLIC_OWNED_REFERENCE'),'PUBLIC_OWNED_REFERENCE');assert.throws(()=>binding.capture({}),/ALIEN/);assert.equal(captures,2);assert.equal(loads,1);
 delete native.closeOriginalNativePrivateService;assert.equal(context.load(),null);context.createRequire=()=>()=>{throw Error('PUBLIC_NO_MODULE');};assert.equal(context.load(),null);
});

// R114 recipe-only fixtures: no compiler, Source or authorization is executed.
const r114BaseSources=['apps/wallet-desktop/native/original-auth-identity-node.mm','packages/wallet-auth/native/original-auth-identity-source-authority.mm','packages/wallet-auth/native/original-auth-identity-joint-owner.mm','packages/wallet-auth/native/original-ide-parent-source-binding.mm','packages/wallet-auth/native/original-ide-parent-kernel.mm','packages/wallet-auth/native/original-ide-parent-node.mm'];
const r114NewSources=['apps/wallet-desktop/native/original-ide-wallet-identity-source-owner.inc.mm','packages/wallet-auth/native/original-ide-wallet-identity-source.h','packages/wallet-auth/native/original-ide-wallet-identity-source.mm','packages/wallet-auth/native/original-ide-wallet-peer-launch.h','packages/wallet-auth/native/original-ide-wallet-peer-launch.mm'];
async function r114Recipe(selected,check){
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),url=await import('node:url');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-r114-recipe-'));
 try{const files=[...r114BaseSources,...selected];for(const rel of files){await fs.mkdir(path.dirname(path.join(root,rel)),{recursive:true});await fs.writeFile(path.join(root,rel),'// PUBLIC recipe fixture only');}const script=path.join(root,'apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs');await fs.mkdir(path.dirname(script),{recursive:true});await fs.writeFile(script,read('../scripts/build-original-auth-identity-native.mjs'));await fs.writeFile(path.join(root,'apps/wallet-desktop/package.json'),JSON.stringify({build:{mac:{minimumSystemVersion:'13.0'}}}));await check((await import(url.pathToFileURL(script).href)).originalAuthNativeBuildPlan,root);}
 finally{await fs.rm(root,{recursive:true,force:true});}
}
test('R114 normal full transport recipe has eight actual TUs and AppKit on every architecture',()=>r114Recipe(r114NewSources,plan=>{for(const arch of ['arm64','x64','universal']){const p=plan(arch,'/PUBLIC/headers');assert.equal(p.sources.length,8);for(const c of p.commands.filter(c=>c.tool==='/usr/bin/clang++')){for(const s of p.sources)assert(c.argv.includes(s));for(const framework of ['Foundation','Security','AppKit'])assert(c.argv.some((v,i)=>v==='-framework'&&c.argv[i+1]===framework));assert(c.argv.includes('-lbsm'));assert(c.argv.includes('-DNODE_GYP_MODULE_NAME=original_auth_identity'));assert(c.argv.some(s=>s.endsWith('/packages/wallet-auth/native')&&s.startsWith('-I')));}}}));
test('R114 normal historical complete R111 recipe retains six actual TUs and original flags',()=>r114Recipe([],plan=>{const p=plan('arm64','/PUBLIC/headers');assert.equal(p.sources.length,6);assert(p.sources.some(s=>s.endsWith('/original-ide-parent-node.mm')));assert(p.commands[0].argv.includes('-lbsm'));assert(!p.commands[0].argv.includes('AppKit'));}));
test('R114 normal half-selected transport never silently builds an old recipe',async()=>{for(const missing of r114NewSources)await r114Recipe(r114NewSources.filter(x=>x!==missing),plan=>assert.throws(()=>plan('arm64','/PUBLIC/headers'),/AUTH_NATIVE_TRANSPORT_SOURCE_SELECTION_INCOMPLETE/));});
