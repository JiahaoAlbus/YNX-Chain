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
