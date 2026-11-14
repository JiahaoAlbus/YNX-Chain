import test from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdtemp, copyFile, chmod, writeFile, rm, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inspectJsExecutionNode } from './local-js-debug-session.mjs';
const exec = promisify(execFile);

test('JS supervisor admits its byte-identical private Node copy, never an arbitrary replacement', { skip: process.platform !== 'darwin' }, async t => {
  // Exercise the actual reviewed standalone Node used in the Mac package.
  // Homebrew's test runner is a dylib launcher, not the shipped executable.
  if (process.env.YNX_STANDALONE_NODE_COPY_TEST !== '1') {
    const env = { ...process.env, YNX_STANDALONE_NODE_COPY_TEST: '1' };
    delete env.NODE_TEST_CONTEXT;
    const result = await exec('/usr/local/bin/node', ['--test', fileURLToPath(import.meta.url)], {
      timeout: 30000, env, maxBuffer: 32768,
    });
    assert.match(result.stdout, /(?:#|ℹ) tests 1/);
    assert.match(result.stdout, /(?:#|ℹ) pass 1/);
    assert.match(result.stdout, /(?:#|ℹ) skipped 0/);
    t.diagnostic(result.stdout); return;
  }
  assert.equal(process.version, 'v24.19.0');
  const root = await mkdtemp(join(homedir(), '.ynx-js-execution-test-')); await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const node = join(root, 'node'), alias = join(root, 'ynx-js-node'), marker = join(root, 'executed');
  for (const path of [node, alias]) { await copyFile(process.execPath, path, constants.COPYFILE_FICLONE); await chmod(path, 0o700); }
  assert.equal(await inspectJsExecutionNode(node), alias);
  await writeFile(node, '#!/bin/sh\ntouch "' + marker + '"\n');
  await assert.rejects(inspectJsExecutionNode(node), /differs from the sealed runtime/);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
  await rm(node); await copyFile(process.execPath, node, constants.COPYFILE_FICLONE); await chmod(node, 0o700);
  await chmod(alias, 0o777);
  await assert.rejects(inspectJsExecutionNode(node), /not trusted/);
  await rm(alias); await symlink(node, alias);
  await assert.rejects(inspectJsExecutionNode(node), /canonical/);
});
