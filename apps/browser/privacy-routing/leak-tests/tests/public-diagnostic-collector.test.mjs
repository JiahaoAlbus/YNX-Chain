import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DIAGNOSTIC_ROLE, validatePublicCollectorOptions, validatePublicRole, validatePublicProcess,
  sanitizePublicSnapshot, parsePublicCollectorArguments } from '../public-diagnostic-collector.mjs';

const hash='a'.repeat(64),cdhash='b'.repeat(40),bundle='/PUBLIC/Diagnostic.app';
const options={pid:3456,bundle,expectedSHA256:hash,identityTool:'/PUBLIC/Identity',identitySHA256:hash,
  outputDirectory:'/PUBLIC/new-output',samples:3,intervalMs:250};
const expected={pid:3456,uid:501,executable:bundle+'/Contents/MacOS/YNXBrowserNative',codeDirectoryHash:cdhash,start:'100:12345'};
const identity={schema:'P05_PUBLIC_DIAGNOSTIC_PROCESS_IDENTITY_V1',pid:3456,ppid:1,uid:501,euid:501,path:expected.executable,
  signedExecutablePath:expected.executable,startSeconds:100,startMicroseconds:12345,identityStable:true,
  guestStatus:0,signatureStatus:0,signingIdentifier:PUBLIC_DIAGNOSTIC_ROLE,codeDirectoryHash:cdhash};

test('PUBLIC role is strict and excludes normal/route/proof/URL-handler roles',()=>{
  const info={CFBundleIdentifier:PUBLIC_DIAGNOSTIC_ROLE,CFBundleExecutable:'YNXBrowserNative',YNXPublicSearchDiagnostic:true};
  assert.doesNotThrow(()=>validatePublicRole(info));
  for(const changed of [{YNXPublicSearchDiagnostic:1},{YNXPublicSearchDiagnostic:'true'},
    {CFBundleIdentifier:'com.ynxweb4.browser'},{YNXPrivacyRouteMode:'tor'},
    {YNXNymProofHelper:true},{CFBundleURLTypes:[]},{CFBundleExecutable:'other'}])
    assert.throws(()=>validatePublicRole({...info,...changed}),/ROLE_REQUIRED/);
});
test('bounded PID/path/hash/start arguments reject before file or process observation',()=>{
  assert.doesNotThrow(()=>validatePublicCollectorOptions(options));
  for(const changed of [{pid:1},{pid:3456.5},{pid:NaN},{bundle:'/PUBLIC/link/../Diagnostic.app'},
    {identityTool:'relative'},{expectedSHA256:'A'.repeat(64)},{identitySHA256:'a'},
    {samples:0},{samples:21},{intervalMs:99},{intervalMs:1001},{expectedStart:'100:1000000'}])
    assert.throws(()=>validatePublicCollectorOptions({...options,...changed}));
});
test('same-PID exec, UID, signature and microsecond start changes cannot reattach',()=>{
  assert.equal(validatePublicProcess(identity,expected).start,'100:12345');
  for(const changed of [{pid:3457},{uid:502},{euid:0},{identityStable:false},{guestStatus:-1},
    {signatureStatus:-1},{signingIdentifier:'com.apple.WebKit.Networking'},{codeDirectoryHash:'c'.repeat(40)},
    {path:'/other'},{signedExecutablePath:'/other'},{startSeconds:101},{startMicroseconds:12346}])
    assert.throws(()=>validatePublicProcess({...identity,...changed},expected));
});
test('collector CLI rejects duplicate, unknown, missing and unbounded operands',()=>{
  const args=['--pid','3456','--bundle',bundle,'--expected-sha256',hash,'--identity-tool','/PUBLIC/Identity',
    '--identity-sha256',hash,'--output','/PUBLIC/new-output'];
  assert.equal(parsePublicCollectorArguments(args).samples,5);
  for(const more of [['--pid','3456'],['--unknown','x'],['--samples'],['--samples','2.5'],['--interval-ms','0']])
    assert.throws(()=>parsePublicCollectorArguments([...args,...more]));
});
test('only bounded FD metadata remains, local and external addresses are redacted',()=>{
  const snapshot={schema:'YNX_OWNED_SOCKET_SNAPSHOT_V1',scope:[{pid:3456}],sockets:[
    {pid:3456,local:{host:'192.0.2.1',port:1234},remote:{host:'198.51.100.1',port:443}},
    {pid:3456,local:{host:'127.0.0.1',port:1235},remote:{host:'127.0.0.1',port:63779}}],
    lsofExit:0,outputSHA256:hash,scopeLimitations:['No packet non-emission proof']};
  const value=sanitizePublicSnapshot(snapshot);
  assert.deepEqual(value.sockets[0].local,{redacted:true});assert.deepEqual(value.sockets[0].remote,{redacted:true});
  assert.equal(value.sockets[1].remote.port,63779);assert.equal(value.targetVerdict,'INCOMPLETE');
  assert.equal(value.packetNonEmissionProved,false);assert.equal(value.kernelWebKitResponsibility,'NOT_OBSERVED');
  assert.throws(()=>sanitizePublicSnapshot({...snapshot,scope:Array(17).fill({})}),/BOUND_EXCEEDED/);
  assert.throws(()=>sanitizePublicSnapshot({...snapshot,sockets:Array(257).fill({})}),/BOUND_EXCEEDED/);
});
test('actual new CLI refuses nonexistent app before querying any PID or FD',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ynx-public-observer-negative-'));
  const output=join(root,'result'),script=fileURLToPath(new URL('../public-diagnostic-collector.mjs',import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath,[script,'--pid',String(process.pid),'--bundle',join(root,'absent.app'),
    '--expected-sha256',hash,'--identity-tool',join(root,'never-executed'),'--identity-sha256',hash,'--output',output],
  {timeout:5000}),error=>error.code===2);
  const value=JSON.parse(await readFile(join(output,'receipt.json'),'utf8'));
  assert.equal(value.samples.length,0);assert.equal(value.BPFPermissionProbeAttempted,false);
  assert.equal(value.GUIOrTargetLaunchAttempted,false);assert.equal(value.targetVerdict,'INCOMPLETE');
  assert.equal(value.binding,undefined);assert.equal(value.privacyAdmission,false);
});
