import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { PassThrough, Duplex } from 'node:stream';
import { realpath, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import channel from '../../ynx-workbench/lib/wallet-admission-channel.js';
import { openBundledWalletAdmission } from '../../../desktop/wallet-admission-startup.mjs';
const input = { service: 'wallet-product-session-v2', productId: 'developer', platform: 'macos', gatewayOrigin: 'https://wallet-auth.ynxweb4.com', operation: 'restore' };
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
    try {await assert.rejects(client.assertCurrent(input),e=>!e.message.includes('secret'));}finally{client.close();owner.close();}
  }
});
test('bounded timeout retires pipe and rejects late result',async()=>{
  const[a,b]=pair();let release;
  const owner=channel.serveAdmission(a,{assertCurrent(){return new Promise(r=>release=r);}}),client=channel.admissionClient(b,15);
  try {await assert.rejects(client.assertCurrent(input));release();await assert.rejects(client.assertCurrent(input));}finally{client.close();owner.close();}
});
test('owner close rejects in flight and no reconnect grants',async()=>{
  const[a,b]=pair(),owner=channel.serveAdmission(a,{assertCurrent(){return new Promise(()=>{});}}),client=channel.admissionClient(b);
  const result=client.assertCurrent(input);owner.close();await assert.rejects(result);await assert.rejects(client.assertCurrent(input));client.close();
});
test('actual child fd3 transports four-op assertion without network or shared graph',async()=>{
  const module=fileURLToPath(new URL('../../ynx-workbench/lib/wallet-admission-channel.js',import.meta.url));
  const script=`const c=require(${JSON.stringify(module)}).inheritedAdmission();c.assertCurrent(${JSON.stringify(input)}).then(()=>{c.close();process.exitCode=0},()=>{c.close();process.exitCode=1});`;
  const child=spawn(process.execPath,['-e',script],{stdio:['ignore','ignore','pipe','pipe']});
  const seen=[];const owner=channel.serveAdmission(child.stdio[3],{assertCurrent(v){seen.push(v);}});
  try{const[code]=await once(child,'exit');assert.equal(code,0);assert.deepEqual(seen,[input]);}finally{owner.close();}
});
test('production missing successor selection fails closed without importing supplier',async()=>{
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
