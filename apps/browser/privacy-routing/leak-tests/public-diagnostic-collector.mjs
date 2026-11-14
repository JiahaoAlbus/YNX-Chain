import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { open, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectOwnedSnapshot } from './scoped-collector.mjs';

const execute = promisify(execFile), HERE = fileURLToPath(import.meta.url);
export const PUBLIC_DIAGNOSTIC_ROLE = 'com.ynxweb4.browser.qa.tor.public-search';
export const PUBLIC_SNOWFLAKE_ROLE = 'com.ynxweb4.browser.qa.tor.public-search.snowflake';
const publisherSHA256 = '7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d';
const snowflakeHelperSHA256 = '23e2162d3bd439bec0dda06310f9c60ced7bccf35b82db4eb721c0177307387e';
const launchFields = ['schema','runID','profile','scratch','profileDevice','profileInode','scratchDevice','scratchInode',
  'scopeSHA256','helperSHA256','sourceInputsSHA256','reviewedSourceSHA256','selectedBridgeLineSHA256','deadlineUnixNano','fixedTarget'];
const policies = Object.freeze({
  [PUBLIC_DIAGNOSTIC_ROLE]: Object.freeze({ port:63779, artifacts:Object.freeze([
    Object.freeze({path:'PrivacyBackends/Tor/lyrebird',sha256:publisherSHA256})]) }),
  [PUBLIC_SNOWFLAKE_ROLE]: Object.freeze({ port:63782, artifacts:Object.freeze([
    Object.freeze({path:'PrivacyBackends/Tor/lyrebird',sha256:publisherSHA256}),
    Object.freeze({path:'PublicSnowflakeQA/lyrebird',sha256:snowflakeHelperSHA256})]) })
});
const fail = code => { throw new Error(code); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const env = { PATH: '/usr/bin:/bin' };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const absolute = path => typeof path === 'string' && path.startsWith('/') && !path.includes('\0') && resolve(path) === path;
const roleFor = value => {
  const role = value ?? PUBLIC_DIAGNOSTIC_ROLE;
  if (!Object.hasOwn(policies, role)) fail('EXACT_PUBLIC_DIAGNOSTIC_ROLE_REQUIRED');
  return role;
};

export function validatePublicCollectorOptions(value) {
  const diagnosticRole = roleFor(value.diagnosticRole);
  if (!integer(value.pid, 2, 2147483647) || !hex(value.expectedSHA256) || !hex(value.identitySHA256)) fail('INVALID_PID_OR_ARTIFACT_PIN');
  for (const path of [value.bundle, value.identityTool, value.outputDirectory]) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || resolve(path) !== path) fail('EXACT_ABSOLUTE_PATH_REQUIRED');
  }
  if (!value.bundle.endsWith('.app') || !integer(value.samples, 1, 20) || !integer(value.intervalMs, 100, 1000)) fail('INVALID_BOUNDED_OBSERVATION');
  if (value.expectedStart !== undefined && !/^[1-9][0-9]{0,14}:[0-9]{1,6}$/.test(value.expectedStart)) fail('INVALID_START_BINDING');
  if (value.expectedStart !== undefined && Number(value.expectedStart.split(':')[1]) > 999999) fail('INVALID_START_BINDING');
  if (diagnosticRole === PUBLIC_SNOWFLAKE_ROLE) {
    if (!uuid(value.runID) || !absolute(value.profile) || !hex(value.scopeSHA256) || !hex(value.launchSHA256) ||
        !uuid(value.observationNonce)) fail('EXACT_SNOWFLAKE_RUN_PROFILE_SCOPE_REQUIRED');
  } else if ([value.runID,value.profile,value.scopeSHA256,value.launchSHA256,value.observationNonce].some(field => field !== undefined)) fail('SNOWFLAKE_BINDING_ON_OTHER_ROLE');
  return { ...value, diagnosticRole };
}
export function validatePublicRole(info, expectedRole = PUBLIC_DIAGNOSTIC_ROLE) {
  const role = roleFor(expectedRole);
  if (!info || info.CFBundleIdentifier !== role || info.YNXPublicSearchDiagnostic !== true ||
      info.CFBundleExecutable !== 'YNXBrowserNative' || info.YNXPrivacyRouteMode !== undefined ||
      info.YNXNymProofHelper !== undefined || info.CFBundleURLTypes !== undefined) fail('SEALED_PUBLIC_DIAGNOSTIC_ROLE_REQUIRED');
  if (role === PUBLIC_SNOWFLAKE_ROLE) {
    if (info.YNXPublicSnowflakeSearchDiagnostic !== true || !hex(info.YNXPublicSnowflakeLaunchSHA256)) fail('SEALED_SNOWFLAKE_DIAGNOSTIC_ROLE_REQUIRED');
  } else if (info.YNXPublicSnowflakeSearchDiagnostic !== undefined || info.YNXPublicSnowflakeLaunchSHA256 !== undefined) fail('SEALED_PUBLIC_DIAGNOSTIC_ROLE_REQUIRED');
}
export function validatePublicProcess(identity, expected) {
  const role = roleFor(expected.diagnosticRole);
  if (identity?.schema !== 'P05_PUBLIC_DIAGNOSTIC_PROCESS_IDENTITY_V1' || identity.pid !== expected.pid ||
      identity.uid !== expected.uid || identity.euid !== expected.uid || identity.identityStable !== true ||
      identity.guestStatus !== 0 || identity.signatureStatus !== 0 || identity.signingIdentifier !== role ||
      identity.codeDirectoryHash !== expected.codeDirectoryHash || identity.path !== expected.executable ||
      identity.signedExecutablePath !== expected.executable || !integer(identity.startSeconds, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(identity.startMicroseconds, 0, 999999)) fail('PUBLIC_PROCESS_IDENTITY_REJECTED');
  if (expected.start !== undefined && `${identity.startSeconds}:${identity.startMicroseconds}` !== expected.start) fail('PROCESS_START_CHANGED_NO_REATTACH');
  return { ...identity, start: `${identity.startSeconds}:${identity.startMicroseconds}` };
}

// The existing launch wire is a canonical flat object of strings and unsigned
// integers. Preserve integer tokens as BigInt: nanosecond deadlines exceed 2^53.
// Parsing this metadata never supplies a qualification or reads the profile.
function flatLaunch(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16384) fail('BOUNDED_SNOWFLAKE_LAUNCH_REQUIRED');
  let text;
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { fail('INVALID_SNOWFLAKE_LAUNCH'); }
  if (!Buffer.from(text,'utf8').equals(bytes)) fail('NONCANONICAL_SNOWFLAKE_LAUNCH');
  let offset=0, previous='', object=Object.create(null);
  const string = () => {
    const match = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
    match.lastIndex=offset;const token=match.exec(text)?.[0];
    if (!token) fail('INVALID_SNOWFLAKE_LAUNCH');
    const value=JSON.parse(token);if (JSON.stringify(value)!==token) fail('NONCANONICAL_SNOWFLAKE_LAUNCH');
    offset+=token.length;return value;
  };
  if (text[offset++]!=='{') fail('INVALID_SNOWFLAKE_LAUNCH');
  for (;;) {
    const key=string();
    if (key<=previous || Object.hasOwn(object,key) || text[offset++]!==':') fail('UNKNOWN_DUPLICATE_OR_NONCANONICAL_LAUNCH_KEY');
    previous=key;
    if (text[offset]==='"') object[key]=string();
    else {
      const token=/^(?:0|[1-9][0-9]*)/.exec(text.slice(offset))?.[0];
      if (!token || token.length>20) fail('INVALID_SNOWFLAKE_LAUNCH_INTEGER');
      offset+=token.length;object[key]=BigInt(token);
    }
    const end=text[offset++];if (end==='}') break;if (end!==',') fail('INVALID_SNOWFLAKE_LAUNCH');
  }
  if (offset!==text.length || Object.keys(object).length!==launchFields.length || launchFields.some(key=>!Object.hasOwn(object,key))) fail('EXACT_SNOWFLAKE_LAUNCH_KEYS_REQUIRED');
  return object;
}
export function validatePublicSnowflakeLaunch(bytes, expected) {
  const object=flatLaunch(bytes), digest=createHash('sha256').update(bytes).digest('hex');
  if (!hex(expected.launchSHA256) || digest!==expected.launchSHA256 || !uuid(expected.runID) ||
      !absolute(expected.profile) || !hex(expected.scopeSHA256)) fail('SNOWFLAKE_LAUNCH_BINDING_REQUIRED');
  if (object.schema!=='P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V1' || object.runID!==expected.runID ||
      object.profile!==expected.profile || object.scopeSHA256!==expected.scopeSHA256 ||
      !absolute(object.scratch) || !/\/ynx-public-search-[A-Za-z0-9]{8}$/.test(object.scratch) ||
      object.profile!==object.scratch+'/YNX Browser Route State/Tor' || object.helperSHA256!==snowflakeHelperSHA256 ||
      object.sourceInputsSHA256!=='5f3954996d0b8ca00a3e1c456618cac8f775eb333915ea25cc831e4ae3c1f06b' ||
      object.reviewedSourceSHA256!=='2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407' ||
      object.selectedBridgeLineSHA256!=='9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f' ||
      object.fixedTarget!=='https://html.duckduckgo.com/html/?q=YNX%20browser') fail('SNOWFLAKE_LAUNCH_BINDING_MISMATCH');
  for (const key of ['profileDevice','profileInode','scratchDevice','scratchInode','deadlineUnixNano']) {
    if (typeof object[key]!=='bigint' || object[key]<=0n || object[key]>((key==='deadlineUnixNano'?1n<<63n:1n<<64n)-1n)) fail('INVALID_SNOWFLAKE_LAUNCH_INTEGER');
  }
  return { schema:object.schema,runID:object.runID,scopeSHA256:object.scopeSHA256,launchSHA256:digest,
    profilePathSHA256:createHash('sha256').update(object.profile).digest('hex'),deadlineUnixNano:String(object.deadlineUnixNano),
    helperSHA256:object.helperSHA256,sourceInputsSHA256:object.sourceInputsSHA256,notAnAuthority:true };
}
export function sanitizePublicSnapshot(snapshot) {
  if (!Array.isArray(snapshot?.scope) || snapshot.scope.length > 16 || !Array.isArray(snapshot.sockets) || snapshot.sockets.length > 256) fail('OWNED_METADATA_BOUND_EXCEEDED');
  const safeEndpoint = endpoint => !endpoint ? null : ['127.0.0.1','::1'].includes(endpoint.host) ? endpoint : { redacted: true };
  return { schema: snapshot.schema, observedAt: snapshot.observedAt, scope: snapshot.scope,
    sockets: snapshot.sockets.map(socket => ({ ...socket, local: safeEndpoint(socket.local), remote: safeEndpoint(socket.remote) })),
    lsofExit: snapshot.lsofExit, lsofErrorObserved: !!snapshot.lsofError, outputSHA256: snapshot.outputSHA256,
    targetVerdict: 'INCOMPLETE', scopeLimitations: snapshot.scopeLimitations,
    rawCaptureAvailable: false, packetNonEmissionProved: false, kernelWebKitResponsibility: 'NOT_OBSERVED' };
}

