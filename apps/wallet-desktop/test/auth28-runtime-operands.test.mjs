import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {relocateDesktopRuntimeSource,declaredSDKRuntimeSources} from '../scripts/release-provenance.mjs';
const version='1.3.0-pq.3.32-auth.28',name='packages/wallet-auth/src/original-auth-source-current-v2.js',operand='../../../apps/wallet-desktop/native/original-source-current-dirfd.node';
const sample=Buffer.from(`const optional=new URL('${operand}',import.meta.url);\n`),target=process.env.WALLET_AUTH28_APP_SOURCE_ROOT;
test('Auth28 exact SourceV2 optional Native operand stays unchanged at canonical paths without supplying dirfd',()=>{
 const result=relocateDesktopRuntimeSource(name,sample,version);assert(result.bytes.equals(sample));assert.deepEqual(result.operands,[{kind:'url',from:operand,to:operand,count:1}]);assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname('code/'+name),operand)),'code/apps/wallet-desktop/native/original-source-current-dirfd.node');
});
test('SourceV2 operand is not a generic URL bypass, an older profile or an automatic Auth29 admission',()=>{
 for(const sdk of ['1.3.0-pq.3.32-auth.26','1.3.0-pq.3.32-auth.29'])assert.throws(()=>relocateDesktopRuntimeSource(name,sample,sdk),/Unlisted repository operand/);
 for(const bytes of [Buffer.concat([sample,sample]),Buffer.from(sample.toString().replace('original-source-current-dirfd.node','foreign.node')),Buffer.concat([sample,Buffer.from("const other=new URL('../../../apps/wallet-desktop/native/foreign.node',import.meta.url);\n")])])assert.throws(()=>relocateDesktopRuntimeSource(name,bytes,version));
});
test('real ASAR readback retains the exact allowed SourceV2 bytes and no pretend optional Native asset',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-sourcev2-asar-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const stage=path.join(root,'raw'),archive=path.join(root,'app.asar'),destination=path.join(stage,'code',name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,sample);
 const pkg=fileURLToPath(new URL('../package.json',import.meta.url)),script=`import{createRequire}from'node:module';const a=createRequire(${JSON.stringify(pkg)})('@electron/asar');await a.createPackage(${JSON.stringify(stage)},${JSON.stringify(archive)});`;
 execFileSync(process.execPath,['--input-type=module','-e',script],{stdio:'pipe'});const asar=createRequire(pkg)('@electron/asar'),bytes=asar.extractFile(archive,'code/'+name);assert(bytes.equals(relocateDesktopRuntimeSource(name,sample,version).bytes));assert.equal(asar.listPackage(archive).some(p=>p.endsWith('original-source-current-dirfd.node')),false);
});
test('normal unavailable-asset guard uses the selected rule plan and rejects a hypothetical dirfd binary',()=>{
 const raw=fs.readFileSync(new URL('../scripts/release-provenance.mjs',import.meta.url),'utf8'),start=raw.indexOf('  const unavailableOptionalRuntimeAssets='),end=raw.indexOf('  if(!isDeepStrictEqual(desktopAsarHeaderIntegrity',start),code=raw.slice(start,end)+'\nthis.result=unavailableOptionalRuntimeAssets;';assert(start>=0&&end>start);
 const row={sourcePath:name,unavailableNativeAsset:'code/apps/wallet-desktop/native/original-source-current-dirfd.node'},context={plan:[row],receipt:{after:[]}};runInNewContext(code,context);assert.equal(context.result[0].capability,'NOT_SUPPLIED');assert.equal(context.result[0].packaged,false);
 assert.throws(()=>runInNewContext(code,{plan:[row],receipt:{after:[{path:row.unavailableNativeAsset}]}}),/Unreviewed optional source-current Native module/);
});
test('actual selected Auth28 Wallet plus SDK runtime closure has no further unlisted repository operands',{skip:!target},()=>{
 const git=(...args)=>execFileSync('git',args,{cwd:target,encoding:'utf8',maxBuffer:16<<20}).trim(),commit=git('rev-parse','HEAD'),sdk=JSON.parse(git('show',commit+':packages/wallet-auth/package.json'));assert.equal(sdk.version,version);
 const names=[...new Set([...git('ls-tree','-r','--name-only',commit,'--','apps/wallet-desktop/src','packages/wallet-auth/src').split('\n'),...declaredSDKRuntimeSources(target,commit)].filter(n=>/\.(?:js|mjs|cjs|json)$/.test(n)&&!n.endsWith('.test.mjs')))];assert(names.includes(name));
 const packed=execFileSync('git',['cat-file','--batch'],{cwd:target,input:names.map(n=>commit+':'+n+'\n').join(''),maxBuffer:64<<20});let at=0,checked=0;
 for(const sourcePath of names){const end=packed.indexOf(10,at),header=packed.subarray(at,end).toString(),match=/^[a-f0-9]{40} blob ([0-9]+)$/.exec(header);assert(match,sourcePath);const length=Number(match[1]),body=packed.subarray(end+1,end+1+length);assert.equal(body.length,length);at=end+1+length+1;if(sourcePath===name){assert.equal(body.length,31049);assert.equal(createHash('sha256').update(body).digest('hex'),'926d639611753d8e1d3baa59daee8844e449567dbd89301a30d25e264d502068');}assert(relocateDesktopRuntimeSource(sourcePath,body,version).bytes.equals(body),sourcePath);checked++;}
 assert.equal(at,packed.length);assert(checked>200);console.log('AUTH28_ACTUAL_RUNTIME_OPERANDS',JSON.stringify({commit,checked,NativeExecuted:false,SourceAdmitted:false}));
});
