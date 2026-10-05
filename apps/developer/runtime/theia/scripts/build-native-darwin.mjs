import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build only the pinned official drivelist source in this owned runtime.
// Use installed Command Line Tools directly; never select Xcode, accept a
// license, install a global toolchain or run dependency lifecycle scripts.
if (process.platform !== 'darwin') throw Error('This helper is for macOS only.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependency = join(root, 'node_modules/drivelist');
const metadata = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8'));
if (metadata.name !== 'drivelist' || metadata.version !== '12.0.2') throw Error('Unexpected native dependency pin.');
const headers = process.argv[2];
if (!headers || !headers.startsWith('/')) throw Error('Provide the absolute installed Node header directory.');
await readFile(join(headers, 'node_api.h'));
const sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
const compilerRoot = '/Library/Developer/CommandLineTools/usr/bin';
const minimumOS = '13.5';
const target = `-mmacosx-version-min=${minimumOS}`;
const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
// A separate small output supports compatibility qualification without changing
// the compiled workbench or its source/cache receipt.
const qualification = process.argv[3];
if (qualification && (!qualification.startsWith(resolve(root, '../../.ynx-developer-candidates') + '/') || resolve(qualification) !== qualification)) throw Error('Use an owned native qualification output.');
const output = qualification || join(dependency, 'build/Release');
await mkdir(output, { recursive: !qualification });
const common = ['-fPIC', '-arch', architecture, '-isysroot', sdk,
  target, '-DNAPI_VERSION=8', '-I', headers, '-I', join(root, 'node_modules/node-addon-api'), '-I', dependency];
const sources = ['src/drivelist.cpp', 'src/device-descriptor.cpp', 'src/darwin/list.mm', 'src/darwin/REDiskList.m'];
const objects = [];
function run(command, args) {
  const result = spawnSync(command, args, { cwd: dependency, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`${command} failed: ${result.stderr || result.error}`);
}
function verifyTarget(path) {
  const result = spawnSync('/usr/bin/otool', ['-arch', architecture, '-l', path], { encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.match(/\bminos ([\d.]+)/)?.[1] !== minimumOS) throw Error('Native image does not match its measured deployment target.');
}
for (let index = 0; index < sources.length; index++) {
  const object = join(output, `drivelist-${index}.o`);
  const objectiveC = sources[index].endsWith('.m');
  run(join(compilerRoot, objectiveC ? 'clang' : 'clang++'), [...common, ...objectiveC ? [] : ['-std=c++17', '-stdlib=libc++'], '-c', sources[index], '-o', object]);
  objects.push(object);
}
const artifact = join(output, 'drivelist.node');
run(join(compilerRoot, 'clang++'), ['-bundle', '-undefined', 'dynamic_lookup', '-isysroot', sdk, target, '-arch', architecture, '-stdlib=libc++', ...objects,
  '-framework', 'Carbon', '-framework', 'DiskArbitration', '-framework', 'Foundation', '-o', artifact]);
verifyTarget(artifact);
const sha256 = createHash('sha256').update(await readFile(artifact)).digest('hex');
await writeFile(join(output, 'ynx-build-receipt.json'), JSON.stringify({ dependency: `${metadata.name}@${metadata.version}`, platform: process.platform,
  arch: process.arch, node: process.version, napi: 8, minimumOS, sources, sha256, lifecycleScriptsExecuted: false }, null, 2));
console.log(JSON.stringify({ artifact, sha256 }));
const helper = qualification ? join(qualification, 'ynx-process-tree') : join(root, 'lib/backend/ynx-process-tree');
await mkdir(dirname(helper), { recursive: true });
const helperSource = resolve(root, '../ynx-workbench/native/process-tree.c');
run(join(compilerRoot, 'clang'), ['-std=c17', '-Wall', '-Wextra', '-Werror', '-isysroot', sdk, target, '-arch', architecture, helperSource, '-o', helper]);
verifyTarget(helper);
const helperHash = createHash('sha256').update(await readFile(helper)).digest('hex');
await writeFile(`${helper}.receipt.json`, JSON.stringify({ source: helperSource, sourceSha256: createHash('sha256').update(await readFile(helperSource)).digest('hex'),
  platform: process.platform, arch: process.arch, minimumOS, sha256: helperHash, elevatedPrivileges: false }, null, 2));
console.log(JSON.stringify({ helper, sha256: helperHash }));
