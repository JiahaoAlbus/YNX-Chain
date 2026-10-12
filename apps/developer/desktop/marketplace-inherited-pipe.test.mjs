import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import channel from '../runtime/ynx-workbench/lib/marketplace-channel.js';

test('dedicated fd survives sandbox and profile lock exec; normal subprocess cannot use host pipe', { skip: process.platform !== 'darwin' }, async () => {
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'ynx-catalog-fd-')));
  const node = '/Applications/YNX Developer Testnet Preview.app/Contents/Resources/runtime/node';
  const helper = '/Applications/YNX Developer Testnet Preview.app/Contents/Resources/runtime/ynx-local-workbench-lock';
  const module = fileURLToPath(new URL('../runtime/ynx-workbench/lib/marketplace-channel.js', import.meta.url));
  const ptyModule = fileURLToPath(new URL('../runtime/theia/node_modules/node-pty/lib/index.js', import.meta.url));
  const probe = `const fs=require('node:fs'); try { fs.writeSync(4, 'SHOULD_NOT_REACH_HOST\\n'); process.exit(2); } catch { process.exit(0); }`;
  const script = `const {spawnSync}=require('node:child_process'); const client=require(${JSON.stringify(module)}).inheritedCatalog();
    (async()=>{const result=await client.request('search',{query:'fixture'}); if(result.extensions.length!==0)throw Error('bad result');
    const child=spawnSync(process.execPath,['-e',${JSON.stringify(probe)}],{encoding:'utf8'});if(child.status!==0)throw Error('descriptor leak');
    const forkLike=spawnSync(process.execPath,['-e',${JSON.stringify(probe)}],{stdio:['pipe','pipe','pipe','pipe','pipe'],encoding:'utf8'});
    if(forkLike.output[4]?.toString()!=='SHOULD_NOT_REACH_HOST\\n')throw Error('expected separate child pipe');
    await new Promise((resolve,reject)=>{const terminal=require(${JSON.stringify(ptyModule)}).spawn(process.execPath,['-e',${JSON.stringify(probe)}],{env:{PATH:'/usr/bin:/bin'},cols:80,rows:24});
      const timeout=setTimeout(()=>{terminal.kill();reject(Error('PTY timeout'))},5000);terminal.onData(()=>{});terminal.onExit(event=>{clearTimeout(timeout);if(event.exitCode!==0)reject(Error('PTY descriptor leak'));else resolve()});});
    console.log('PIPE_OK_CHILD_ISOLATED'); client.close();})().catch(e=>{console.error(e.message);process.exitCode=1;client.close()});`;
  const child = spawn('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', helper, profile, node, '-e', script], {
    env: { PATH: '/usr/bin:/bin', YNX_MARKETPLACE_PIPE: '4' }, stdio: ['ignore','pipe','pipe','pipe','pipe'],
  });
  let output = '', errors = '', requests = 0;
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { errors += value; });
  const host = channel.serveCatalog(child.stdio[4], async () => { requests++; return { extensions: [] }; });
  try { const [code] = await once(child, 'close'); assert.equal(code, 0, errors); assert.match(output, /PIPE_OK_CHILD_ISOLATED/); assert.equal(requests, 1); }
  finally { host.close(); await rm(profile, { recursive: true, force: true }); }
});
