import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkCombinedArchive,linkRequiredSymbols} from './combined-archive-symbols.mjs';

// Structural compiler/nm fixtures ONLY. These stub symbols do not implement a
// Go runtime, Core cryptography, Auth Source or a normal Native common image.
test('combined archive gate checks actual Mach-O strength, one-runtime layout and complete header mapping',()=>{
  const artifacts=process.env.YNX_LINK_COMBINED_SYMBOL_TEST_ARTIFACTS??path.join(os.tmpdir(),'ynx-combined-symbol-evidence');
  fs.mkdirSync(artifacts,{recursive:true});
  const output=fs.mkdtempSync(path.join(artifacts,'symbol-controls-'));
  const rows=[],commands=[];
  const pin=file=>{const raw=fs.readFileSync(file);return{path:file,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};};
  const put=(name,text)=>{const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text,{flag:'wx'});return file;};
  function run(tool,args){
    const result=spawnSync(tool,args,{encoding:'utf8',timeout:30000});
    const prefix=path.join(output,String(commands.length).padStart(2,'0'));
    fs.writeFileSync(prefix+'.stdout',result.stdout??'',{flag:'wx'});fs.writeFileSync(prefix+'.stderr',result.stderr??'',{flag:'wx'});
    commands.push({tool,args,exit:result.status,signal:result.signal});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  }
  function control(name,fn){fn();rows.push({name,passed:true});}
  const core=['YNXAccountInitialSignV1','YNXTransactionBatchSignV1'];
  const all=[...core,...linkRequiredSymbols];
  const coreSource=pin(put('original-core.go',core.map(name=>'//export '+name).join('\n')+'\n'));
  const headers=core.map((name,index)=>{
    const file=put(index?'tx_batch.h':'account_initial.h',
      '// A comment is not an export: int32_t YNXCommentOnly(void);\n'
      +'typedef int32_t (*YNXFunctionPointer)(void);\n'
      +'#define YNX_MACRO(a) (a)\n'
      +'static inline int32_t YNXPrivateInline(void){return 0;}\n'
      +'int32_t '+name+'(void *request, void *result);\n');
    return{owner:'core',name:path.basename(file),...pin(file)};
  });
  const caller=path.resolve(import.meta.dirname,'../ynx-secure-link-caller');
  for(const name of ['private_client_v1.h','private_client_startup_v1.h'])headers.push({owner:'link',name,...pin(path.join(caller,name))});
  const nativeUndefined=pin(put('actual-native-undefined.txt',
    all.slice(0,3).map(name=>'_'+name).join('\n')+'\n_YNXIDEIdentityHelperService\n'));
  const architecture=process.arch==='arm64'?'arm64':'amd64';
  function archive(name,{weak='',missing='',duplicate='',secondRuntime=false,nested=false}={}){
    const dir=path.join(output,name);fs.mkdirSync(dir);
    const source=path.join(dir,'fixture.cpp');
    const symbols=all.filter(value=>value!==missing);
    const runtime=['crosscall2','_cgo_topofstack','_rt0_'+architecture+'_darwin_lib'];
    fs.writeFileSync(source,[...symbols,...runtime].map(symbol=>'extern "C" '+(symbol===weak?'__attribute__((weak)) ':'')+'void '+symbol+'() {}').join('\n')+'\n',{flag:'wx'});
    const go=path.join(dir,'go.o');run('/usr/bin/clang++',['-c',source,'-o',go]);
    const members=[go];
    // Ordinary undefined references in another member must resolve against the
    // one strong original definition, not be mistaken for final-image debt.
    const ref=path.join(dir,'reference.cpp'),refObject=path.join(dir,'reference.o');
    fs.writeFileSync(ref,'extern "C" void '+core[0]+'();\nvoid originalReference(){'+core[0]+'();}\n',{flag:'wx'});
    run('/usr/bin/clang++',['-c',ref,'-o',refObject]);members.push(refObject);
    if(duplicate||secondRuntime){
      const extra=path.join(dir,'extra.cpp'),extraObject=path.join(dir,'extra.o');
      fs.writeFileSync(extra,(secondRuntime?runtime:[duplicate]).map(symbol=>'extern "C" void '+symbol+'() {}').join('\n')+'\n',{flag:'wx'});
      run('/usr/bin/clang++',['-c',extra,'-o',extraObject]);members.push(extraObject);
    }
    const file=path.join(dir,'combined.a');run('/usr/bin/ar',['rcs',file,...members]);
    if(nested){
      // Darwin ar expands an input archive, rather than storing that .a as a
      // member. Append a valid raw ar member to exercise actual nested input;
      // preserve the first fixture failure which exposed this tool behavior.
      const payload=fs.readFileSync(file);
      const field=(value,width)=>String(value).padEnd(width,' ');
      const header=field('old-runtime.a/',16)+field(0,12)+field(0,6)+field(0,6)+field('100644',8)+field(payload.length,10)+'`\n';
      fs.appendFileSync(file,Buffer.concat([Buffer.from(header),payload,...(payload.length%2?[Buffer.from('\n')]:[])]));
    }
    return pin(file);
  }
  const original=archive('strong');
  const plan={version:1,goArchives:[original],linkerInputs:[original],coreSources:[coreSource],headers,nativeUndefined:[nativeUndefined]};
  try {
    control('strong-public-fixture-and-cross-member-U',()=>{
      const result=checkCombinedArchive(plan);
      assert.equal(result.status,'COMBINED_GO_ARCHIVE_STRONG_SYMBOLS_VERIFIED');
      assert.equal(result.coreExports.length,2);assert.equal(result.linkExports.length,22);
      assert.ok(result.symbols.find(row=>row.symbol===core[0]).undefinedReferences>=1);
      assert.deepEqual(result.nativeOtherOwnedReferences,['YNXIDEIdentityHelperService']);
      assert.equal(result.finalNativeImageVerified,false);
    });
    control('two-declared-Go-archives',()=>assert.throws(()=>checkCombinedArchive({...plan,goArchives:[original,original]}),/exactly one/));
    control('second-linker-archive',()=>{
      const second=archive('second');
      assert.throws(()=>checkCombinedArchive({...plan,linkerInputs:[original,second]}),/second\/unidentified archive/);
    });
    control('Mach-O-T-but-weak-attribute',()=>{
      const weak=archive('weak',{weak:linkRequiredSymbols[0]});
      assert.throws(()=>checkCombinedArchive({...plan,goArchives:[weak],linkerInputs:[weak]}),/weak/);
    });
    control('missing-original-transaction-callee',()=>{
      const missing=archive('missing',{missing:core[1]});
      assert.throws(()=>checkCombinedArchive({...plan,goArchives:[missing],linkerInputs:[missing]}),/YNXTransactionBatchSignV1/);
    });
    control('duplicate-strong-original-callee',()=>{
      const duplicate=archive('duplicate',{duplicate:core[1]});
      assert.throws(()=>checkCombinedArchive({...plan,goArchives:[duplicate],linkerInputs:[duplicate]}),/duplicate/);
    });
    control('two-Go-runtimes-renamed-members',()=>{
      const duplicate=archive('runtime',{secondRuntime:true});
      assert.throws(()=>checkCombinedArchive({...plan,goArchives:[duplicate],linkerInputs:[duplicate]}),/crosscall2|runtime entry/);
    });
    control('nested-archive',()=>{
      const nested=archive('nested',{nested:true});
      assert.throws(()=>checkCombinedArchive({...plan,goArchives:[nested],linkerInputs:[nested]}),/nested\/second/);
    });
    for(const name of ['tx_batch.h','account_initial.h'])control('mandatory-'+name,()=>
      assert.throws(()=>checkCombinedArchive({...plan,headers:headers.filter(row=>row.name!==name)}),/mandatory Core header/));
    control('header-original-export-mapping',()=>{
      const changed=pin(put('unmapped.go','//export YNXAccountInitialSignV1\n//export YNXOriginalMissingFromHeader\n'));
      assert.throws(()=>checkCombinedArchive({...plan,coreSources:[changed]}),/no original header/);
    });
    control('header-content-pin',()=>assert.throws(()=>checkCombinedArchive({...plan,headers:[{...headers[0],sha256:'0'.repeat(64)},...headers.slice(1)]}),/input changed/));
    control('header-symlink',()=>{
      const dir=path.join(output,'alias');fs.mkdirSync(dir);const file=path.join(dir,headers[0].name);fs.symlinkSync(headers[0].path,file);
      assert.throws(()=>checkCombinedArchive({...plan,headers:[{...headers[0],path:file},...headers.slice(1)]}),/regular input/);
    });
    control('unmapped-actual-Native-LINK-reference',()=>{
      const log=pin(put('unknown-link.txt','_ynx_link_not_an_original_callee\n'));
      assert.throws(()=>checkCombinedArchive({...plan,nativeUndefined:[log]}),/has no ABI header/);
    });
  } finally {
    fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify({controls:rows,commands,fixtureDirectory:output,structuralFixturesOnly:true,actualCompilerAndNm:true,actualGoRuntime:false,actualCoreImplementation:false,RootAdmission:false,SourceAdmission:false,finalNativeImageVerified:false},null,2)+'\n',{flag:'wx'});
    console.log('Retained combined-symbol controls: '+output);
  }
  assert.equal(rows.length,14);
});
