import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {checkArchiveDeployment,inspectArchiveDeployment} from './combined-archive-deployment.mjs';

test('macOS 13 deployment gate reads every original archive object and rejects unknown metadata',()=>{
  const base=process.env.YNX_LINK_DEPLOYMENT_TEST_ARTIFACTS??path.join(os.tmpdir(),'ynx-deployment-evidence');
  fs.mkdirSync(base,{recursive:true});
  const output=fs.mkdtempSync(path.join(base,'review-'));
  const rows=[],commands=[];
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const pin=file=>{const raw=fs.readFileSync(file);return{path:file,bytes:raw.length,sha256:sha(raw)};};
  const options={target:'13.0',architecture:'arm64'};
  function run(tool,args){
    const result=spawnSync(tool,args,{encoding:'utf8',timeout:30000});
    const prefix=path.join(output,String(commands.length).padStart(2,'0'));
    fs.writeFileSync(prefix+'.stdout',result.stdout??'',{flag:'wx'});
    fs.writeFileSync(prefix+'.stderr',result.stderr??'',{flag:'wx'});
    commands.push({tool,args,exit:result.status,signal:result.signal});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
    return result.stdout;
  }
  function control(name,fn){fn();rows.push({name,passed:true});}
  const source=path.join(output,'fixture.c');
  fs.writeFileSync(source,'int public_deployment_fixture(void) { return 13; }\n',{flag:'wx'});
  function compile(name,target){
    const file=path.join(output,name+'.o');
    run('clang',['-target',target,'-c',source,'-o',file]);return file;
  }
  function archive(name,objects){
    const file=path.join(output,name+'.a');run('/usr/bin/ar',['rcs',file,...objects]);return pin(file);
  }
  // Negative malformed/opaque fixtures are new ar containers around untouched
  // copied bytes. No Mach-O header/load-command field is edited or patched.
  function rawArchive(name,member,payload){
    const field=(value,width)=>String(value).padEnd(width,' ');
    const header=field(member+'/',16)+field(0,12)+field(0,6)+field(0,6)+field('100644',8)+field(payload.length,10)+'`\n';
    const file=path.join(output,name+'.a');
    fs.writeFileSync(file,Buffer.concat([Buffer.from('!<arch>\n'+header),payload,...(payload.length%2?[Buffer.from('\n')]:[])]),{flag:'wx'});
    return pin(file);
  }
  const minimum13=compile('minimum13','arm64-apple-macos13.0');
  const minimum12=compile('minimum12','arm64-apple-macos12.0');
  const minimum14=compile('minimum14','arm64-apple-macos14.0');
  const minimum131=compile('minimum131','arm64-apple-macos13.1');
  const x86=compile('x86','x86_64-apple-macos13.0');
  const legacy=compile('legacy','x86_64-apple-macos10.13');
  const ios=compile('ios','arm64-apple-ios15.0');
  const assembly=path.join(output,'no-target.s'),untargeted=path.join(output,'no-target.o');
  fs.writeFileSync(assembly,'.text\n.globl _public_untargeted\n_public_untargeted:\nret\n',{flag:'wx'});
  run('clang',['-cc1as','-triple','arm64-apple-darwin','-filetype','obj','-o',untargeted,assembly]);
  const originalPins=[minimum13,minimum12,minimum14,minimum131,x86,legacy,ios,untargeted].map(pin);
  const good=archive('good',[minimum13]);
  try {
    control('actual-LC_BUILD_VERSION-13.0',()=>{
      const report=checkArchiveDeployment(good,options);
      assert.equal(report.objectCount,1);assert.equal(report.verifiedObjects,1);assert.equal(report.archiveUnchanged,true);
      assert.equal(report.members.find(row=>row.kind==='object').deploymentCommands[0].command,'LC_BUILD_VERSION');
      assert.equal(report.maximumObservedMinimum,'13.0.0');assert.equal(report.structuralSymbolGateVerified,false);
    });
    control('lower-than-13-is-compatible',()=>assert.equal(checkArchiveDeployment(archive('lower',[minimum12]),options).maximumObservedMinimum,'12.0.0'));
    control('every-object-and-above-13',()=>{
      const report=inspectArchiveDeployment(archive('mixed',[minimum13,minimum14]),options);
      assert.equal(report.objectCount,2);assert.equal(report.verifiedObjects,1);assert.equal(report.rejectedObjects,1);
      assert.equal(report.unverifiableObjects,0);assert.equal(report.maximumObservedMinimum,'14.0.0');
      assert.equal(report.members.find(row=>row.name==='minimum14.o').reasons[0],'MINIMUM_OS_ABOVE_13_0');
    });
    control('13.1-also-exceeds-13.0',()=>assert.throws(()=>checkArchiveDeployment(archive('minor',[minimum131]),options),error=>{
      assert.equal(error.report.maximumObservedMinimum,'13.1.0');return /ABOVE_13/.test(error.message);
    }));
    control('unexpected-architecture',()=>assert.throws(()=>checkArchiveDeployment(archive('wrong-arch',[x86]),options),/UNEXPECTED_ARCHITECTURE/));
    control('actual-legacy-LC_VERSION_MIN_MACOSX',()=>{
      const report=checkArchiveDeployment(archive('legacy',[legacy]),{target:'13.0',architecture:'x86_64'});
      assert.equal(report.members.find(row=>row.kind==='object').deploymentCommands[0].command,'LC_VERSION_MIN_MACOSX');
      assert.equal(report.maximumObservedMinimum,'10.13.0');
    });
    control('non-macOS-platform',()=>{
      const report=inspectArchiveDeployment(archive('ios',[ios]),options);
      assert.ok(report.members.find(row=>row.kind==='object').reasons.includes('NON_MACOS_PLATFORM'));
      assert.equal(report.unverifiableObjects,1);assert.equal(report.status,'ARCHIVE_DEPLOYMENT_TARGET_REJECTED');
    });
    control('target-load-command-missing',()=>{
      const report=inspectArchiveDeployment(archive('untargeted',[untargeted]),options);
      assert.equal(report.unverifiableObjects,1);
      assert.ok(report.members.find(row=>row.kind==='object').reasons.includes('DEPLOYMENT_COMMAND_MISSING'));
    });
    control('unknown-member-is-not-zero-or-skipped',()=>{
      const report=inspectArchiveDeployment(rawArchive('unknown','opaque.bin',Buffer.from('PUBLIC opaque member')),options);
      assert.equal(report.objectCount,1);assert.equal(report.unverifiableObjects,1);
      assert.equal(report.members[0].reasons[0],'NON_MACH_O_MEMBER');
    });
    control('truncated-copy-of-original-object',()=>{
      const report=inspectArchiveDeployment(rawArchive('truncated','truncated.o',fs.readFileSync(minimum13).subarray(0,40)),options);
      assert.equal(report.unverifiableObjects,1);assert.equal(report.members[0].reasons[0],'LOAD_COMMAND_REGION_OUT_OF_BOUNDS');
    });
    control('explicit-target-required',()=>assert.throws(()=>checkArchiveDeployment(good,{architecture:'arm64'}),error=>
      error.report.firstCause==='EXPLICIT_MACOS_13_0_AND_ARCHITECTURE_REQUIRED'));
    control('identity-pin-required',()=>assert.throws(()=>checkArchiveDeployment({...good,sha256:'0'.repeat(64)},options),error=>
      error.report.firstCause==='ARCHIVE_IDENTITY_MISMATCH'));
    control('archive-header-bounds',()=>{
      const file=path.join(output,'bad-header.a');fs.writeFileSync(file,'!<arch>\nshort',{flag:'wx'});
      const report=inspectArchiveDeployment(pin(file),options);
      assert.equal(report.status,'ARCHIVE_DEPLOYMENT_TARGET_REJECTED');
      assert.equal(report.unparsedTail.offset,8);assert.ok(report.archiveErrors.includes('AR_TRUNCATED_OR_EXCESSIVE_HEADERS'));
    });
    control('symlink-input-refused',()=>{
      const file=path.join(output,'alias.a');fs.symlinkSync(good.path,file);
      assert.throws(()=>checkArchiveDeployment({...good,path:file},options),error=>error.report.firstCause==='REGULAR_ARCHIVE_FILE_REQUIRED');
    });
    control('all-original-object-bytes-unchanged',()=>{
      for(const input of originalPins)assert.deepEqual(pin(input.path),input);
    });
  } finally {
    fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify({controls:rows,commands,originalObjectPins:originalPins,
      actualCompilerObjects:true,noObjectFieldsPatched:true,GoRebuilt:false,strongSymbolSuiteRerun:false,
      RootAdmission:false,SourceAdmission:false,executedOnMacOS13:false},null,2)+'\n',{flag:'wx'});
    console.log('Retained new deployment controls: '+output);
  }
  assert.equal(rows.length,15);
});
