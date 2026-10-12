import { access, readFile, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { availableParallelism, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const BINARIES = ['lxc', 'zfs', 'zpool', 'btrfs', 'mkfs.btrfs', 'findmnt', 'losetup', 'fallocate', 'runuser', 'sudo'];
// No installation, daemon mutation, user file enumeration, environment dump or
// service restart. This is deliberately a host fact receipt, never admission.
export async function nativeHostFacts({ platform = process.platform, architecture = process.arch,
  read = readFile, fsStats = statfs, locate = locateExecutable, run = runReadonly,
  cpuCount = availableParallelism(), memoryBytes = totalmem() } = {}) {
  const result = { protocol: 'ynx-native-host-doctor/v1', readOnly: true, platform, architecture, cpuCount, memoryBytes, binaries: {}, filesystems: [],
    lxd: null, storagePools: [], zfsPools: [], projectStorageAdmission: 'NOT_VERIFIED', shiftedUidCheckpoint: 'NOT_VERIFIED', egressAdmission: 'NOT_VERIFIED', capacityVerified: false };
  if (platform !== 'linux' || architecture !== 'x64') return { ...result, ready: false, reasons: ['Native production requires Linux x64; no host commands executed.'] };
  for (const name of BINARIES) result.binaries[name] = await locate(name);
  result.filesystems = String(await read('/proc/filesystems', 'utf8')).split('\n').map(line => line.trim().split(/\s+/).at(-1)).filter(name => ['btrfs', 'zfs'].includes(name));
  try { result.cgroupV2 = Boolean(String(await read('/sys/fs/cgroup/cgroup.controllers', 'utf8')).trim()); } catch { result.cgroupV2 = false; }
  const mem = String(await read('/proc/meminfo', 'utf8')); result.availableMemoryBytes = Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(mem)?.[1] || 0) * 1024;
  try { const storage = await fsStats('/', { bigint: true }); result.rootAvailableBytes = String(storage.bavail * storage.bsize); } catch { result.rootAvailableBytes = null; }
  if (result.binaries.lxc) {
    try {
      const envelope = JSON.parse((await run(result.binaries.lxc, ['query', '--raw', '/1.0'])).stdout);
      if (envelope.type !== 'sync' || envelope.status_code !== 200) throw Error('LXD response rejected');
      const env = envelope.metadata?.environment;
      result.lxd = { version: env?.server_version, architecture: env?.kernel_architecture };
      const rows = JSON.parse((await run(result.binaries.lxc, ['storage', 'list', '--format', 'json'])).stdout);
      if (!Array.isArray(rows)) throw Error('Storage response rejected');
      result.storagePools = rows.map(row => ({ name: row.name, driver: row.driver, status: row.status, configuredSize: row.config?.size || null }));
    } catch { result.lxdReadFailed = true; }
  }
  if (result.binaries.zpool) {
    try { result.zfsPools = (await run(result.binaries.zpool, ['list', '-H', '-p', '-o', 'name,size,alloc,free,health'])).stdout.trim().split('\n').filter(Boolean).map(line => { const [name, size, allocated, free, health] = line.split(/\s+/); return { name, size, allocated, free, health }; }); }
    catch { result.zpoolReadFailed = true; }
  }
  result.providerFacts = { zfsKernelPresent: result.filesystems.includes('zfs'), zfsToolsPresent: Boolean(result.binaries.zfs && result.binaries.zpool), btrfsKernelPresent: result.filesystems.includes('btrfs'),
    btrfsQgroupAloneAccepted: false, btrfsReason: 'Nested subvolumes do not inherit qgroups; strict project quota needs a separately verified enforcement boundary.' };
  result.ready = false; result.reasons = ['Host capability facts are not an installed isolated runtime.', 'Per-project hard quota, shifted UID checkpoint, restricted package egress and independent execution origin need actual admission checks.'];
  return result;
}
async function locateExecutable(name) { for (const directory of ['/usr/sbin', '/usr/bin', '/sbin', '/bin', '/snap/bin']) { const path = `${directory}/${name}`; try { await access(path, constants.X_OK); return path; } catch {} } return null; }
async function runReadonly(executable, args) { return execute(executable, args, { shell: false, timeout: 10000, maxBuffer: 2 * 1024 * 1024, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin', LANG: 'C', LC_ALL: 'C', ...(process.env.LXD_CONF ? { LXD_CONF: process.env.LXD_CONF } : {}) } }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error('Usage: node scripts/native-core-doctor.mjs (read-only facts only)');
  console.log(JSON.stringify(await nativeHostFacts(), null, 2));
}
