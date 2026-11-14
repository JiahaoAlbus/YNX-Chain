import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DIAGNOSTIC_ROLE, PUBLIC_SNOWFLAKE_ROLE, validatePublicCollectorOptions,
  validatePublicRole, validatePublicProcess, validatePublicSnowflakeLaunch,
  parsePublicCollectorArguments } from '../public-diagnostic-collector.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runID='12345678-1234-1234-1234-123456789abc', nonce='87654321-4321-4321-4321-cba987654321';
const scratch='/PUBLIC/ynx-public-search-abCD1234', profile=scratch+'/YNX Browser Route State/Tor';
const fields={schema:'P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V1',runID,profile,scratch,
  profileDevice:123n,profileInode:456n,scratchDevice:123n,scratchInode:789n,
  scopeSHA256:'a'.repeat(64),helperSHA256:'23e2162d3bd439bec0dda06310f9c60ced7bccf35b82db4eb721c0177307387e',
  sourceInputsSHA256:'5f3954996d0b8ca00a3e1c456618cac8f775eb333915ea25cc831e4ae3c1f06b',
  reviewedSourceSHA256:'2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407',
  selectedBridgeLineSHA256:'9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f',
  deadlineUnixNano:1794100000123456789n,fixedTarget:'https://html.duckduckgo.com/html/?q=YNX%20browser'};
const encode=value=>Buffer.from('{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+
  (typeof value[key]==='bigint'?String(value[key]):JSON.stringify(value[key]))).join(',')+'}');
const bytes=encode(fields), binding={runID,profile,scopeSHA256:fields.scopeSHA256,launchSHA256:hash(bytes)};
const options={pid:3456,bundle:'/PUBLIC/Diagnostic.app',expectedSHA256:'b'.repeat(64),identityTool:'/PUBLIC/Identity',
  identitySHA256:'c'.repeat(64),outputDirectory:'/PUBLIC/fresh-output',samples:1,intervalMs:100,
  diagnosticRole:PUBLIC_SNOWFLAKE_ROLE,...binding,observationNonce:nonce};

test('new exact role stays separate from legacy PUBLIC and immutable process identity',()=>{
  const info={CFBundleIdentifier:PUBLIC_SNOWFLAKE_ROLE,CFBundleExecutable:'YNXBrowserNative',
    YNXPublicSearchDiagnostic:true,YNXPublicSnowflakeSearchDiagnostic:true,YNXPublicSnowflakeLaunchSHA256:binding.launchSHA256};
  assert.doesNotThrow(()=>validatePublicRole(info,PUBLIC_SNOWFLAKE_ROLE));
  for(const changed of [{CFBundleIdentifier:PUBLIC_SNOWFLAKE_ROLE+'.other'},{YNXPublicSnowflakeSearchDiagnostic:1},
    {YNXPublicSnowflakeSearchDiagnostic:false},{YNXPublicSnowflakeLaunchSHA256:'bad'},{YNXPrivacyRouteMode:'tor'},
    {YNXNymProofHelper:true},{CFBundleURLTypes:[]}]) assert.throws(()=>validatePublicRole({...info,...changed},PUBLIC_SNOWFLAKE_ROLE));
  assert.throws(()=>validatePublicRole(info));
  assert.throws(()=>validatePublicRole({...info,CFBundleIdentifier:PUBLIC_DIAGNOSTIC_ROLE},PUBLIC_SNOWFLAKE_ROLE));
  const expected={pid:3456,uid:501,executable:'/PUBLIC/Diagnostic.app/Contents/MacOS/YNXBrowserNative',
    codeDirectoryHash:'d'.repeat(40),start:'100:123',diagnosticRole:PUBLIC_SNOWFLAKE_ROLE};
  const identity={schema:'P05_PUBLIC_DIAGNOSTIC_PROCESS_IDENTITY_V1',pid:3456,uid:501,euid:501,identityStable:true,
    guestStatus:0,signatureStatus:0,signingIdentifier:PUBLIC_SNOWFLAKE_ROLE,codeDirectoryHash:expected.codeDirectoryHash,
    path:expected.executable,signedExecutablePath:expected.executable,startSeconds:100,startMicroseconds:123};
  assert.equal(validatePublicProcess(identity,expected).start,expected.start);
  assert.throws(()=>validatePublicProcess({...identity,signingIdentifier:PUBLIC_DIAGNOSTIC_ROLE},expected));
  assert.throws(()=>validatePublicProcess(identity,{...expected,diagnosticRole:PUBLIC_DIAGNOSTIC_ROLE}));
  assert.throws(()=>validatePublicProcess({...identity,startMicroseconds:124},expected));
});

