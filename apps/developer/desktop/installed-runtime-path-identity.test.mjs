import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, chmod, rename, chown, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
// Exercise the shipped module at the real standard installation parent without
// touching an existing app, project, settings, or system directory permissions.
test('installed read-only runtime admits standard Applications; projects and writable descendants remain guarded', { skip: process.platform !== 'darwin' }, async () => {
  const base = await mkdtemp('/Applications/YNX-Path-QA-');
  await chmod(base, 0o755);
  // The entry must be a direct Applications child, as normal drag-install is.
  const installed = base + '.app';
  await rename(base, installed);
  const resources = join(installed, 'Contents/Resources'), runtime = join(resources, 'runtime');
  const modulePath = join(resources, 'code/apps/developer/desktop/workspace-path-identity.mjs');
  await mkdir(runtime, { recursive: true }); await mkdir(join(resources, 'code/apps/developer/desktop'), { recursive: true });
  await mkdir(join(installed, 'Contents/MacOS'));
  const helper = join(runtime, 'workspace-path-identity');
  await exec('/Library/Developer/CommandLineTools/usr/bin/clang', ['-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk','-Wall','-Wextra','-Werror',fileURLToPath(new URL('./macos/workspace-path-identity.c', import.meta.url)), '-o', helper]);
  await copyFile(helper, join(runtime, 'ynx-local-workbench-lock'));
  await copyFile(helper, join(installed, 'Contents/MacOS/Fixture'));
  await copyFile(fileURLToPath(new URL('./workspace-path-identity.mjs', import.meta.url)), modulePath);
  const bootstrap = join(resources, 'code/apps/developer/desktop/local-debugpy-bootstrap.py');
  await copyFile(fileURLToPath(new URL('./local-debugpy-bootstrap.py', import.meta.url)), bootstrap);
  const workbenchSource = await readFile(new URL('./local-workbench.mjs', import.meta.url), 'utf8');
  const workbenchModule = join(resources, 'code/apps/developer/desktop/local-workbench.mjs');
  // Preserve production function bodies; route sibling dependencies to their
  // real source, while the installed path verifier remains the signed fixture.
  await writeFile(workbenchModule, workbenchSource.replace(/from '([^']+)'/g, (whole, specifier) => specifier.startsWith('.') && specifier !== './workspace-path-identity.mjs' ? `from '${new URL(specifier, new URL('./local-workbench.mjs', import.meta.url)).href}'` : whole));
  await writeFile(join(resources, 'build-provenance.json'), JSON.stringify({productId:'ynx-developer-v1',sourceDirty:false,platform:`macos-${process.arch}`}));
  await writeFile(join(installed, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.ynx.path-fixture</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  await exec('/usr/bin/codesign', ['--force','--deep','--sign','-',installed]);
  const shipped = await import(pathToFileURL(modulePath));
  await assert.rejects(shipped.inspectWorkspacePathIdentity({helper,path:runtime}), /unsafe writable/);
  const workbench = await import(pathToFileURL(workbenchModule));
  await assert.rejects(workbench.localWorkbenchPathIdentities({helper, node:join(runtime,'node'), lockHelper:join(runtime,'ynx-local-workbench-lock'), runtime:{root:'/System'}, context:{workspace:runtime,profile:'/System',temporary:'/System'}}), /unsafe writable/);
  const proof = await shipped.inspectBundledRuntimePathIdentity({helper,path:runtime});
  await shipped.assertWorkspacePathIdentity(proof);
  const bootstrapProof = await shipped.inspectBundledRuntimePathIdentity({helper,path:bootstrap});
  await shipped.assertWorkspacePathIdentity(bootstrapProof);
  await assert.rejects(shipped.inspectBundledRuntimePathIdentity({helper,path:resources}), /restricted/);
  await assert.rejects(shipped.inspectWorkspacePathIdentity({helper,path:resources,installationParent:proof.identity}), /unsafe writable/);
  const old = await lstat(runtime);
  const otherGroup = process.getgroups().find(gid => gid !== old.gid);
  if (otherGroup !== undefined) {
    await chown(runtime, old.uid, otherGroup);
    await assert.rejects(shipped.assertWorkspacePathIdentity(proof), /replaced/);
    await chown(runtime, old.uid, old.gid);
  }
  await chmod(runtime, 0o777);
  await assert.rejects(shipped.assertWorkspacePathIdentity(proof), /replaced/);
  await assert.rejects(shipped.inspectBundledRuntimePathIdentity({helper,path:join(runtime,'ynx-local-workbench-lock')}));
  await chmod(runtime, 0o755);
  await writeFile(modulePath, '\n// corrupt signed resources\n', {flag:'a'});
  await assert.rejects(shipped.inspectBundledRuntimePathIdentity({helper,path:runtime}));
  await assert.rejects(shipped.assertWorkspacePathIdentity(proof));
  console.log('Retained isolated installation fixture:', installed);
});
