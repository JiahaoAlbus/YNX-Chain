import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectTrustedLocalPython } from './local-python-toolchain.mjs';
import { localWorkbenchEnvironment, localWorkbenchSandboxPolicy } from './local-workbench.mjs';
const exec = promisify(execFile);
test('rejects other roots without executing a project or system shim', async () => {
  for (const path of ['/usr', '/tmp', '/Library/Developer/CommandLineTools/../other']) assert.equal(await inspectTrustedLocalPython(path), null);
});
test('installed canonical CLT Python runs Hello World under the unchanged local sandbox with no xcrun cache errors', { skip: process.platform !== 'darwin' }, async () => {
  const python = await inspectTrustedLocalPython();
  assert.ok(python, 'This Mac regression requires the installed CLT interpreter');
  assert.ok(python.executable.startsWith('/Library/Developer/CommandLineTools/'));
  assert.equal(await realpath(python.executable), python.executable);
  const root = await realpath(await mkdtemp('/private/tmp/ynx-python-default-'));
  try {
    const context = { workspace: root, profile: root, temporary: root, id: 'python-default-test' }, runtime = { root };
    const env = localWorkbenchEnvironment({ node: process.execPath, runtime, context, plugins: root, gitConfig: '/dev/null', python });
    assert.equal(env.YNX_IDE_PYTHON_ENTRY, python.executable);
    assert.equal(env.DEVELOPER_DIR, '/Library/Developer/CommandLineTools');
    assert.equal(env.YNX_IDE_CLANGD_ENTRY, undefined);
    assert.equal(env.SDKROOT, undefined);
    const unavailable = localWorkbenchEnvironment({ node: process.execPath, runtime, context, plugins: root, gitConfig: '/dev/null', python: null, clangd: null });
    assert.equal(unavailable.DEVELOPER_DIR, undefined);
    const independentClangd = localWorkbenchEnvironment({ node: process.execPath, runtime, context, plugins: root, gitConfig: '/dev/null', clangd: { executable: '/Library/Developer/CommandLineTools/usr/bin/clangd', sysroot: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk' } });
    assert.equal(independentClangd.DEVELOPER_DIR, '/Library/Developer/CommandLineTools');
    assert.equal(independentClangd.SDKROOT, '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk');
    const policy = localWorkbenchSandboxPolicy({ node: process.execPath, lockHelper: process.execPath, runtime, context, port: 43177 });
    assert.ok(policy.includes('(deny network*)'));
    assert.ok(!policy.includes('(allow file-write* (subpath "/var/folders'));
    const file = join(root, 'hello.py'); await writeFile(file, 'print("Hello Python", 42)\n');
    const result = await exec('/usr/bin/sandbox-exec', ['-p', policy, python.executable, file], { env, timeout: 10000 });
    assert.equal(result.stdout.trim(), 'Hello Python 42');
    assert.equal(result.stderr, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});
