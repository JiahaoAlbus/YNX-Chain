import test from 'node:test';
import assert from 'node:assert/strict';
import {assertC6CocoaReceiptDATA,assertC6CocoaDependenciesDATA,assertC6CocoaReuseDATA,rethrowC6Primary} from './c6-diagnostic-product.mjs';
const hash='a'.repeat(64),p={outputRoot:'/PUBLIC/cocoa',output:'/PUBLIC/cocoa/UNINSTALLED.app/Contents/MacOS/YNXDeveloper',sourceRoles:{CPP:'original-cpp',Swift:'original-swift',P03:'original-consumer'},commands:[{name:'compile-main',argv:['/usr/bin/clang','PUBLIC-main.m']},{name:'strict-link',argv:['/usr/bin/xcrun','swiftc','PUBLIC-object']} ]};
const complete=()=>({schema:'YNX_IDE_C6_PRODUCT_COCOA_EXECUTION/v1',complete:true,error:null,inputContractSHA256:hash,outputRoot:p.outputRoot,sourceRoles:structuredClone(p.sourceRoles),commands:structuredClone(p.commands),results:p.commands.map(x=>({name:x.name,status:0,signal:null})),ownedUndefined:[],output:{path:p.output,bytes:123,sha256:hash}});
test('completed Cocoa is accepted only with its exact executed commands, roles and output',()=>{
 assert.equal(assertC6CocoaReceiptDATA(complete(),p,hash),true);
 for(const mutate of [r=>{r.complete=false;},r=>{r.error='PUBLIC failed';},r=>{r.results[1].status=1;},r=>{r.results[1].signal='SIGTERM';},r=>{r.results.reverse();},r=>{r.commands[1].argv.push('-undefined','dynamic_lookup');},r=>{r.sourceRoles.CPP='old-unmatched-node';},r=>{r.inputContractSHA256='b'.repeat(64);},r=>{r.ownedUndefined.push('_YNXUnresolved');},r=>{r.output.path='/PUBLIC/another.app';},r=>{r.outputRoot='/PUBLIC/other';},r=>{r.output.bytes=0;}]){
  const r=complete();mutate(r);assert.throws(()=>assertC6CocoaReceiptDATA(r,p,hash),/same-plan/);
 }
});
test('failed log or cleanup record writes cannot replace the original failure, including falsy causes',async()=>{
 const first=Error('PUBLIC compiler first cause'),second=Error('PUBLIC disk full'),seen=[];
 await assert.rejects(rethrowC6Primary(first,async()=>{throw second;},error=>seen.push(error)),error=>error===first);
 assert.deepEqual(seen,[second]);
 for(const value of [0,false,null,undefined]){
  const caught=await rethrowC6Primary(value,async()=>{throw second;},()=>{throw Error('PUBLIC observer failed');}).then(()=>assert.fail('must reject'),error=>error);
  assert.equal(caught,value);
 }
});
test('actual linked dependency data rejects original absolute libraries and unrelated runtime injection',()=>{
 const text='PUBLIC-app:\n\t@rpath/libssl.3.dylib (compatibility version 3)\n\t@rpath/libcrypto.3.dylib (compatibility version 3)\n\t/usr/lib/libSystem.B.dylib (compatibility version 1)\n';
 const rewrites=[{from:'/PUBLIC/build/libssl.3.dylib',to:'@rpath/libssl.3.dylib'},{from:'/PUBLIC/build/libcrypto.3.dylib',to:'@rpath/libcrypto.3.dylib'}];
 assert.equal(assertC6CocoaDependenciesDATA(text,rewrites),true);
 assert.throws(()=>assertC6CocoaDependenciesDATA(text.replace('@rpath/libssl.3.dylib',rewrites[0].from),rewrites),/exact relative/);
 assert.throws(()=>assertC6CocoaDependenciesDATA(text+'\t@rpath/unrelated.dylib (compatibility version 1)\n',rewrites),/exact relative/);
});

test('relinked Cocoa retains exact original failed execution, contract and two successful root objects',()=>{
 const expected={...p,originalFailedExecution:{path:'/PUBLIC/r8/failure.json',bytes:10,sha256:hash},originalInputContract:{path:'/PUBLIC/r8/contract.json',bytes:20,sha256:hash},retainedRootObjects:[{path:'/PUBLIC/r8/main.o',bytes:30,sha256:hash},{path:'/PUBLIC/r8/parent.o',bytes:40,sha256:hash}]};
 const make=()=>({...complete(),normalContinuation:{originalFailedExecution:structuredClone(expected.originalFailedExecution),originalInputContract:structuredClone(expected.originalInputContract),reusedMainParentObjects:structuredClone(expected.retainedRootObjects)}});
 assert.equal(assertC6CocoaReceiptDATA(make(),expected,hash),true);
 for(const mutate of [r=>{delete r.normalContinuation;},r=>{r.normalContinuation.originalFailedExecution.path='/PUBLIC/another/failure.json';},r=>{r.normalContinuation.originalInputContract.sha256='b'.repeat(64);},r=>{r.normalContinuation.reusedMainParentObjects.reverse();},r=>{r.normalContinuation.reusedMainParentObjects[0].bytes++;},r=>{r.normalContinuation.reusedMainParentObjects[1].sha256='b'.repeat(64);}]){
  const r=make();mutate(r);assert.throws(()=>assertC6CocoaReceiptDATA(r,expected,hash),/continuation custody/);
 }
});

test('resource successor adopts only exact original Cocoa receipt without relabeling or rerunning commands',()=>{
 const pin={path:'/PUBLIC/original/cocoa-execution.json',bytes:123,sha256:hash};
 const make=()=>({plan:{reusedCocoaExecution:structuredClone(pin),commands:[],sourceRoles:structuredClone(p.sourceRoles),CocoaPlan:structuredClone(p)},execution:{cocoaExecution:structuredClone(pin),compiledCocoaReused:true,sourceRoles:structuredClone(p.sourceRoles)}});
 const valid=make();assert.equal(assertC6CocoaReuseDATA(valid.plan,valid.execution,pin),true);
 for(const change of [f=>{f.plan.reusedCocoaExecution.sha256='b'.repeat(64);},f=>{f.execution.cocoaExecution.path='/PUBLIC/new';},f=>{f.execution.compiledCocoaReused=false;},f=>{f.plan.commands.push(p.commands[0]);},f=>{f.plan.sourceRoles.P03='new-uncompiled';},f=>{f.execution.sourceRoles.P03='new-uncompiled';}]){
  const f=make();change(f);assert.throws(()=>assertC6CocoaReuseDATA(f.plan,f.execution,pin),/original Cocoa custody/);
 }
});