async function inspectRegular(path, maximum, retainBytes = false) {
  if (await realpath(path) !== path) fail('SYMLINK_ARTIFACT_REJECTED');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(maximum)) fail('BOUNDED_REGULAR_ARTIFACT_REQUIRED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536), chunks=[]; let total = 0;
    for (;;) { const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length,maximum+1-total), null); if (!bytesRead) break;
      const part=buffer.subarray(0,bytesRead);hash.update(part);if(retainBytes)chunks.push(Buffer.from(part));total+=bytesRead;if(total>maximum)fail('ARTIFACT_GREW'); }
    const after = await file.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || BigInt(total) !== before.size) fail('ARTIFACT_CHANGED');
    return {sha256:hash.digest('hex'),...(retainBytes?{bytes:Buffer.concat(chunks)}:{})};
  } finally { await file.close(); }
}
async function hashRegular(path, maximum) { return (await inspectRegular(path,maximum)).sha256; }
async function identityFor(options) {
  try {
    const result = await execute(options.identityTool, ['--pid', String(options.pid)], { env, timeout: 2000, maxBuffer: 16384 });
    return JSON.parse(result.stdout);
  } catch (error) {
    let value; try { value = JSON.parse(error.stdout ?? ''); } catch { }
    const observedExit = value?.pid === options.pid && value.errno === 3;
    fail(observedExit ? 'EXACT_PID_EXITED_NO_REATTACH' : 'PROCESS_IDENTITY_NOT_OBSERVED');
  }
}
async function intake(options) {
  options=validatePublicCollectorOptions(options);
  if (process.platform !== 'darwin' || process.getuid?.() === 0) fail('UNPRIVILEGED_MACOS_REQUIRED');
  if (await realpath(options.bundle) !== options.bundle || !(await lstat(options.bundle)).isDirectory()) fail('CANONICAL_APP_BUNDLE_REQUIRED');
  const infoPath = join(options.bundle, 'Contents/Info.plist');
  if (await realpath(infoPath) !== infoPath || !(await lstat(infoPath)).isFile() || (await lstat(infoPath)).size > 65536) fail('BOUNDED_SEALED_INFO_REQUIRED');
  const info = JSON.parse((await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPath], { env, timeout: 2000, maxBuffer: 131072 })).stdout);
  validatePublicRole(info,options.diagnosticRole);
  await execute('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', options.bundle], { env, timeout: 3000, maxBuffer: 65536 });
  const signed = await execute('/usr/bin/codesign', ['-d', '--verbose=4', options.bundle], { env, timeout: 2000, maxBuffer: 65536 });
  const fields = Object.fromEntries(signed.stderr.split('\n').filter(line => line.includes('=')).map(line => { const index = line.indexOf('='); return [line.slice(0,index),line.slice(index+1)]; }));
  if (fields.Identifier !== options.diagnosticRole || !/^[a-f0-9]{40,64}$/.test(fields.CDHash ?? '')) fail('ACTUAL_SIGNATURE_IDENTITY_REQUIRED');
  const executable = join(options.bundle, 'Contents/MacOS/YNXBrowserNative');
  if (await hashRegular(executable, 268435456) !== options.expectedSHA256) fail('SIGNED_EXECUTABLE_HASH_MISMATCH');
  if (await hashRegular(options.identityTool, 1048576) !== options.identitySHA256) fail('IDENTITY_TOOL_HASH_MISMATCH');
  const resourcePins=[];
  for (const artifact of policies[options.diagnosticRole].artifacts) {
    if (await hashRegular(join(options.bundle,'Contents/Resources',artifact.path),67108864)!==artifact.sha256) fail('EXACT_PUBLIC_HELPER_HASH_MISMATCH');
    resourcePins.push({...artifact});
  }
  let launchMetadata;
  if (options.diagnosticRole===PUBLIC_SNOWFLAKE_ROLE) {
    const launch=await inspectRegular(join(options.bundle,'Contents/Resources/PublicSnowflakeQA/launch.json'),16384,true);
    if (options.launchSHA256!==info.YNXPublicSnowflakeLaunchSHA256) fail('SNOWFLAKE_LAUNCH_BINDING_MISMATCH');
    launchMetadata=validatePublicSnowflakeLaunch(launch.bytes,{runID:options.runID,profile:options.profile,
      scopeSHA256:options.scopeSHA256,launchSHA256:options.launchSHA256});
  }
  const expected = { pid: options.pid, uid: process.getuid(), executable, codeDirectoryHash: fields.CDHash, start: options.expectedStart,
    diagnosticRole:options.diagnosticRole,...(launchMetadata?{runID:launchMetadata.runID,scopeSHA256:launchMetadata.scopeSHA256,
      observationNonce:options.observationNonce,launchSHA256:launchMetadata.launchSHA256}: {}) };
  const identity = validatePublicProcess(await identityFor(options), expected);
  return { expected: { ...expected, start: identity.start }, identity,resourcePins,...(launchMetadata?{launchMetadata}:{}) };
}
async function oneSnapshot(options) {
  options=validatePublicCollectorOptions(options);
  const initial = await intake(options);
  const snapshot = await collectOwnedSnapshot({ rootPID: options.pid, expectedExecutable: initial.expected.executable,
    routeEndpoints: [{ host:'127.0.0.1',port:policies[options.diagnosticRole].port,transport:'tcp' }], syntheticTargets: [] });
  const after = validatePublicProcess(await identityFor(options), initial.expected);
  return { status:'OBSERVED_INCOMPLETE', binding:initial.expected,resourcePins:initial.resourcePins,...(initial.launchMetadata?{launchMetadata:initial.launchMetadata}:{}), identityBefore:initial.identity, identityAfter:after,
    snapshot:sanitizePublicSnapshot(snapshot), targetVerdict:'INCOMPLETE', bytesOfPayloadRead:0 };
}

