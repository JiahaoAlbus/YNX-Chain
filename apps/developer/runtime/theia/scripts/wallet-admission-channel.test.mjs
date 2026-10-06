import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { PassThrough, Duplex } from 'node:stream';
import { realpath, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import channel from '../../ynx-workbench/lib/wallet-admission-channel.js';
import protocol from '../../ynx-workbench/lib/wallet-admission-protocol.js';
import controllerModule from '../../ynx-workbench/lib/native-wallet-controller.js';
const input = { service: 'wallet-product-session-v2', productId: 'developer', platform: 'macos', gatewayOrigin: 'https://wallet-auth.ynxweb4.com', operation: 'restore' };
const require = createRequire(import.meta.url);
const { MsgPackMessageEncoder, MsgPackMessageDecoder, registerMsgPackExtensions } = require('@theia/core/lib/common/message-rpc/rpc-message-encoder');
const { MsgPackExtensionManager } = require('@theia/core/lib/common/message-rpc/msg-pack-extension-manager');
if (!MsgPackExtensionManager.getInstance().getExtension(1)) registerMsgPackExtensions();
const encoder = new MsgPackMessageEncoder(), decoder = new MsgPackMessageDecoder();
function replyRoundtrip(value, error = false) {
  let bytes;
  encoder[error ? 'replyErr' : 'replyOK']({ writeBytes(value) { bytes = value; } }, 1, value);
  const result = decoder.parse({ readBytes() { return bytes; } });
  return error ? result.err : result.res;
}
function pair() {
  const a = new PassThrough(), b = new PassThrough();
  return [Duplex.from({ readable: a, writable: b }), Duplex.from({ readable: b, writable: a })];
}
test('four operations invoke private supplier separately, no cached success or paths', async () => {
  const [a,b] = pair(); const calls=[];
  const owner=channel.serveAdmission(a,{assertCurrent(v){calls.push(v);}}), client=channel.admissionClient(b);
  try { for(const operation of ['beginYNX','handleReturn','restore','disconnect']) assert.equal(await client.assertCurrent({...input,operation}),undefined);
    assert.equal(calls.length,4); assert.deepEqual(calls[0],{...input,operation:'beginYNX'});
    await assert.rejects(client.assertCurrent({...input,receiptPath:'/tmp/untrusted'}));
    await assert.rejects(client.assertCurrent({...input,operation:'signTransaction'}));
    assert.equal(calls.length,4);
  } finally {client.close();owner.close();}
});
test('supplier failure and non-undefined permission flags never grant', async () => {
  for(const supplier of [{assertCurrent(){throw Error('/private/secret');}}, {assertCurrent(){return true;}}]) {
    const [a,b]=pair(), owner=channel.serveAdmission(a,supplier),client=channel.admissionClient(b);
    try {await assert.rejects(client.assertCurrent(input),e=>e.code==='WALLET_SERVICE_ADMISSION_DENIED'&&!e.message.includes('secret'));}finally{client.close();owner.close();}
  }
});
test('bounded timeout retires pipe and rejects late result',async()=>{
  const[a,b]=pair();let release;
  const owner=channel.serveAdmission(a,{assertCurrent(){return new Promise(r=>release=r);}}),client=channel.admissionClient(b,15);
  try {await assert.rejects(client.assertCurrent(input),{code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});release();await assert.rejects(client.assertCurrent(input),{code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});}finally{client.close();owner.close();}
});
test('owner close rejects in flight and no reconnect grants',async()=>{
  const[a,b]=pair(),owner=channel.serveAdmission(a,{assertCurrent(){return new Promise(()=>{});}}),client=channel.admissionClient(b);
  const result=client.assertCurrent(input);owner.close();await assert.rejects(result,{code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});await assert.rejects(client.assertCurrent(input),{code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});client.close();
});
test('trusted pause and missing remain distinct through owner pipe, actual MsgPack and controller', async () => {
  for (const [code, phase, serviceConfiguration] of [
    ['WALLET_ONLINE_ADMISSION_PAUSED', 'paused', 'paused'],
    ['WALLET_SERVICE_ADMISSION_NOT_SUPPLIED', 'dependency-missing', 'not-supplied'],
    ['WALLET_SERVICE_ADMISSION_EXPIRED', 'error', 'unverified'],
  ]) {
    const [a, b] = pair();
    const owner = channel.serveAdmission(a, { assertCurrent() { throw Object.assign(Error('/private/secret'), { code }); } });
    const client = channel.admissionClient(b), backend = protocol.createAdmissionRpc(client);
    const rpc = { async assertCurrent(value) { return replyRoundtrip(await backend.assertCurrent(value)); } };
    let nativeCalls = 0;
    const controller = new controllerModule.NativeWalletController({
      DEVELOPER_WALLET_V2_SOURCE: { gatewayOrigin: input.gatewayOrigin },
      subscribeDeveloperWalletCallbacks() { return () => {}; },
      beginDeveloperWalletV2Connection() { ++nativeCalls; throw Error('Must not reach native approval'); },
    }, () => {}, protocol.createAdmissionProxy(rpc));
    try {
      await controller.connect();
      assert.equal(controller.state.phase, phase);
      assert.equal(controller.state.serviceConfiguration, serviceConfiguration);
      assert.equal(controller.state.failureCode, code === 'WALLET_SERVICE_ADMISSION_EXPIRED' ? 'WALLET_SERVICE_ADMISSION_DENIED' : code);
      assert.equal(controller.state.sessionCurrent, false);
      assert.equal(nativeCalls, 0);
      assert.doesNotMatch(controller.state.message, /private|secret/);
    } finally { await controller.dispose(); client.close(); owner.close(); }
  }
});
test('real retained MsgPack loses ordinary Error code, low-sensitivity result retains it', async () => {
  const ordinary = Object.assign(Error('safe'), { code: 'WALLET_ONLINE_ADMISSION_PAUSED' });
  assert.equal(replyRoundtrip(ordinary, true).code, undefined);
  const dto = await protocol.createAdmissionRpc({ assertCurrent() { throw ordinary; } }).assertCurrent(input);
  assert.deepEqual(replyRoundtrip(dto), { ok: false, code: 'WALLET_ONLINE_ADMISSION_PAUSED' });
  assert.deepEqual(Object.keys(dto).sort(), ['code', 'ok']);
  assert.equal(await protocol.createAdmissionProxy({ assertCurrent: async () => replyRoundtrip({ ok: true }) }).assertCurrent(input), undefined);
});
test('both boundaries reject arbitrary codes, malformed success and extra fields', async () => {
  for (const value of [undefined, true, {ok:true,code:'WALLET_ONLINE_ADMISSION_PAUSED'}, {ok:false},
    {ok:false,code:'ARBITRARY_SECRET'}, {ok:false,code:'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED',receiptPath:'/private/secret'}]) {
    await assert.rejects(protocol.createAdmissionProxy({assertCurrent:async()=>replyRoundtrip(value)}).assertCurrent(input), {code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});
  }
  const backend = protocol.createAdmissionRpc({ assertCurrent() { throw Object.assign(Error('/private/secret'), { code:'ARBITRARY_SECRET',data:{secret:true} }); } });
  assert.deepEqual(await backend.assertCurrent(input), {ok:false,code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});
  await assert.rejects(protocol.createAdmissionProxy({assertCurrent:async()=>{throw Error('/private/secret');}}).assertCurrent(input), error=>error.code==='WALLET_SERVICE_ADMISSION_UNAVAILABLE'&&!error.message.includes('secret'));
  for (const response of [{id:1,ok:true,code:'WALLET_ONLINE_ADMISSION_PAUSED'},{id:1,ok:false,code:'ARBITRARY_SECRET'},{id:1,ok:false},null]) {
    const [a,b]=pair(), client=channel.admissionClient(b);
    // This raw peer is deliberately not wrapped by serveAdmission's error
    // handler. Its abort when the client retires is expected test cleanup.
    a.on('error',()=>{});
    const pending=client.assertCurrent(input);
    a.write(JSON.stringify(response)+'\n');
    await assert.rejects(pending,{code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});
    await assert.rejects(client.assertCurrent(input),{code:'WALLET_SERVICE_ADMISSION_UNAVAILABLE'});
    client.close();a.destroy();
  }
});
test('actual child fd3 transports four-op assertion without network or shared graph',async()=>{
  const module=fileURLToPath(new URL('../../ynx-workbench/lib/wallet-admission-channel.js',import.meta.url));
  const script=`const c=require(${JSON.stringify(module)}).inheritedAdmission();c.assertCurrent(${JSON.stringify(input)}).then(()=>{c.close();process.exitCode=0},()=>{c.close();process.exitCode=1});`;
  const child=spawn(process.execPath,['-e',script],{stdio:['ignore','ignore','pipe','pipe']});
  const seen=[];const owner=channel.serveAdmission(child.stdio[3],{assertCurrent(v){seen.push(v);}});
  try{const[code]=await once(child,'exit');assert.equal(code,0);assert.deepEqual(seen,[input]);}finally{owner.close();}
});
test('production fixed-null successor selection fails closed',async()=>{
  const { openBundledWalletAdmission } = await import('../../../desktop/wallet-admission-startup.mjs');
  const admission=await openBundledWalletAdmission();assert.throws(()=>admission.assertCurrent(input),{code:'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'});
});
test('sandbox and packaged native lock preserve the private admission pipe', { skip: process.platform !== 'darwin' || !process.env.YNX_ADMISSION_TEST_APP }, async () => {
  const { localWorkbenchSandboxPolicy, localWorkbenchPathIdentities } = await import('../../../desktop/local-workbench.mjs');
  const app = await realpath(process.env.YNX_ADMISSION_TEST_APP);
  const node = join(app, 'Contents/Resources/runtime/node');
  const lockHelper = join(app, 'Contents/Resources/runtime/ynx-local-workbench-lock');
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'ynx-admission-native-')));
  const profile = join(fixture, 'profile');
  await mkdir(profile, { mode: 0o700 });
  const module = join(fixture, 'wallet-admission-channel.cjs');
  await copyFile(fileURLToPath(new URL('../../ynx-workbench/lib/wallet-admission-channel.js', import.meta.url)), module);
  await copyFile(fileURLToPath(new URL('../../ynx-workbench/lib/wallet-admission-protocol.js', import.meta.url)), join(fixture, 'wallet-admission-protocol.js'));
  const context = { workspace: fixture, profile, temporary: fixture };
  const inputs = { node, lockHelper, runtime: { root: fixture }, context };
  const pathIdentities = await localWorkbenchPathIdentities({ ...inputs, helper: join(app, 'Contents/Resources/runtime/workspace-path-identity') });
  const policy = localWorkbenchSandboxPolicy({ ...inputs, pathIdentities, port: 49152 });
  const script = `const c=require(${JSON.stringify(module)}).inheritedAdmission();c.assertCurrent(${JSON.stringify(input)}).then(()=>{c.close();process.exitCode=0},()=>{c.close();process.exitCode=1});`;
  const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, lockHelper, profile, node, '-e', script], { cwd: fixture, stdio: ['ignore', 'ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', OPENSSL_CONF: '/dev/null' } });
  let stderr = '';
  child.stderr.on('data', value => { stderr += value; });
  const seen = [], owner = channel.serveAdmission(child.stdio[3], { assertCurrent(value) { seen.push(value); } });
  const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.deepEqual(seen, [input]);
  } finally {
    clearTimeout(timer);
    owner.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
