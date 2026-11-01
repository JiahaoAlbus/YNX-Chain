// Only the new ctx-only startup composition. Existing private-client controls
// and P06 packet groups are deliberately independent evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const caller=path.join(repository,'cmd/ynx-secure-link-caller');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const rootHandoffSHA='6bb1eee876fc02f3b99dcf00e20284d77fdc1bf78f874032c4f79cd930ee1ca3';
const nativeHandoffSHA='1a99920905bbdd1222ab0524aa258d99655b567f1a75caff4ece2490bf2806fa';

test('actual Auth ctx-only normal Go startup calls its fixed Source constructor and original Unix endpoint',async t=>{
  assert.equal(process.platform,'darwin','matching Auth normal image qualification is currently Darwin only');
  const receiptFile=process.env.YNX_LINK_PAY_STARTUP_BUILD_RECEIPT;
  const receiptSHA=process.env.YNX_LINK_PAY_STARTUP_BUILD_RECEIPT_SHA256;
  const artifacts=process.env.YNX_LINK_PAY_STARTUP_TEST_ARTIFACTS??path.join(os.tmpdir(),'ynx-link-startup-evidence');
  assert.ok(receiptFile&&/^[0-9a-f]{64}$/.test(receiptSHA??''),'explicit pinned normal archive receipt required');
  assert.ok(path.isAbsolute(artifacts),'absolute owned evidence directory required');
  assert.ok(path.resolve(artifacts)!==repository&&!path.resolve(artifacts).startsWith(repository+path.sep),'evidence must remain outside source');
  await mkdir(artifacts,{recursive:true});
  const actualArtifacts=await realpath(artifacts),actualRepository=await realpath(repository);
  assert.ok(actualArtifacts!==actualRepository&&!actualArtifacts.startsWith(actualRepository+path.sep),'evidence symlink must remain outside source');
  const output=await mkdtemp(path.join(artifacts,'actual-startup-'));
  let sequence=0;
  const inputs=[];
  async function pinned(entry,record=true){
    assert.ok(entry&&path.isAbsolute(entry.path??'')&&Number.isSafeInteger(entry.bytes)&&/^[0-9a-f]{64}$/.test(entry.sha256??''),'complete immutable input pin required');
    const raw=await readFile(entry.path);
    assert.equal(raw.length,entry.bytes,'input size: '+entry.path);
    assert.equal(digest(raw),entry.sha256,'input SHA256: '+entry.path);
    if(record)inputs.push({path:entry.path,bytes:raw.length,sha256:digest(raw)});
    return raw;
  }
  async function run(name,command,args,{input,timeout=30000}={}){
    const result=spawnSync(command,args,{cwd:repository,input,encoding:'utf8',timeout,maxBuffer:4<<20});
    const prefix=path.join(output,String(++sequence).padStart(2,'0')+'-'+name);
    await writeFile(prefix+'.stdout',result.stdout??'',{flag:'wx'});
    await writeFile(prefix+'.stderr',result.stderr??'',{flag:'wx'});
    await writeFile(prefix+'.json',JSON.stringify({command,args,exit:result.status,signal:result.signal,error:result.error?.code??null},null,2)+'\n',{flag:'wx'});
    assert.equal(result.error,undefined,`${name}: ${result.error?.message}`);
    assert.equal(result.status,0,`${name} FIRSTCAUSE:\n${result.stderr}\n${result.stdout}`);
    return result.stdout;
  }
  try {
    const receiptBytes=await readFile(receiptFile);
    assert.equal(digest(receiptBytes),receiptSHA,'normal archive receipt content pin');
    const receipt=JSON.parse(receiptBytes);
    assert.equal(receipt.state,'NORMAL_STARTUP_ARCHIVE_BUILT_NOT_QUALIFIED');
    await pinned(receipt.archive);
    for(const header of receipt.headers)await pinned(header);
    const rootHeader=receipt.headers.find(row=>path.basename(row.path)==='pay_root_transport_loan_private.h');
    const nativeHeader=receipt.headers.find(row=>path.basename(row.path)==='pay_native_actual_context_private.h');
    assert.ok(rootHeader?.original&&nativeHeader?.original,'original formal Auth source roots required');
    const rootSource=path.dirname(await realpath(rootHeader.original));
    const nativeSource=path.dirname(await realpath(nativeHeader.original));
    const rootHFile=path.join(rootSource,'../HANDOFF.json');
    const nativeHFile=path.join(nativeSource,'../HANDOFF.json');
    const rootHBytes=await readFile(rootHFile),nativeHBytes=await readFile(nativeHFile);
    assert.equal(digest(rootHBytes),rootHandoffSHA,'formal Root final-r1 H');
    assert.equal(digest(nativeHBytes),nativeHandoffSHA,'formal Native actual-context-r1 H');
    const rootH=JSON.parse(rootHBytes),nativeH=JSON.parse(nativeHBytes);
    const rootInventory=JSON.parse(await pinned(rootH.sourcefiles));
    assert.ok(Array.isArray(rootInventory.production)&&rootInventory.production.length<=64);
    for(const row of rootInventory.production)await pinned(row.snapshot);
    assert.ok(Array.isArray(nativeH.files)&&nativeH.files.length<=32);
    for(const row of nativeH.files)await pinned(row);
    // Make the link input header match the exact new header compiled into the
    // normal archive; no successor ABI is silently substituted after build.
    for(const name of ['private_client_v1.h','private_client_startup_v1.h']){
      const header=receipt.headers.find(row=>path.basename(row.path)===name);
      assert.ok(header,'normal archive caller header pin missing: '+name);
      await pinned({...header,path:path.join(caller,name)});
    }
    for(const name of ['private-client-startup.integration.cpp','private-client-startup.test.mjs']){
      const file=path.join(caller,name),raw=await readFile(file);
      inputs.push({path:file,bytes:raw.length,sha256:digest(raw)});
    }
    const pkg=await run('OpenSSL-link-flags','pkg-config',['--libs','openssl']);
    const cryptoFlags=pkg.trim().split(/\s+/).filter(Boolean);
    assert.ok(cryptoFlags.length&&cryptoFlags.every(flag=>/^-(?:L\/[A-Za-z0-9_./+@-]+|l[A-Za-z0-9_+-]+)$/.test(flag)),'bounded local OpenSSL library flags required');
    const executable=path.join(output,'actual-native-startup');
    await run('C11-header','clang',['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-I',caller,'-x','c','-fsyntax-only','-'],{input:'#include "private_client_startup_v1.h"\n'});
    await run('CXX-original-composition','clang++',[
      '-std=c++17','-Wall','-Wextra','-Werror','-pedantic','-Wno-deprecated-declarations',
      '-I',caller,'-I',nativeSource,'-I',rootSource,
      path.join(caller,'private-client-startup.integration.cpp'),
      path.join(rootSource,'pay_root_transport_loan.cpp'),
      path.join(nativeSource,'pay_native_actual_context.cpp'),
      path.join(nativeSource,'pay_native_source_lease.cpp'),
      path.join(nativeSource,'pay_native_kernel.cpp'),
      receipt.archive.path,'-framework','CoreFoundation','-framework','Security','-lresolv',
      ...cryptoFlags,'-o',executable,
    ]);
    const stdout=await run('actual-startup',executable,[],{timeout:20000});
    const rows=stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.equal(rows.length,1);
    const result=rows[0];
    assert.equal(result.control,'actual-ctx-only-startup');
    for(const key of ['passed','fixedOriginalContext','sourceCtorOnce','foreignAndRetiredContextsRefused','actualSourceDrain','normalQualificationBoundaryFixture'])assert.equal(result[key],true,key);
    assert.equal(result.actualUnixGETs,1);
    for(const key of ['RootAdmission','SourceAdmission','actualMainApproval','realFunds'])assert.equal(result[key],false,key);
    for(const entry of inputs)await pinned(entry,false);
    assert.equal(digest(await readFile(receiptFile)),receiptSHA,'archive receipt changed during control');
    await writeFile(path.join(output,'RESULT.json'),JSON.stringify({result,archive:receipt.archive,receipt:{path:receiptFile,sha256:receiptSHA},rootHandoff:{path:rootHFile,sha256:rootHandoffSHA},nativeHandoff:{path:nativeHFile,sha256:nativeHandoffSHA},inputs,installed:false,deployed:false},null,2)+'\n',{flag:'wx'});
  } finally { t.diagnostic('Retained startup inputs, binary and first-cause logs: '+output); }
});
