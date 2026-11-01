#!/usr/bin/env node
// Compile/run only this narrow functional probe. The parent owns production
// combined-main generation and archive builds. No archive merging, fallback
// runtime, signing/key generation, Root installer or production endpoint here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, mkdir, readFile, writeFile, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const selectedNames = ['member.bin','message.bin','network.bin','owner.txt','purpose.txt','pk-a.bin','pk-b.bin','bad-sig-a.bin'];
const maximums = new Map([['member.bin',98304],['message.bin',65536],['network.bin',32],['owner.txt',128],['purpose.txt',64],['pk-a.bin',2592],['pk-b.bin',64],['bad-sig-a.bin',98304]]);
const sha = data => createHash('sha256').update(data).digest('hex');
function parseArgs() {
  const args = process.argv.slice(2); const out = {};
  for (let i=0;i<args.length;i+=2) {
    assert(['--inputs','--inputs-sha256','--out'].includes(args[i]) && args[i+1] && out[args[i]]===undefined,'exact probe arguments');
    out[args[i]]=args[i+1];
  }
  for (const name of ['--inputs','--inputs-sha256','--out']) assert(out[name],`required ${name}; absent inputs never Skip/PASS`);
  assert(/^[0-9a-f]{64}$/.test(out['--inputs-sha256']));
  return out;
}
async function pinned(record, maximum) {
  assert(record && path.isAbsolute(record.path) && Number.isSafeInteger(record.bytes) && record.bytes>0 && record.bytes<=maximum && /^[0-9a-f]{64}$/.test(record.sha256),'bounded pinned input record');
  const handle=await open(record.path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
  try {
    const before=await handle.stat(); assert(before.isFile() && before.size===record.bytes,'pinned input file/length');
    const data=await handle.readFile(); const after=await handle.stat();
    assert(before.dev===after.dev && before.ino===after.ino && before.size===after.size && before.mtimeMs===after.mtimeMs && sha(data)===record.sha256,'pinned input changed');
    return data;
  } finally { await handle.close(); }
}
function flags(values) {
  assert(Array.isArray(values) && values.length<=40,'bounded native link flags');
  for (let i=0;i<values.length;i++) {
    const value=values[i]; assert(typeof value==='string' && !value.includes('\0'));
    if (value==='-framework') { assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(values[++i]),'framework name'); continue; }
    assert(['-lssl','-lcrypto','-lobjc','-lresolv','-lpthread','-lc++','-lbsm'].includes(value) || value.startsWith('-L') && path.isAbsolute(value.slice(2)), 'only native system libraries; no second Go archive/shared runtime');
  }
  return values;
}