test('Snowflake parameters require full DATA binding before file or process access',()=>{
  assert.equal(validatePublicCollectorOptions(options).diagnosticRole,PUBLIC_SNOWFLAKE_ROLE);
  for(const key of ['runID','profile','scopeSHA256','launchSHA256','observationNonce'])
    assert.throws(()=>validatePublicCollectorOptions({...options,[key]:undefined}));
  for(const changed of [{diagnosticRole:PUBLIC_SNOWFLAKE_ROLE+'.other'},{runID:runID.toUpperCase()},
    {profile:'/PUBLIC/../other'},{scopeSHA256:'A'.repeat(64)},{observationNonce:'not-a-uuid'}])
    assert.throws(()=>validatePublicCollectorOptions({...options,...changed}));
  assert.throws(()=>validatePublicCollectorOptions({...options,diagnosticRole:PUBLIC_DIAGNOSTIC_ROLE}));
  const args=['--pid','3456','--bundle',options.bundle,'--expected-sha256',options.expectedSHA256,
    '--identity-tool',options.identityTool,'--identity-sha256',options.identitySHA256,'--output',options.outputDirectory,
    '--diagnostic-role',PUBLIC_SNOWFLAKE_ROLE,'--run-id',runID,'--profile',profile,'--scope-sha256',binding.scopeSHA256,
    '--launch-sha256',binding.launchSHA256,'--observation-nonce',nonce];
  assert.equal(parsePublicCollectorArguments(args).observationNonce,nonce);
  assert.throws(()=>parsePublicCollectorArguments([...args,'--run-id',runID]));
});

test('sealed launch preserves exact nanoseconds and refuses wrong, duplicate or unbounded metadata',()=>{
  const value=validatePublicSnowflakeLaunch(bytes,binding);
  assert.equal(value.deadlineUnixNano,'1794100000123456789');
  assert.equal(value.runID,runID);assert.equal(value.profilePathSHA256,hash(profile));assert.equal(value.notAnAuthority,true);
  assert.equal(value.profile,undefined);
  for(const changed of [{runID:nonce},{profile:profile+'-other'},{scopeSHA256:'0'.repeat(64)},
    {helperSHA256:'7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d'},
    {sourceInputsSHA256:'0'.repeat(64)},{fixedTarget:'https://duckduckgo.com/'},{extra:'unexpected'},
    {profileDevice:true},{profileInode:1.5},{scratchInode:-1},{deadlineUnixNano:1n<<63n}]) {
    const altered=encode({...fields,...changed});
    assert.throws(()=>validatePublicSnowflakeLaunch(altered,{...binding,launchSHA256:hash(altered)}));
  }
  const malformed=[Buffer.concat([Buffer.from([239,187,191]),bytes]),Buffer.from(bytes+'\n'),
    Buffer.from(bytes.toString().replace('"runID":','"runID":"duplicate","runID":')),
    Buffer.from(bytes.toString().replace('1794100000123456789','1.794100000123456789e18')),Buffer.alloc(16385)];
  for(const altered of malformed) assert.throws(()=>validatePublicSnowflakeLaunch(altered,{...binding,launchSHA256:hash(altered)}));
  assert.throws(()=>validatePublicSnowflakeLaunch(bytes,{...binding,launchSHA256:'0'.repeat(64)}));
  assert.throws(()=>validatePublicSnowflakeLaunch(bytes,{...binding,profile:profile+'-other'}));
});

test('actual new-role CLI rejects a suffix role before any output directory or identity command',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ynx-public-sf-negative-')), output=join(root,'not-created');
  const script=fileURLToPath(new URL('../public-diagnostic-collector.mjs',import.meta.url));
  await new Promise((done,reject)=>{
    const child=execFile(process.execPath,[script,'--pid',String(process.pid),'--bundle',join(root,'never.app'),
      '--expected-sha256',options.expectedSHA256,'--identity-tool',join(root,'never-run'),
      '--identity-sha256',options.identitySHA256,'--output',output,'--diagnostic-role',PUBLIC_SNOWFLAKE_ROLE+'.other'],
    {timeout:3000},(error,stdout,stderr)=>{
      try {assert.equal(error?.code,64);assert.equal(stdout,'');assert.match(stderr,/EXACT_PUBLIC_DIAGNOSTIC_ROLE_REQUIRED/);
        t.diagnostic(`ownedCollectorChildPID=${child.pid} exit=64 closeConfirmed=true noTargetObservation=true`);done();
      } catch(failure) {reject(failure);}
    });
  });
  await assert.rejects(stat(output),error=>error.code==='ENOENT');
});
