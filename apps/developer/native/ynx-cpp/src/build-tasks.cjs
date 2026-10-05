'use strict';
const { realpath, lstat, readlink, mkdir, open } = require('node:fs/promises');
const { constants } = require('node:fs');
const { join, dirname, isAbsolute } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');
const { parse } = require('jsonc-parser');
const CLT = '/Library/Developer/CommandLineTools';
async function trusted(path, directory = false) {
  if (!isAbsolute(path) || await realpath(path) !== path) throw Error('Compiler path is not canonical.');
  for (let item = path;; item = dirname(item)) {
    const stat = await lstat(item), isDirectory = item !== path || directory;
    if (stat.uid !== 0 || (stat.mode & 0o022) || stat.isSymbolicLink() ||
      (isDirectory ? !stat.isDirectory() : !stat.isFile() || !(stat.mode & 0o111)))
      throw Error('Compiler path is not a trusted installed system tool.');
    if (item === '/') break;
  }
}
async function installedCompiler({ clangd, sysroot, language }) {
  if ((clangd && clangd !== join(CLT, 'usr/bin/clangd')) || !isAbsolute(sysroot || ''))
    throw Error('This runtime has no supported local C/C++ compiler.');
  if (clangd) await trusted(clangd);
  const sdk = await realpath(sysroot);
  if (!sdk.startsWith(CLT + '/SDKs/')) throw Error('SDK is outside the installed system toolchain.');
  await trusted(sdk, true);
  const compiler = join(CLT, 'usr/bin', language === 'c' ? 'clang' : 'clang++');
  const compilerStat = await lstat(compiler);
  if (compilerStat.isSymbolicLink()) {
    // Apple's C++ driver is an OS-owned alias to clang; argv[0] selects C++
    // linking. Accept only that exact immutable alias and its trusted target.
    if (language === 'c' || compilerStat.uid !== 0 || await readlink(compiler) !== 'clang')
      throw Error('Unsupported compiler alias.');
    await trusted(join(CLT, 'usr/bin/clang'));
  } else await trusted(compiler);
  return { compiler, sdk, language: language === 'c' ? 'c' : 'cpp' };
}
function taskConfiguration(tool) {
  const build = 'YNX: Build active ' + (tool.language === 'c' ? 'C' : 'C++');
  return { version: '2.0.0', tasks: [
    { label: build, type: 'process', command: tool.compiler,
      args: [tool.language === 'c' ? '-std=c11' : '-std=c++17', '-fmessage-length=0', '-isysroot', tool.sdk, '-g', '-O0',
        '${file}', '-o', '${fileDirname}/${fileBasenameNoExtension}'],
      options: { cwd: '${fileDirname}' }, problemMatcher: ['$gcc'], group: { kind: 'build', isDefault: true },
      presentation: { reveal: 'always' } },
    { label: 'YNX: Run active ' + (tool.language === 'c' ? 'C' : 'C++'), type: 'process',
      command: '${fileDirname}/${fileBasenameNoExtension}', dependsOn: [build],
      options: { cwd: '${fileDirname}' }, problemMatcher: [], presentation: { reveal: 'always' } },
  ] };
}
async function createBuildTasks(root, tool) {
  if (!isAbsolute(root || '') || await realpath(root) !== root) throw Error('Project root is not canonical.');
  const selected = await existingConfiguration(root, 'tasks');
  if (selected) return { path: selected, created: false };
  const folder = join(root, '.vscode');
  try { await mkdir(folder, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(folder) !== folder)
    throw Error('Task configuration folder is outside this project.');
  const path = join(folder, 'tasks.json');
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink() || await realpath(path) !== path)
      throw Error('Existing task configuration is not a regular project file.');
    return { path, created: false };
  }
  try { await handle.writeFile(JSON.stringify(taskConfiguration(tool), null, 2) + '\n'); }
  finally { await handle.close(); }
  return { path, created: true };
}
async function existingConfiguration(root, name) {
  for (const directory of ['.theia', '.vscode']) {
    const folder = join(root, directory), path = join(folder, name + '.json');
    try {
      const parent = await lstat(folder);
      if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(folder) !== folder)
        throw Error('Configuration folder is outside this project.');
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path)
        throw Error('Existing task configuration is not a regular project file.');
      return path;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
// Only the complete persisted product configuration bypasses async discovery.
// Extra user fields and commented/custom configurations remain user tasks.
async function readGeneratedTasks(root, path, tool, expectedDigest) {
  if (await existingConfiguration(root, 'tasks') !== path) throw Error('Task configuration changed.');
  const snapshot = await readConfigurationSnapshot(path, expectedDigest);
  if (!snapshot) return undefined;
  let configuration;
  try { configuration = JSON.parse(snapshot.bytes.toString('utf8')); } catch { return undefined; }
  if (!isDeepStrictEqual(configuration, taskConfiguration(tool))) return undefined;
  return { configuration, digest: snapshot.digest };
}
async function readConfigurationSnapshot(path, expectedDigest) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 65536) return undefined;
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const after = await handle.stat(), current = await lstat(path);
    if (bytesRead !== before.size || before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.isSymbolicLink() ||
        after.size !== current.size || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs)
      throw Error('Task configuration changed.');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (expectedDigest && digest !== expectedDigest) throw Error('Task configuration changed.');
    return { bytes, digest };
  } finally { await handle.close(); }
}
async function createLaunchConfiguration(root, tasksPath, language, allowGenerated = false, expectedDigest) {
  const configuration = { type: 'lldb-dap', request: 'launch', name: 'YNX: Debug active ' + (language === 'c' ? 'C' : 'C++'),
    program: '${fileDirname}/${fileBasenameNoExtension}', cwd: '${fileDirname}',
    preLaunchTask: 'YNX: Build active ' + (language === 'c' ? 'C' : 'C++'), stopOnEntry: false,
    console: 'integratedTerminal' };
  const existing = await existingConfiguration(root, 'launch');
  if (existing) {
    const result = { path: existing, created: false };
    if (!allowGenerated) return result;
    const snapshot = await readConfigurationSnapshot(existing, expectedDigest);
    if (!snapshot) return result;
    const errors = [];
    const value = parse(snapshot.bytes.toString('utf8'), errors, { allowTrailingComma: true });
    // A normal mixed-language project may already have JS/Python targets. They
    // cannot debug this source, but must remain intact. With verified generated
    // build tasks, use an in-memory C/C++ target without creating a shadow file.
    // C/C++ and unknown adapter types remain authoritative, as do malformed
    // JSONC and top-level inputs/other custom fields. Recheck the byte digest
    // before launching so an intervening user edit cannot be silently ignored.
    const unrelatedTypes = new Set(['node', 'pwa-node', 'node-terminal', 'chrome', 'pwa-chrome', 'msedge', 'pwa-msedge', 'python', 'debugpy']);
    if (!errors.length && value?.version === '0.2.0' && Array.isArray(value.configurations) &&
        value.configurations.every(item => item && typeof item === 'object' && unrelatedTypes.has(item.type)) &&
        Object.keys(value).every(key => ['version', 'configurations'].includes(key))) {
      if (await existingConfiguration(root, 'launch') !== existing) throw Error('Launch configuration changed.');
      return { ...result, configuration, transient: true, digest: snapshot.digest };
    }
    return result;
  }
  if (expectedDigest) throw Error('Launch configuration changed.');
  const path = join(dirname(tasksPath), 'launch.json');
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return { path: await existingConfiguration(root, 'launch'), created: false }; }
  try { await handle.writeFile(JSON.stringify({ version: '0.2.0', configurations: [configuration] }, null, 2) + '\n'); }
  finally { await handle.close(); }
  return { path, created: true, configuration };
}
module.exports = { installedCompiler, taskConfiguration, createBuildTasks, existingConfiguration, createLaunchConfiguration, readGeneratedTasks };
