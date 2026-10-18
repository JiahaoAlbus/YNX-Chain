import { readdir, lstat, readlink, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve, posix } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createDmgMountWorkspace } from './package-macos-branding.mjs';
export async function hashFile(path) {
  const hash = createHash('sha256'); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest('hex');
}
export async function wholeInventory(root) {
  const rows = [];
  async function walk(prefix = '') {
    for (const name of (await readdir(join(root, prefix))).sort()) {
      const path = prefix ? prefix + '/' + name : name, file = join(root, path), stat = await lstat(file);
      const row = { path, mode: stat.mode & 0o7777, type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'unsupported' };
      if (row.type === 'unsupported') throw Error('Unsupported whole-App entry');
      if (row.type === 'file') { row.bytes = stat.size; row.sha256 = await hashFile(file); }
      if (row.type === 'symlink') {
        row.target = await readlink(file); const target = posix.normalize(posix.join(posix.dirname(path), row.target));
        if (row.target.startsWith('/') || row.target.includes('\\') || target === '..' || target.startsWith('../')) throw Error('Whole-App link escapes');
      }
      rows.push(row); if (row.type === 'directory') await walk(path);
    }
  }
  await walk(); return rows;
}
export function assertSameInventory(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(label + ' whole inventory differs');
}
export function safeCoreArchiveListing(names, details) {
  if (!names.length || names.length > 100000 || names.some(p => p.startsWith('/') || p.includes('\\') || p.split('/').includes('..')) ||
      details.length !== names.length || details.some(p => !['-', 'd'].includes(p[0]))) throw Error('Core archive has unsupported paths or links');
}
export async function verifyNormalMacRelease({ app, dmg, core, corePin, source, output }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Normal readback requires actual Mac arm64');
  for (const path of [app, dmg, core, corePin, source]) if (resolve(path) !== path || await realpath(path) !== path) throw Error('Canonical readback input required');
  if (resolve(output) !== output || [app, core].some(p => output === p || output.startsWith(p + '/'))) throw Error('Readback output must be fresh and disjoint');
  await mkdir(output, { mode: 0o700 });
  const record = { state: 'NORMAL_WHOLE_APP_READBACK_STARTED', app, dmg, core, source,
    nativeGUI: 'NOT_VERIFIED', publication: 'NOT_EXECUTED', fullGoalComplete: false };
  const save = () => writeFile(join(output, 'whole-app-readback.json'), JSON.stringify(record, null, 2) + '\n');
  await save();
  const temporary = join(output, 'temporary');
  let mountWorkspace, mount;
  let mounted = false, mountAttempted = false;
  try {
    const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: source, encoding: 'utf8' }).trim();
    const head = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}');
    if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Readback source has uncommitted tracked changes');
    const resources = join(app, 'Contents/Resources'), provenance = JSON.parse(await readFile(join(resources, 'build-provenance.json')));
    if (provenance.sourceCommit !== head || provenance.sourceTree !== tree) throw Error('App/source commit-tree mismatch');
    const { validateRuntimeArtifact, verifyComposedRuntime, sameRuntimeArtifact } = await import(pathToFileURL(join(source, 'apps/developer/services/codeoss-service/src/composed-runtime.mjs')));
    const pin = validateRuntimeArtifact(JSON.parse(await readFile(corePin)));
    await verifyComposedRuntime(core, pin);
    const distribution = JSON.parse(await readFile(join(resources, 'composed-core/distribution.json')));
    if (distribution.archive !== 'workbench.tar' || distribution.roundTripTreeVerified !== true ||
        !sameRuntimeArtifact(distribution.runtimeArtifact, pin) || !sameRuntimeArtifact(provenance.composedCoreDistribution?.runtimeArtifact, pin))
      throw Error('App/current composed pin mismatch');
    const archive = join(resources, 'composed-core/workbench.tar');
    if (await hashFile(archive) !== distribution.archiveSha256) throw Error('App archive hash differs');
    const { verifySealedCanonicalNativeModule } = await import(pathToFileURL(join(source, 'apps/developer/scripts/package-identity-admission-source.mjs')));
    await verifySealedCanonicalNativeModule(resources);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
    const before = await wholeInventory(app);
    await writeFile(join(output, 'whole-app-manifest.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
    Object.assign(record, { sourceCommit: head, sourceTree: tree, composedPin: pin,
      minimumOS: provenance.minimumOS, signingClass: provenance.signingClass, olderOSExecution: 'NOT_VERIFIED',
      dmg: { path: dmg, bytes: (await lstat(dmg)).size, sha256: await hashFile(dmg) },
      appInventory: { entries: before.length, files: before.filter(p => p.type === 'file').length,
        symlinks: before.filter(p => p.type === 'symlink').length, sha256: await hashFile(join(output, 'whole-app-manifest.json')) } });
    await mkdir(temporary, { mode: 0o700 });
    // Use the same validated, UID-owned system-temp mount view as the normal
    // DMG producer. Large inventories and core extraction stay on the build
    // volume; no image bytes or executable payload are copied to system temp.
    mountWorkspace = await createDmgMountWorkspace();
    mount = join(mountWorkspace, 'mount');
    record.mountWorkspace = mountWorkspace;
    await mkdir(mount, { mode: 0o700 });
    mountAttempted = true; record.mountState = 'ATTACH_ENTERED'; await save();
    execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { stdio: 'pipe' });
    mounted = true; record.mountState = 'MOUNTED';
    assertSameInventory(await wholeInventory(join(mount, app.split('/').at(-1))), before, 'Mounted App');
    record.mountedWholeAppExact = true;
    execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'pipe' });
    mounted = false; record.mountState = 'DETACHED';
    const names = execFileSync('/usr/bin/tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n').filter(Boolean);
    const details = execFileSync('/usr/bin/tar', ['-tvf', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
    safeCoreArchiveListing(names, details);
    const extract = join(temporary, 'core'); await mkdir(extract, { mode: 0o700 });
    execFileSync('/usr/bin/tar', ['-xpf', archive, '-C', extract], { env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' }, stdio: 'pipe' });
    await verifyComposedRuntime(extract, pin);
    const expected = await wholeInventory(core);
    assertSameInventory(await wholeInventory(extract), expected, 'Archived current core');
    record.archivedCore = { entries: expected.length, exact: true };
    assertSameInventory(await wholeInventory(app), before, 'App after readback');
    record.appUnchanged = true;
    await rm(temporary, { recursive: true });
    await rm(mountWorkspace, { recursive: true });
    record.successfulOwnedScratchRemoved = true; record.state = 'NORMAL_SAME_SOURCE_WHOLE_APP_DMG_CORE_READBACK_PASS';
    await save(); return record;
  } catch (error) {
    record.state = 'NORMAL_WHOLE_APP_READBACK_FAILED_FIRST_CAUSE_RETAINED';
    record.firstFailure = { name: error.name, message: error.message, code: error.code };
    if (mounted) {
      try { execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'pipe' }); record.mountState = 'DETACHED_AFTER_FAILURE'; }
      catch (cleanup) { record.cleanupUnknown = true; record.cleanupFailure = cleanup.message; }
    } else if (mountAttempted && record.mountState !== 'DETACHED') record.cleanupUnknown = true;
    // Failed/uncertain artifacts remain. Never delete a possibly mounted tree.
    await save(); throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [app, dmg, core, corePin, source, output] = process.argv.slice(2);
  console.log(JSON.stringify(await verifyNormalMacRelease({ app, dmg, core, corePin, source, output })));
}
