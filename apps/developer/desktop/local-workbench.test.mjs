import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath, lstat, chmod, link } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { localProjectContext, prepareLocalRuntime, prepareLocalPlugins, findTrustedLocalGit, inspectTrustedLocalGit, inspectTrustedLocalClangd, prepareLocalGitConfig, localWorkbenchSandboxPolicy, localWorkbenchEnvironment } from './local-workbench.mjs';
import { createRequire } from 'node:module';
const { cppProjectRoot } = createRequire(import.meta.url)('../native/ynx-cpp/src/project-root.cjs');
import { composedTreeDigest } from '../services/codeoss-service/src/composed-runtime.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(task) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-local-workbench-test-')));
  try { await task(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function payload(root, unsafe = false) {
  const source = join(root, 'source'), out = join(root, 'payload'); await mkdir(source); await mkdir(out);
  await writeFile(join(source, 'package-lock.json'), '{}');
  await mkdir(join(source, 'plugins/example'), { recursive: true });
  await writeFile(join(source, 'plugins/example/extension.js'), 'module.exports = {};');
  if (process.platform === 'darwin') {
    await mkdir(join(source, 'lib/backend'), { recursive: true });
    execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk', '-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('../runtime/ynx-workbench/native/process-tree.c', import.meta.url)), '-o', join(source, 'lib/backend/ynx-process-tree')]);
  }
  if (unsafe) await symlink('/etc/passwd', join(source, 'escape'));
  const pin = { kind: 'ynx-theia', version: '1.76.0', architecture: `darwin-${process.arch}`, lockSha256: digest('{}'), treeSha256: unsafe ? 'a'.repeat(64) : await composedTreeDigest(source) };
  const manifest = { ...pin, entry: 'lib/backend/main.js', frontend: 'lib/frontend/index.html', nodeVersion: '26.0.0' };
  const bytes = JSON.stringify(manifest); await writeFile(join(source, 'YNX-COMPOSED-RUNTIME.json'), bytes); pin.manifestSha256 = digest(bytes);
  execFileSync('/usr/bin/tar', ['-cf', join(out, 'workbench.tar'), '-C', source, '.'], { env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' } });
  await writeFile(join(out, 'workbench.pin.json'), JSON.stringify(pin));
  await writeFile(join(out, 'distribution.json'), JSON.stringify({ schemaVersion: 1, archive: 'workbench.tar', archiveSha256: digest(await readFile(join(out, 'workbench.tar'))), runtimeArtifact: pin, roundTripTreeVerified: true, localWorkspace: { enabled: true, identity: 'OS-user local project only', canonicalAdmission: false } }));
  return out;
}
test('real sealed tar extracts, verifies immutable cache and rejects later cache corruption', async () => fixture(async root => {
  const input = { payload: await payload(root), supportRoot: join(root, 'support') };
  const first = await prepareLocalRuntime(input), second = await prepareLocalRuntime(input); assert.equal(first.root, second.root);
  await writeFile(join(first.root, 'unexpected'), 'changed'); await assert.rejects(prepareLocalRuntime(input), /reviewed artifact/);
  const metadata = join(input.payload, 'distribution.json'), original = JSON.parse(await readFile(metadata));
  for (const localWorkspace of [undefined, { ...original.localWorkspace, canonicalAdmission: true }, { ...original.localWorkspace, enabled: false }]) {
    await writeFile(metadata, JSON.stringify({ ...original, localWorkspace }));
    await assert.rejects(prepareLocalRuntime(input), /distribution is invalid/);
  }
}));
test('local Git selector refuses arbitrary tool roots and never executes a project Git substitute', async () => fixture(async root => {
  const marker = join(root, 'executed');
  await mkdir(join(root, 'usr/bin'), { recursive: true });
  await writeFile(join(root, 'usr/bin/git'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  for (const candidate of [root, '/usr', '/Applications', '/Library/Developer/CommandLineTools/../CommandLineTools', null]) assert.equal(await inspectTrustedLocalGit(candidate), null);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
}));
test('local C/C++ selects only installed CLT Clangd and runs under the unchanged production sandbox', async () => fixture(async root => {
  const marker = join(root, 'executed'); await mkdir(join(root, 'usr/bin'), { recursive: true });
  await writeFile(join(root, 'usr/bin/clangd'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  for (const candidate of [root, '/usr', '/Applications/Xcode.app/Contents/Developer', '/Library/Developer/CommandLineTools/../CommandLineTools', null]) assert.equal(await inspectTrustedLocalClangd(candidate), null);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
  const clangd = await inspectTrustedLocalClangd('/Library/Developer/CommandLineTools'); assert.ok(clangd, 'Installed trusted CLT Clangd is required for this macOS check');
  const workspace = join(root, 'project'); await mkdir(workspace);
  const context = await localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: workspace });
  const runtime = { root: join(root, 'runtime') }; await mkdir(runtime.root);
  const input = { node: '/usr/bin/true', lockHelper: '/usr/bin/true', runtime, context, plugins: runtime.root, port: 43119 };
  const env = localWorkbenchEnvironment({ ...input, clangd });
  assert.equal(cppProjectRoot(env), workspace); assert.equal(env.YNX_CORE_WORKSPACE, undefined); assert.equal(env.YNX_CORE_SESSION_ID, undefined);
  assert.equal(env.YNX_IDE_CLANGD_ENTRY, clangd.executable); assert.equal(env.YNX_IDE_CPP_SYSROOT, clangd.sysroot);
  assert.equal(env.DEVELOPER_DIR, '/Library/Developer/CommandLineTools'); assert.equal(env.SDKROOT, clangd.sysroot);
  const withoutCompiler = localWorkbenchEnvironment(input);
  assert.equal(withoutCompiler.DEVELOPER_DIR, undefined); assert.equal(withoutCompiler.SDKROOT, undefined);
  const policy = localWorkbenchSandboxPolicy(input); assert.equal(policy, localWorkbenchSandboxPolicy({ ...input, clangd }));
  const run = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, clangd.executable, '--version'], { cwd: workspace, env, encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /^Apple clangd version/);
  for (const changed of [{ YNX_CORE_WORKSPACE: workspace }, { YNX_CORE_SESSION_ID: context.id }, { YNX_LOCAL_PROJECT_ID: 'invalid' }, { YNX_LOCAL_WORKSPACE: '../project' }]) assert.equal(cppProjectRoot({ ...env, ...changed }), undefined);
  assert.equal(cppProjectRoot({ YNX_CORE_WORKSPACE: workspace }), workspace);
  assert.equal(cppProjectRoot({ YNX_CORE_WORKSPACE: workspace, YNX_LOCAL_WORKSPACE: workspace }), undefined);
}));
test('private per-project Git configuration persists and damaged files are retained and refused', async () => fixture(async root => {
  const profile = join(root, 'profile'); await mkdir(profile, { mode: 0o700 });
  const context = { profile }, path = await prepareLocalGitConfig(context);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  await writeFile(path, '[user]\n name = Local Author\n');
  assert.equal(await prepareLocalGitConfig(context), path); assert.match(await readFile(path, 'utf8'), /Local Author/);
  await chmod(path, 0o644); await assert.rejects(prepareLocalGitConfig(context), /private regular/); assert.match(await readFile(path, 'utf8'), /Local Author/);
  await chmod(path, 0o600); await link(path, join(profile, 'other-link')); await assert.rejects(prepareLocalGitConfig(context), /private regular/);
  const aliasProfile = join(root, 'alias-profile'); await mkdir(aliasProfile, { mode: 0o700 }); await symlink(path, join(aliasProfile, 'gitconfig'));
  await assert.rejects(prepareLocalGitConfig({ profile: aliasProfile }), /canonical regular/); assert.match(await readFile(path, 'utf8'), /Local Author/);
}));
test('actual production sandbox discovers real Git and preserves local-only repository/configuration flows', async () => fixture(async root => {
  const git = await findTrustedLocalGit(); assert.ok(git, 'A verified installed OS Git is required for this actual macOS check'); assert.notEqual(git.executable, '/usr/bin/git');
  const workspace = join(root, 'project'), other = join(root, 'other-project'); await mkdir(workspace); await mkdir(other);
  const context = await localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: workspace });
  const second = await localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: other });
  const gitConfig = await prepareLocalGitConfig(context), otherConfig = await prepareLocalGitConfig(second);
  const runtime = { root: join(root, 'runtime') }; await mkdir(runtime.root);
  const node = '/usr/bin/true', lockHelper = '/usr/bin/true', port = 43119;
  const policy = localWorkbenchSandboxPolicy({ node, lockHelper, runtime, context, port, git });
  const env = localWorkbenchEnvironment({ node, runtime, context, plugins: runtime.root, git, gitConfig });
  assert.equal(env.GIT_CONFIG_GLOBAL, gitConfig); assert.equal(env.GIT_CONFIG_NOSYSTEM, '1'); assert.equal(env.PATH.split(':')[0], git.directory);
  assert.ok(!policy.includes('(subpath "/Applications")') && !policy.includes('(subpath "/Users")')); assert.match(policy, /\(deny network\*\)/);
  const run = (args, executable = git.executable) => spawnSync('/usr/bin/sandbox-exec', ['-p', policy, executable, ...args], { cwd: workspace, env, encoding: 'utf8', timeout: 5000 });
  const ok = args => { const result = run(args); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  assert.match(ok(['--version']), /^git version /); const discovery = run(['git', '--version'], '/usr/bin/env'); assert.equal(discovery.status, 0, discovery.stderr); assert.match(discovery.stdout, /^git version /);
  const unavailablePolicy = localWorkbenchSandboxPolicy({ node, lockHelper, runtime, context, port, git: null });
  const unavailableEnv = localWorkbenchEnvironment({ node, runtime, context, plugins: runtime.root, git: null, gitConfig });
  const unavailable = spawnSync('/usr/bin/sandbox-exec', ['-p', unavailablePolicy, '/usr/bin/env', 'git', '--version'], { cwd: workspace, env: unavailableEnv, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(unavailable.status, 0); assert.match(unavailable.stderr, /Operation not permitted/); assert.doesNotMatch(unavailable.stderr, /requesting install|xcode-select/);
  assert.match(run(['-c', 'user.name=Local Test', '-c', 'user.email=local@example.invalid', 'init']).stdout, /Initialized/);
  await writeFile(join(workspace, 'hello.txt'), 'local content\n'); ok(['add', 'hello.txt']); ok(['-c', 'user.name=Local Test', '-c', 'user.email=local@example.invalid', 'commit', '-m', 'Local sandbox verification']);
  assert.equal(ok(['status', '--porcelain']), ''); assert.match(ok(['show', 'HEAD:hello.txt']), /local content/);
  ok(['config', '--global', 'user.name', 'Persistent Local Author']); ok(['config', '--global', 'user.email', 'persistent@example.invalid']);
  assert.equal((await lstat(gitConfig)).mode & 0o777, 0o600); assert.equal(await prepareLocalGitConfig(context), gitConfig); assert.match(ok(['config', '--global', '--get', 'user.name']), /Persistent Local Author/); assert.equal(await readFile(otherConfig, 'utf8'), '');
  await writeFile(join(workspace, 'hello.txt'), 'changed\n'); assert.match(ok(['status', '--porcelain']), /M hello.txt/);
  await writeFile(join(other, 'outside-secret'), 'private other project'); const readOutside = run([join(other, 'outside-secret')], '/bin/cat'); assert.notEqual(readOutside.status, 0); assert.match(readOutside.stderr, /Operation not permitted/);
  const sockets = new Set();
  const listening = createServer(socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.resume(); socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK'); });
  await new Promise((ok, fail) => { listening.once('error', fail); listening.listen(0, '127.0.0.1', ok); });
  try {
    const url = `http://127.0.0.1:${listening.address().port}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); assert.equal(response.status, 200); assert.equal(await response.text(), 'OK'); // prove destination is live before testing refusal
    const egress = run(['--connect-timeout', '1', '--max-time', '2', url], '/usr/bin/curl'); assert.notEqual(egress.status, 0); assert.notEqual(egress.stdout, 'OK'); assert.match(egress.stderr, /Operation not permitted|Failed to connect/);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise(ok => listening.close(ok)); }
}));
test('archive digest mismatch and archive symlinks refuse execution inputs', async () => fixture(async root => {
  const out = await payload(root, true); await assert.rejects(prepareLocalRuntime({ payload: out, supportRoot: join(root, 'support') }), /unsupported paths/);
  await writeFile(join(out, 'workbench.tar'), 'tampered'); await assert.rejects(prepareLocalRuntime({ payload: out, supportRoot: join(root, 'support') }), /archive changed/);
}));
test('actual local project binding persists without Wallet identity and refuses conflicting profile', async () => fixture(async root => {
  const supportRoot = join(root, 'support'), projectDirectory = join(root, 'project'); await mkdir(projectDirectory);
  const first = await localProjectContext({ supportRoot, projectDirectory }), next = await localProjectContext({ supportRoot, projectDirectory }); assert.deepEqual(next, first);
  const path = join(first.profile, 'ynx-local-project.json');
  assert.deepEqual(JSON.parse(await readFile(path)), { schemaVersion: 1, projectId: first.id, workspace: projectDirectory, profile: first.profile });
  await writeFile(path, JSON.stringify({ schemaVersion: 1, projectId: first.id, workspace: '/another', profile: first.profile }));
  await assert.rejects(localProjectContext({ supportRoot, projectDirectory }), /another workspace/);
}));
test('symlinked project and nonprivate support state are refused', async () => fixture(async root => {
  const project = join(root, 'project'); await mkdir(project); await symlink(project, join(root, 'alias'));
  await assert.rejects(localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: join(root, 'alias') }), /canonical/);
  const exposed = join(root, 'exposed'); await mkdir(exposed, { mode: 0o755 });
  await assert.rejects(localProjectContext({ supportRoot: exposed, projectDirectory: project }), /private/);
}));
test('real native fd lock excludes a second backend and releases after backend exit', async () => fixture(async root => {
  const helper = join(root, 'local-lock'), profile = join(root, 'profile'), node = await realpath(process.execPath);
  await mkdir(profile, { mode: 0o700 });
  execFileSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('./macos/local-workbench-lock.c', import.meta.url)), '-o', helper]);
  const first = spawn(helper, [profile, node, '-e', 'console.log("locked");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(first, 'close');
  try {
    const [ready] = await once(first.stdout, 'data'); assert.match(String(ready), /locked/);
    const refused = spawnSync(helper, [profile, node, '-e', 'console.log("unexpected")'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(refused.status, 73); assert.equal(refused.stdout, ''); assert.match(refused.stderr, /already open/);
    first.kill('SIGKILL'); await closed;
    const reopened = spawnSync(helper, [profile, node, '-e', 'console.log("reopened")'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(reopened.status, 0, reopened.stderr); assert.match(reopened.stdout, /reopened/);
    const secondProfile = join(root, 'other-profile'); await mkdir(secondProfile, { mode: 0o700 });
    await symlink(join(profile, 'local-workbench.lock'), join(secondProfile, 'local-workbench.lock'));
    assert.equal(spawnSync(helper, [secondProfile, node, '-e', 'process.exit(0)']).status, 65);
  } finally { if (first.exitCode === null && first.signalCode === null) { first.kill('SIGKILL'); await closed; } }
}));

test('fresh verified project plugin copies allow runtime state under existing sandbox without writing sealed cache', async () => fixture(async root => {
  const runtime = await prepareLocalRuntime({ payload: await payload(root), supportRoot: join(root, 'support') });
  const project = join(root, 'project'); await mkdir(project);
  const context = await localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: project });
  const sourceDigest = await composedTreeDigest(join(runtime.root, 'plugins'));
  const first = await prepareLocalPlugins({ runtime, context });
  const policy = localWorkbenchSandboxPolicy({ node: '/usr/bin/true', lockHelper: '/usr/bin/true', runtime, context, port: 43119, git: null });
  execFileSync('/usr/bin/sandbox-exec', ['-p', policy, '/bin/mkdir', join(first, 'example/.runtime-endpoints')]);
  assert.throws(() => execFileSync('/usr/bin/sandbox-exec', ['-p', policy, '/bin/mkdir', join(runtime.root, 'plugins/example/.runtime-endpoints')], { stdio: 'pipe' }));
  assert.equal(await composedTreeDigest(join(runtime.root, 'plugins')), sourceDigest);
  await writeFile(join(first, 'example/extension.js'), 'changed runtime copy');
  const second = await prepareLocalPlugins({ runtime, context });
  assert.notEqual(first, second); assert.equal(await readFile(join(second, 'example/extension.js'), 'utf8'), 'module.exports = {};');
  assert.equal(await composedTreeDigest(second), sourceDigest);
}));
test('plugin lifecycle releases one verified copy without removing sibling sessions', async () => fixture(async root => {
  const runtime = await prepareLocalRuntime({ payload: await payload(root), supportRoot: join(root, 'support') });
  const project = join(root, 'project'); await mkdir(project);
  const context = await localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: project });
  const first = await prepareLocalPlugins({ runtime, context });
  const second = await prepareLocalPlugins({ runtime, context });
  const owned = await prepareLocalPlugins({ runtime, context, lifecycle: true });
  owned.beginLaunch(); assert.equal(await owned.cleanup(), false);
  assert.equal(await owned.cleanup({ confirmedSessionExited: true }), true);
  await assert.rejects(lstat(owned.plugins), { code: 'ENOENT' });
  assert.equal(await readFile(join(second, 'example/extension.js'), 'utf8'), 'module.exports = {};');
  assert.equal(await readFile(join(first, 'example/extension.js'), 'utf8'), 'module.exports = {};');
}));
test('plugin copies reject foreign project bindings and corrupted source before launch', async () => fixture(async root => {
  const runtime = await prepareLocalRuntime({ payload: await payload(root), supportRoot: join(root, 'support') });
  const project = join(root, 'project'); await mkdir(project);
  const context = await localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: project });
  await assert.rejects(prepareLocalPlugins({ runtime, context: { ...context, temporary: root } }), /outside the project/);
  await assert.rejects(prepareLocalPlugins({ runtime, context: { ...context, id: 'foreign-project' } }), /different project/);
  await writeFile(join(runtime.root, 'plugins/example/extension.js'), 'tampered');
  await assert.rejects(prepareLocalPlugins({ runtime, context }), /reviewed artifact/);
}));