function argsFor(options) {
  return ['--pid',String(options.pid),'--bundle',options.bundle,'--diagnostic-role',options.diagnosticRole,'--expected-sha256',options.expectedSHA256,
    '--identity-tool',options.identityTool,'--identity-sha256',options.identitySHA256,'--output',options.outputDirectory,
    '--expected-start',options.expectedStart,'--samples','1','--interval-ms','100','--snapshot-once',
    ...(options.diagnosticRole===PUBLIC_SNOWFLAKE_ROLE?['--run-id',options.runID,'--profile',options.profile,'--scope-sha256',options.scopeSHA256,
      '--launch-sha256',options.launchSHA256,'--observation-nonce',options.observationNonce]:[])];
}
async function runSnapshotWorker(options) {
  return await new Promise(resolveResult => {
    const child = spawn(process.execPath, [HERE,...argsFor(options)], { detached:true, env, stdio:['ignore','pipe','pipe'] });
    let stdout='', stderr='', timeout=false, overflow=false, signalRequested=false;
    const stop = () => { if (signalRequested) return; signalRequested=true; try { process.kill(-child.pid,'SIGTERM'); } catch { } };
    const timer = setTimeout(() => { timeout=true;stop(); },5000);
    const unknown = setTimeout(() => { stop();child.stdout.destroy();child.stderr.destroy();child.unref();resolveResult({ status:'SAMPLE_TIMEOUT_UNKNOWN',workerPID:child.pid,workerPGID:child.pid,workerExit:'NOT_CONFIRMED',targetVerdict:'INCOMPLETE' }); },6500);
    child.stdout.on('data', bytes => { if (overflow) return;stdout+=bytes.toString();if (Buffer.byteLength(stdout)>1048576) { stdout='';overflow=true;stop(); } });
    child.stderr.on('data', bytes => { if (stderr.length<2048) stderr+=bytes.toString().slice(0,2048-stderr.length); });
    child.once('error', error => { clearTimeout(timer);clearTimeout(unknown);resolveResult({status:'WORKER_NOT_STARTED',errorCode:error.code,targetVerdict:'INCOMPLETE'}); });
    child.once('close',(code,signal) => {
      clearTimeout(timer);clearTimeout(unknown);
      const worker = {workerPID:child.pid,workerPGID:child.pid,workerExit:code,workerSignal:signal,workerClosed:true,workerDescendantReap:'NOT_OBSERVED'};
      if (timeout || overflow) return resolveResult({...worker,status:timeout?'SAMPLE_TIMEOUT_UNKNOWN':'SAMPLE_OUTPUT_LIMIT',targetVerdict:'INCOMPLETE'});
      try { resolveResult({...JSON.parse(stdout),...worker}); }
      catch { resolveResult({...worker,status:'SAMPLE_RESULT_NOT_OBSERVED',errorOutputObserved:!!stderr,targetVerdict:'INCOMPLETE'}); }
    });
  });
}

