import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rename, symlink, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectWorkspacePathIdentity, assertWorkspacePathIdentity } from './workspace-path-identity.mjs';
import { localWorkbenchSandboxPolicy } from './local-workbench.mjs';
const exec = promisify(execFile), helper = '/private/tmp/ynx-workspace-path-identity-test-' + process.pid;
const native = process.platform === 'darwin';
if (native) await exec('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('./macos/workspace-path-identity.c', import.meta.url)), '-o', helper]);
const quote = p => JSON.stringify(p);
test('real external APFS selected project works under the same policy; siblings and parent contents stay denied', { skip: !native }, async () => {
 const base = await mkdtemp('/Volumes/Data/private/tmp/ynx-vnode-project-');
 const project = join(base, 'selected'), sibling = join(base, 'unselected'); await mkdir(project); await mkdir(sibling);
 await writeFile(join(project, 'input.txt'), 'selected'); await writeFile(join(sibling, 'private.txt'), 'sibling'); await writeFile(join(base, 'parent.txt'), 'parent');
 const support = await mkdtemp('/private/tmp/ynx-vnode-support-'); const profile = join(support, 'profile'), temporary = join(support, 'temp'), runtime = join(support, 'runtime'); for (const p of [profile, temporary, runtime]) await mkdir(p);
 const proof = await inspectWorkspacePathIdentity({ helper, path: await realpath(project) });
 assert.equal(proof.paths.length, 2); assert.ok(proof.paths.some(p => p.startsWith('/Volumes/Macintosh HD/')));
 const policy = localWorkbenchSandboxPolicy({ node: process.execPath, lockHelper: helper, runtime: { root: runtime }, context: { workspace: project, profile, temporary }, port: 12345 }) + '\n' + proof.paths.map(p => `(allow file-read* file-write* (subpath ${quote(p)}))`).join('\n') + '\n' + proof.ancestors.map(p => `(allow file-read-metadata (literal ${quote(p)}))`).join('\n');
 await assertWorkspacePathIdentity(proof);
 const ok = await exec('/usr/bin/sandbox-exec', ['-p', policy, '/bin/sh', '-c', 'cat "$1/input.txt"; printf changed > "$1/output.txt"', 'sh', project]); assert.equal(ok.stdout, 'selected'); assert.equal(await readFile(join(project, 'output.txt'), 'utf8'), 'changed');
 for (const path of [join(sibling, 'private.txt'), join(base, 'parent.txt')]) {
  await assert.rejects(exec('/usr/bin/sandbox-exec', ['-p', policy, '/bin/cat', path]));
  await assert.rejects(exec('/usr/bin/sandbox-exec', ['-p', policy, '/bin/sh', '-c', 'printf overwritten > "$1"', 'sh', path]));
 }
 await assert.rejects(exec('/usr/bin/sandbox-exec', ['-p', policy, '/bin/ls', base]));
});
test('replacement, symbolic link, writable ancestry and forged JSON evidence reject', { skip: !native }, async () => {
 const root = await mkdtemp('/private/tmp/ynx-vnode-guards-'), parent = join(root, 'parent'), project = join(parent, 'project'); await mkdir(parent); await mkdir(project);
 const proof = await inspectWorkspacePathIdentity({ helper, path: project });
 await assert.rejects(assertWorkspacePathIdentity(JSON.parse(JSON.stringify(proof))), /Untrusted/);
 await rename(project, project + '-retained'); await mkdir(project); await assert.rejects(assertWorkspacePathIdentity(proof), /replaced/);
 await symlink(project, join(parent, 'link')); await assert.rejects(inspectWorkspacePathIdentity({ helper, path: join(parent, 'link') }), /canonical/);
 await chmod(parent, 0o777); await assert.rejects(inspectWorkspacePathIdentity({ helper, path: project }), /unsafe/); await chmod(parent, 0o755);
 const stable = await inspectWorkspacePathIdentity({ helper, path: project }); await rename(parent, parent + '-retained'); await mkdir(parent); await mkdir(project); await assert.rejects(assertWorkspacePathIdentity(stable), /replaced/);
});
