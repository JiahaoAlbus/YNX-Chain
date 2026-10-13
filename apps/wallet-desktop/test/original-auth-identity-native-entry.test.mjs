import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {originalAuthNativeBuildPlan} from '../scripts/build-original-auth-identity-native.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
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