export async function collectPublicDiagnostic(options) {
  options=validatePublicCollectorOptions(options);
  await mkdir(options.outputDirectory,{mode:0o700});
  const receipt={schema:'P05_PUBLIC_DIAGNOSTIC_FD_OBSERVATION_V1',status:'STARTING',pid:options.pid,bundle:options.bundle,
    binarySHA256:options.expectedSHA256,identityToolSHA256:options.identitySHA256,startedAt:Date.now(),samples:[],targetVerdict:'INCOMPLETE',privacyAdmission:false,
    notObserved:['packet-capture','system-DNS','complete-WebKit-XPC-responsibility','non-loopback-non-emission','route-cutoff-or-crash-safety','controlled-public-target-receipt'],
    BPFPermissionProbeAttempted:false,GUIOrTargetLaunchAttempted:false,rawPayloadRead:false,role:'PUBLIC-fixed-search-network-diagnostic-only',diagnosticRole:options.diagnosticRole};
  const save = async () => { await writeFile(join(options.outputDirectory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600}); };
  await save();
  try {
    const bound = await intake(options);receipt.binding=bound.expected;receipt.identity=bound.identity;receipt.resourcePins=bound.resourcePins;
    if(bound.launchMetadata)receipt.launchMetadata=bound.launchMetadata;await save();
    const pinned={...options,expectedStart:bound.identity.start}, deadline=Date.now()+15000;
    for (let index=0;index<options.samples && Date.now()<deadline;index++) {
      const sample=await runSnapshotWorker(pinned);receipt.samples.push(sample);await save();
      if (sample.status!=='OBSERVED_INCOMPLETE') {receipt.status=sample.status;break;}
      receipt.status='OBSERVED_INCOMPLETE';
      if (index+1<options.samples) await new Promise(done=>setTimeout(done,options.intervalMs));
    }
    if (receipt.status==='OBSERVED_INCOMPLETE' && receipt.samples.length!==options.samples) receipt.status='BOUNDED_PARTIAL_INCOMPLETE';
  } catch (error) { receipt.status=error.message==='EXACT_PID_EXITED_NO_REATTACH'?'EXITED_NOT_REATTACHED':'IDENTITY_REJECTED_OR_NOT_OBSERVED';receipt.firstCause=error.message.slice(0,128); }
  receipt.endedAt=Date.now();await save();return receipt;
}

