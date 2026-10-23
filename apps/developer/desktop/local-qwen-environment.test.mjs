import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { localWorkbenchEnvironment, localWorkbenchSandboxPolicy } from './local-workbench.mjs';

const input = id => ({ node: process.execPath, port: 43119, lockHelper: '/private/tmp/qa-lock', runtime: { root: '/private/tmp/runtime' },
  context: { id, workspace: `/private/tmp/${id}/workspace`, profile: `/private/tmp/${id}/profile`, temporary: `/private/tmp/${id}/tmp` }, plugins: '/private/tmp/plugins' });

test('Qwen configuration and runtime stay in the owning project without inheriting the real home', () => {
  const a = input('qwen-a'), b = input('qwen-b');
  const env = localWorkbenchEnvironment(a), other = localWorkbenchEnvironment(b);
  assert.equal(env.QWEN_HOME, join(a.context.profile, 'agent-homes', 'qwen'));
  assert.equal(env.QWEN_RUNTIME_DIR, join(a.context.temporary, 'qwen'));
  assert.notEqual(env.QWEN_HOME, other.QWEN_HOME);
  assert.notEqual(env.QWEN_RUNTIME_DIR, other.QWEN_RUNTIME_DIR);
  assert.equal(env.HOME, undefined);
  const policy = localWorkbenchSandboxPolicy(a);
  assert.ok(policy.includes('(deny network*)'));
  assert.ok(policy.includes('(deny file-write*)'));
  assert.ok(!policy.includes('/Users/huangjiahao/.qwen'));
});

test('actual unchanged sandbox permits persistent Qwen state only in its owning project', async () => {
  const root = await mkdtemp('/private/tmp/ynx-qwen-home-');
  try {
    const a = input('actual-qwen');
    a.context = { id: 'actual-qwen', workspace: join(root, 'workspace'), profile: join(root, 'profile'), temporary: join(root, 'tmp') };
    for (const path of Object.values(a.context).slice(1)) await mkdir(path);
    const env = localWorkbenchEnvironment(a);
    const script = `const fs=require('node:fs'),p=require('node:path');fs.mkdirSync(process.env.QWEN_HOME,{recursive:true});fs.mkdirSync(process.env.QWEN_RUNTIME_DIR,{recursive:true});fs.writeFileSync(p.join(process.env.QWEN_HOME,'settings.json'),'{}');try{fs.mkdirSync(${JSON.stringify(join(root, 'foreign-home'))});process.exit(40)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}console.log('OWNED_QWEN_STATE_OK');`;
    const output = execFileSync('/usr/bin/sandbox-exec', ['-p', localWorkbenchSandboxPolicy(a), process.execPath, '-e', script], { env, encoding: 'utf8' });
    assert.match(output, /OWNED_QWEN_STATE_OK/);
    assert.equal(await readFile(join(env.QWEN_HOME, 'settings.json'), 'utf8'), '{}');
    assert.equal(localWorkbenchEnvironment(a).QWEN_HOME, env.QWEN_HOME);
  } finally { await rm(root, { recursive: true, force: true }); }
});
