import { readFile, writeFile, mkdir, realpath, lstat, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyComposedRuntime, validateRuntimeArtifact } from '../services/codeoss-service/src/composed-runtime.mjs';

// Distribution payload only. The normal gateway continues to require the
// protected registered driver and canonical parent before any execution.
const [source, pinPath, output] = process.argv.slice(2);
for (const path of [source, pinPath, output]) if (!path || resolve(path) !== path) throw Error('Absolute canonical bundle inputs are required.');
if (await realpath(source) !== source || !(await lstat(source)).isDirectory() || await realpath(pinPath) !== pinPath) throw Error('Changed composed artifact location.');
const pinBytes = await readFile(pinPath), pin = validateRuntimeArtifact(JSON.parse(pinBytes));
if (pin.architecture !== `darwin-${process.arch}`) throw Error('Composed artifact architecture does not match this macOS package.');
const manifest = await verifyComposedRuntime(source, pin);
await mkdir(output, { mode: 0o755 }); // Never replace an existing payload.
const archive = join(output, 'workbench.tar');
execFileSync('/usr/bin/tar', ['-cf', archive, '-C', source, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'pipe' });
const temporary = await mkdtemp(join(tmpdir(), 'ynx-composed-package-verify-'));
try {
  execFileSync('/usr/bin/tar', ['-xpf', archive, '-C', temporary], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'pipe' });
  await verifyComposedRuntime(temporary, pin);
} finally { await rm(temporary, { recursive: true, force: true }); }
await writeFile(join(output, 'workbench.pin.json'), pinBytes, { flag: 'wx' });
const receipt = {
  schemaVersion: 1, runtimeArtifact: pin, requiredNodeVersion: manifest.nodeVersion,
  archive: 'workbench.tar', archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
  roundTripTreeVerified: true, upstreamNotices: 'component-notices/index.json inside archive',
  ...(process.env.YNX_DEVELOPER_LOCAL_WORKBENCH_PAYLOAD === '1' ? {
    localWorkspace: { enabled: true, identity: 'OS-user local project only', canonicalAdmission: false },
    activation: 'The native local workspace supervisor verifies and activates this exact payload for OS-user local editing. Online private Tools, AI and Chain require separate canonical admission. Existing profiles are not migrated.',
  } : { activation: 'Protected operator must install and verify this exact payload, provide the compatible registered runtime and canonical admission. No automatic extraction, process launch or user profile migration.' }),
  signing: 'Archive preserves reviewed native component bytes across outer app signing. Its pin must be checked again after protected installation.'
};
await writeFile(join(output, 'distribution.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt));