export function parsePublicCollectorArguments(args) {
  const keys=new Set(['--pid','--bundle','--expected-sha256','--identity-tool','--identity-sha256','--output','--samples','--interval-ms','--expected-start','--diagnostic-role','--run-id','--profile','--scope-sha256','--launch-sha256','--observation-nonce']);
  const values={},flags=new Set();
  for (let index=0;index<args.length;index++) {
    const key=args[index];
    if (key==='--snapshot-once' && !flags.has(key)) {flags.add(key);continue;}
    if (!keys.has(key) || values[key]!==undefined || typeof args[index+1]!=='string' || args[index+1].startsWith('--')) fail('UNKNOWN_DUPLICATE_OR_MISSING_ARGUMENT');
    values[key]=args[++index];
  }
  const number=(key,fallback) => values[key]===undefined?fallback:/^[0-9]+$/.test(values[key])?Number(values[key]):NaN;
  return {...validatePublicCollectorOptions({pid:number('--pid'),bundle:values['--bundle'],expectedSHA256:values['--expected-sha256'],
    identityTool:values['--identity-tool'],identitySHA256:values['--identity-sha256'],outputDirectory:values['--output'],
    samples:number('--samples',5),intervalMs:number('--interval-ms',250),expectedStart:values['--expected-start'],diagnosticRole:values['--diagnostic-role'],
    runID:values['--run-id'],profile:values['--profile'],scopeSHA256:values['--scope-sha256'],launchSHA256:values['--launch-sha256'],
    observationNonce:values['--observation-nonce']}),snapshotOnce:flags.has('--snapshot-once')};
}
if (process.argv[1] && resolve(process.argv[1])===HERE) {
  let options;try {options=parsePublicCollectorArguments(process.argv.slice(2));} catch(error) {console.error(error.message);process.exitCode=64;}
  if (options?.snapshotOnce) oneSnapshot(options).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.log(JSON.stringify({status:error.message==='EXACT_PID_EXITED_NO_REATTACH'?'EXITED_NOT_REATTACHED':'IDENTITY_REJECTED_OR_NOT_OBSERVED',firstCause:error.message.slice(0,128),targetVerdict:'INCOMPLETE'}));process.exitCode=2;});
  else if (options) collectPublicDiagnostic(options).then(value=>{console.log(JSON.stringify({receipt:join(options.outputDirectory,'receipt.json'),status:value.status,samples:value.samples.length,targetVerdict:'INCOMPLETE'}));process.exitCode=value.status==='OBSERVED_INCOMPLETE'?0:2;}).catch(error=>{console.error(error.message);process.exitCode=2;});
}
