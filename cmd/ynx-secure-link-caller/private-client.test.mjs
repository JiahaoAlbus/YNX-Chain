// New private native client ABI only. No existing caller/TLS suite is run.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const directory=path.join(root,'cmd/ynx-secure-link-caller');
const artifacts='/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/shared/LINK/native-private-client-next';
let buildRoot,sequence=0;
before(async()=>{await mkdir(artifacts,{recursive:true});buildRoot=await mkdtemp(path.join(artifacts,'private-client-'));});
after(()=>{/* Retain exact compiler logs, native binary and PUBLIC evidence. */});
async function run(name,command,args,{input,timeout=30000,env={}}={}){
  const result=spawnSync(command,args,{cwd:root,input,encoding:'utf8',timeout,env:{...process.env,...env}});
  const prefix=path.join(buildRoot,String(++sequence).padStart(2,'0')+'-'+name);
  await writeFile(prefix+'.stdout',result.stdout??'',{flag:'wx'});
  await writeFile(prefix+'.stderr',result.stderr??'',{flag:'wx'});
  await writeFile(prefix+'.json',JSON.stringify({command,args,status:result.status,signal:result.signal,error:result.error?.code??null},null,2)+'\n',{flag:'wx'});
  assert.equal(result.error,undefined,`${name} native process error: ${result.error?.message}`);
  assert.equal(result.status,0,`${name} first cause:\n${result.stderr}\n${result.stdout}`);
  return result;
}

test('private registered client header compiles as strict C11 and C++17 without a business adapter',async()=>{
  const source='#include "private_client_v1.h"\nint main(void){ynx_link_private_client_source_fence_v1 f={0};ynx_link_private_client_packet_v1 p={0};return f.ctx!=0||p.packet_present!=0;}\n';
  await run('C11-header','clang',['-x','c','-std=c11','-Wall','-Wextra','-Werror','-pedantic','-I',directory,'-fsyntax-only','-'],{input:source});
  await run('CXX17-fixture','clang++',['-std=c++17','-Wall','-Wextra','-Werror','-pedantic','-fsyntax-only',path.join(directory,'private-client.integration.cpp')]);
});

let nativeBuild;
function prepareNative(){return nativeBuild??=(async()=>{
  let library=path.join(buildRoot,process.platform==='darwin'?'libynx_private_fixture.dylib':'libynx_private_fixture.so');
  if(process.env.YNX_LINK_PRIVATE_CLIENT_FIXTURE_LIBRARY){
    // Test-only supplied matching artifact; never a production registration or
    // native Source setter. Require its exact owner-provided content pin.
    library=await realpath(process.env.YNX_LINK_PRIVATE_CLIENT_FIXTURE_LIBRARY);
    const supplied=await readFile(library),sha=createHash('sha256').update(supplied).digest('hex');
    assert.equal(sha,process.env.YNX_LINK_PRIVATE_CLIENT_FIXTURE_SHA256,'supplied fixture library pin mismatch');
    await writeFile(path.join(buildRoot,'SUPPLIED_LIBRARY.json'),JSON.stringify({path:library,bytes:supplied.length,sha256:sha},null,2)+'\n',{flag:'wx'});
  }else{
    await run('Go-c-shared','go',['build','-mod=readonly','-p','1','-tags=securelink_private_client_fixture','-buildmode=c-shared','-o',library,'./cmd/ynx-secure-link-private-client-fixture'],{timeout:60000,env:{CGO_ENABLED:'1',GOMAXPROCS:'2'}});
  }
  const executable=path.join(buildRoot,'private-client-integration');
  await run('CXX-link','clang++',['-std=c++17','-Wall','-Wextra','-Werror','-pedantic',path.join(directory,'private-client.integration.cpp'),library,'-Wl,-rpath,'+buildRoot,'-o',executable]);
  // Go's c-shared install-name can be a bare basename. Resolve only this
  // already content-pinned fixture directory for this owned child process;
  // never alter/re-sign the supplied library or install it system-wide.
  const loader=process.platform==='darwin'?{DYLD_LIBRARY_PATH:path.dirname(library)}:{LD_LIBRARY_PATH:path.dirname(library)};
  return {library,executable,loader};
})();}
async function qualification(file,library,rows){
  const inputs=[];
  for(const name of ['private_client_v1.h','private-client.integration.cpp','private-client.test.mjs']){
    const raw=await readFile(path.join(directory,name));inputs.push({file:name,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
  }
  const binary=await readFile(library);
  await writeFile(path.join(buildRoot,file),JSON.stringify({inputs,library:{path:library,bytes:binary.length,sha256:createHash('sha256').update(binary).digest('hex')},controls:rows,SourceAdmission:false,RootAdmission:false,actualAuthNativeSource:false,realFunds:false,deployed:false},null,2)+'\n',{flag:'wx'});
}
test('actual C++ native Source fence reaches the original Go private client and preserves owned packets and cleanup debt',async t=>{
  const {library,executable,loader}=await prepareNative();
  const result=await run('actual-native-transport',executable,[],{timeout:20000,env:loader});
  const rows=result.stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.deepEqual(rows.filter(row=>row.control).map(row=>row.control),[
    'five-actual-operations','query-get-source-refusals','packet-and-late-error','capture-error-partial-native-borrow','close-debt-retains-original-source','actual-registration-borrow-retains-parent',
  ]);
  assert.ok(rows.filter(row=>row.control).every(row=>row.passed===true));
  const debt=rows.find(row=>row.control==='close-debt-retains-original-source');assert.equal(debt.earlyDraining,true);assert.equal(debt.retainedUntilActualClose,true);assert.equal(debt.finalBorrowCount,0);assert.equal(debt.nativeReleaseCount,1);
  assert.equal(rows.find(row=>row.control==='actual-registration-borrow-retains-parent').parentCloseRefusedUntilBorrowRelease,true);
  const boundary=rows.at(-1);assert.equal(boundary.transportOnly,true);assert.equal(boundary.businessSourceQualified,false);assert.equal(boundary.RootAdmission,false);assert.equal(boundary.fixtureDrained,true);assert.equal(boundary.earlyDrainingCauseRetained,true);
  await qualification('QUALIFICATION.json',library,rows);
  t.diagnostic('Retained exact native artifacts and first-cause logs: '+buildRoot);
});

test('fixed private subset registration denies absent intent slots without fabricating a target',async t=>{
  const {library,executable,loader}=await prepareNative();
  const result=await run('actual-subset-registration',executable,['--subset'],{timeout:20000,env:loader});
  const rows=result.stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.equal(rows.length,1);assert.equal(rows[0].control,'fixed-subset-registration');assert.equal(rows[0].passed,true);
  assert.deepEqual(rows[0].enabledSlots,[1,2,4]);assert.deepEqual(rows[0].disabledSlots,[0,3]);assert.equal(rows[0].inventedIntent,false);assert.equal(rows[0].fixtureDrained,true);
  await qualification('SUBSET_QUALIFICATION.json',library,rows);
  t.diagnostic('Retained subset-only native evidence: '+buildRoot);
});