async function main() {
  const args=parseArgs(); const manifestBytes=await readFile(args['--inputs']);
  assert(manifestBytes.length<=1<<20 && sha(manifestBytes)===args['--inputs-sha256'],'probe manifest SHA');
  const input=JSON.parse(manifestBytes); assert(input.version===1);
  // Exactly one independently built combined archive; native inputs are .o
  // only. Two .a files, a Go dylib, or a remote runtime cannot be hidden here.
  assert(input.archive?.path.endsWith('.a') && !input.archives && !input.goArchives,'one combined archive');
  await pinned(input.archive,512<<20);
  assert(Array.isArray(input.nativeObjects) && input.nativeObjects.length>0 && input.nativeObjects.length<=128,'actual native closure objects required');
  for (const object of input.nativeObjects) { assert(object.path.endsWith('.o'),'native inputs must be objects, never another Go runtime'); await pinned(object,128<<20); }
  assert(Array.isArray(input.headers) && input.headers.length>0 && input.headers.length<=256);
  for (const header of input.headers) await pinned(header,1<<20);
  const headerNames=new Set(input.headers.map(h=>path.basename(h.path)));
  for (const required of ['registered_n1_verify.h','private_client_v1.h','private_client_startup_v1.h']) assert(headerNames.has(required),`actual header ${required}`);
  assert(Array.isArray(input.includeDirs) && input.includeDirs.length<=32);
  for (const directory of input.includeDirs) assert(path.isAbsolute(directory) && (await stat(directory)).isDirectory(),'native include directory');
  assert(typeof input.rootProbe==='boolean');
  if (input.rootProbe) assert(headerNames.has('pay_root_main_code_private.hpp'),'real Native Root header required; NULL is not empty Root releases');
  assert(/^libnode\.\d+\.dylib$/.test(path.basename(input.nodeLibrary?.path??'')),'official C-native Node library required, not a second Go runtime');
  await pinned(input.nodeLibrary,256<<20);
  const nodeSymbols=spawnSync('nm',['-gU',input.nodeLibrary.path],{encoding:'utf8',timeout:30000,maxBuffer:64<<20});
  assert(!nodeSymbols.error&&nodeSymbols.status===0,'Node library symbol read');
  assert(!nodeSymbols.stdout.split('\n').some(line=>/\b_?(runtime\.|crosscall2\b|_cgoexp_|_rt0_)/.test(line)),'Node library contains a Go runtime marker');
  const nativeLibraries=input.nativeLibraries??[];
  assert(Array.isArray(nativeLibraries)&&nativeLibraries.length<=2);
  for (const library of nativeLibraries) {
    assert(/^libuv\.\d+(\.\d+)*\.dylib$/.test(path.basename(library.path)),'only the actual C-native libuv dependency');
    await pinned(library,32<<20);
    const symbols=spawnSync('nm',['-gU',library.path],{encoding:'utf8',timeout:30000,maxBuffer:4<<20});
    assert(!symbols.error&&symbols.status===0&&!symbols.stdout.split('\n').some(line=>/\b_?(runtime\.|crosscall2\b|_cgoexp_|_rt0_)/.test(line)),'libuv native symbol identity');
  }
  const binding=input.binding;
  for (const name of ['policyRevision','observedHeight','activeFrom']) assert(typeof binding?.[name]==='string' && /^(0|[1-9][0-9]{0,19})$/.test(binding[name]) && BigInt(binding[name])<=0xffffffffffffffffn,`exact PUBLIC scalar ${name}`);

  const publicManifest=await pinned(input.publicFixtureManifest,1<<20);
  const publicRows=JSON.parse(publicManifest); assert(Array.isArray(publicRows),'Core original PUBLIC-INPUTS manifest');
  const selected=[];
  for (const name of selectedNames) {
    const rows=publicRows.filter(r=>r.name===name); assert(rows.length===1,`one original public fixture ${name}`);
    const row={...rows[0],path:path.join(path.dirname(input.publicFixtureManifest.path),name)};
    const data=await pinned(row,maximums.get(name));selected.push({row,data});
  }
  assert(!(await lstat(args['--out']).catch(e=>{if(e.code==='ENOENT')return null;throw e;})),'new external output directory required');
  await mkdir(args['--out'],{mode:0o700}); const out=path.resolve(args['--out']);
  const publicDirectory=path.join(out,'public');await mkdir(publicDirectory,{mode:0o700});
  for (const {row,data} of selected) await writeFile(path.join(publicDirectory,row.name),data,{flag:'wx',mode:0o600});
  await writeFile(path.join(out,'INPUTS.json'),manifestBytes,{flag:'wx',mode:0o600});
  const executable=path.join(out,'combined-functional'); const source=path.join(here,'combined-archive-functional.cpp');
  const probeObject=path.join(out,'combined-functional.o');
  // Strict executable link: the official C++ Node library satisfies NAPI for
  // the COMPLETE original Native object set, including its normal entry TU.
  // There is no dynamic_lookup, omitted PQ.o, symbol stub, or second Go image.
  const command=['-std=c++17','-Wall','-Wextra','-Werror',...(input.rootProbe?['-DYNX_COMBINED_FUNCTIONAL_ROOT_PROBE=1']:[]),...input.includeDirs.flatMap(p=>['-I',p]),'-c',source,'-o',probeObject];
  const linkArgs=[probeObject,input.archive.path,...input.nativeObjects.map(o=>o.path),input.nodeLibrary.path,...nativeLibraries.map(l=>l.path),...flags(input.linkFlags),'-lc++','-o',executable];
  await writeFile(path.join(out,'compile-command.json'),JSON.stringify({compile:{command:'clang++',args:command},link:{command:'swiftc',args:linkArgs}},null,2)+'\n',{flag:'wx',mode:0o600});
  const built=spawnSync('clang++',command,{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
  await writeFile(path.join(out,'compile.stdout'),built.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'compile.stderr'),built.stderr??'',{flag:'wx',mode:0o600});
  await writeFile(path.join(out,'node-library-symbol-check.json'),JSON.stringify({library:input.nodeLibrary,nmExit:nodeSymbols.status,GoRuntimeMarkers:[]},null,2)+'\n',{flag:'wx',mode:0o600});
  assert(!built.error && built.status===0,`combined functional C++ compile failed: ${built.error?.message??built.status}`);
  const linked=spawnSync('swiftc',linkArgs,{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
  await writeFile(path.join(out,'link.stdout'),linked.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'link.stderr'),linked.stderr??'',{flag:'wx',mode:0o600});
  assert(!linked.error&&linked.status===0,`actual single-runtime strict Swift link failed: ${linked.error?.message??linked.status}`);
  const executed=spawnSync(executable,[publicDirectory,binding.policyRevision,binding.observedHeight,binding.activeFrom],{encoding:'utf8',timeout:30000,maxBuffer:1<<20});
  await writeFile(path.join(out,'run.stdout'),executed.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'run.stderr'),executed.stderr??'',{flag:'wx',mode:0o600});
  assert(!executed.error && executed.status===0,`actual combined functional failed: ${executed.error?.message??executed.status}`);
  const result=JSON.parse(executed.stdout.trim());
  for (const name of ['coreValidN1','coreCorruptRejected','linkNullRefused','linkForeignPartialDrained']) assert.equal(result[name],true);
  assert.equal(result.RootAdmission,false);assert.equal(result.SourceAdmission,false);
  if (input.rootProbe) assert.equal(result.rootEmptyReleasesRefused,true);else assert.equal(result.rootScope,'NOT_RUN_NOT_LINKED');
  const report={schema:'YNX_COMBINED_ARCHIVE_FUNCTIONAL/v1',archive:input.archive,nodeLibrary:input.nodeLibrary,nativeLibraries,probeSource:{bytes:(await stat(source)).size,sha256:sha(await readFile(source))},functions:['YNXRegisteredANDMemberVerifyN1V1','ynx_link_pay_native_startup_open_v1',...(input.rootProbe?['acquire_original_pay_main_code_root']:[])],publicFixtureSHA256:input.publicFixtureManifest.sha256,publicFixtureProvenance:'localSynthetic publicprobe; official per-file binding NOT_SUPPLIED',singleGoArchive:true,strictLink:true,dynamicLookup:false,compileExit:built.status,linkExit:linked.status,runExit:executed.status,result,RootAdmission:false,SourceAdmission:false,deployed:false};
  await writeFile(path.join(out,'RESULT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({out,result}));
}
main().catch(error=>{console.error(error.stack??String(error));process.exitCode=1;});
