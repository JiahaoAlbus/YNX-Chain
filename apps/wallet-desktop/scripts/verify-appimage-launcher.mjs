import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_RUNTIME_BYTES = 32 * 1024 * 1024;
const MAX_APP_RUN_BYTES = 128 * 1024;
const EXPECTED_EXPORTS = Object.freeze({
  PATH: 'export PATH="${APPDIR}:${APPDIR}/usr/sbin${PATH:+:${PATH}}"',
  XDG_DATA_DIRS: 'export XDG_DATA_DIRS="${APPDIR}/usr/share/${XDG_DATA_DIRS:+:${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share/:/usr/share/"',
  LD_LIBRARY_PATH: 'export LD_LIBRARY_PATH="${APPDIR}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"',
  GSETTINGS_SCHEMA_DIR: 'export GSETTINGS_SCHEMA_DIR="${APPDIR}/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:${GSETTINGS_SCHEMA_DIR}}"',
});
const fail = message => { throw new Error(message); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const integer = (value, maximum, label) => {
  if (value < 0n || value > BigInt(maximum)) fail(`Out-of-range ${label}`);
  return Number(value);
};

// Read headers as data. Never invoke the AppImage runtime, --appimage-offset,
// --appimage-extract, AppRun, or the packaged Wallet executable.
export function inspectAppImageMetadata(imagePath) {
  const stat = fs.lstatSync(imagePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 160) fail('Expected a regular AppImage file');
  const fd = fs.openSync(imagePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const read = (position, length) => {
      if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > stat.size) fail('ELF read exceeds image');
      const bytes = Buffer.alloc(length);
      if (fs.readSync(fd, bytes, 0, length, position) !== length) fail('Truncated ELF read');
      return bytes;
    };
    const header = read(0, 64);
    if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || ![1, 2].includes(header[4]) || ![1, 2].includes(header[5])) fail('Invalid ELF identity');
    if (!header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]))) fail('Expected a type-2 AppImage');
    const is64 = header[4] === 2, little = header[5] === 1;
    const u16 = (b, o) => little ? b.readUInt16LE(o) : b.readUInt16BE(o);
    const u32 = (b, o) => little ? b.readUInt32LE(o) : b.readUInt32BE(o);
    const u64 = (b, o) => integer(little ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o), stat.size, 'ELF offset');
    const phoff = is64 ? u64(header, 32) : u32(header, 28), shoff = is64 ? u64(header, 40) : u32(header, 32);
    const phsize = u16(header, is64 ? 54 : 42), phcount = u16(header, is64 ? 56 : 44);
    const shsize = u16(header, is64 ? 58 : 46);
    let shcount = u16(header, is64 ? 60 : 48), elfEnd = u16(header, is64 ? 52 : 40);
    if (elfEnd < (is64 ? 64 : 52) || phcount > 4096) fail('Invalid ELF table count');
    if (shoff && shcount === 0) {
      if (shsize < (is64 ? 64 : 40)) fail('Invalid extended section header');
      const first = read(shoff, shsize);
      shcount = is64 ? u64(first, 32) : u32(first, 20);
    }
    if (shcount > 8192) fail('Too many ELF sections');
    const include = (offset, size) => {
      if (!Number.isSafeInteger(offset + size) || offset + size > stat.size || offset + size > MAX_RUNTIME_BYTES) fail('ELF runtime exceeds inspection bound');
      elfEnd = Math.max(elfEnd, offset + size);
    };
    if (phcount) {
      if (!phoff || phsize < (is64 ? 56 : 32) || phsize > 1024) fail('Invalid program headers');
      include(phoff, phsize * phcount);
      for (let i = 0; i < phcount; i++) {
        const p = read(phoff + i * phsize, phsize);
        include(is64 ? u64(p, 8) : u32(p, 4), is64 ? u64(p, 32) : u32(p, 16));
      }
    }
    if (shcount) {
      if (!shoff || shsize < (is64 ? 64 : 40) || shsize > 1024) fail('Invalid section headers');
      include(shoff, shsize * shcount);
      for (let i = 0; i < shcount; i++) {
        const s = read(shoff + i * shsize, shsize);
        if (u32(s, 4) !== 8) include(is64 ? u64(s, 24) : u32(s, 16), is64 ? u64(s, 32) : u32(s, 20)); // SHT_NOBITS has no file bytes.
      }
    }
    // AppImage has its SquashFS appended after the ELF runtime. Permit bounded
    // padding and validate the complete superblock, not a lone magic match.
    const scanEnd = Math.min(stat.size, MAX_RUNTIME_BYTES), scan = read(elfEnd, scanEnd - elfEnd), candidates = [];
    for (let i = scan.indexOf('hsqs'); i >= 0; i = scan.indexOf('hsqs', i + 1)) {
      if (i + 96 > scan.length) continue;
      const s = scan.subarray(i, i + 96), offset = elfEnd + i, blockSize = s.readUInt32LE(12), blockLog = s.readUInt16LE(22), compression = s.readUInt16LE(20);
      if (s.readUInt16LE(28) !== 4 || s.readUInt16LE(30) !== 0 || !s.readUInt32LE(4) || blockLog < 12 || blockLog > 20 || blockSize !== 2 ** blockLog || compression < 1 || compression > 6) continue;
      const used = s.readBigUInt64LE(40), remaining = BigInt(stat.size - offset);
      if (used < 96n || used > remaining) continue;
      const inodeTable = s.readBigUInt64LE(64), directoryTable = s.readBigUInt64LE(72), rootInode = s.readBigUInt64LE(32);
      if (inodeTable < 96n || inodeTable >= used || directoryTable < inodeTable || directoryTable >= used || inodeTable + (rootInode >> 16n) >= used || (rootInode & 0xffffn) >= 8192n) continue;
      if ([48, 56, 80, 88].some(o => { const v = s.readBigUInt64LE(o); return v !== 0xffffffffffffffffn && (v < 96n || v >= used); })) continue;
      candidates.push({ offset, bytesUsed: Number(used), blockSize, compression, major: 4, minor: 0, inodeCount: s.readUInt32LE(4), superblockSHA256: digest(s) });
    }
    if (candidates.length !== 1) fail(`Expected one valid appended SquashFS, found ${candidates.length}`);
    return { imageBytes: stat.size, elf: { bits: is64 ? 64 : 32, littleEndian: little, machine: u16(header, 18), runtimeEnd: elfEnd }, squashfs: candidates[0] };
  } finally { fs.closeSync(fd); }
}

export function analyzeAppRun(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_APP_RUN_BYTES || bytes.includes(0)) fail('Invalid AppRun content');
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes), lines = script.split('\n');
  if (lines[0] !== '#!/usr/bin/env bash') fail('Unexpected AppRun interpreter');
  const exports = {};
  for (const [name, expected] of Object.entries(EXPECTED_EXPORTS)) {
    const assignments = lines.filter(line => new RegExp(`^\\s*export\\s+${name}=`).test(line));
    if (assignments.length !== 1 || assignments[0] !== expected) fail(`Unsafe or unsupported ${name} construction`);
    // Reject later bare/readonly/compound assignments as well as duplicate
    // exports. The known template temporarily clears LD_LIBRARY_PATH only for
    // its three diagnostic dialog programs; those child-command assignments
    // do not change the environment inherited by the Wallet executable.
    for (const line of lines) {
      const matches = [...line.matchAll(new RegExp(`(?:^|[; \\t])${name}\\+?=`, 'g'))];
      if (!matches.length || line === expected) continue;
      const diagnosticOnly = name === 'LD_LIBRARY_PATH' && matches.length === 1 &&
        /^\s*LD_LIBRARY_PATH="" (?:zenity|kdialog|Xdialog) --[^;]*$/.test(line);
      if (!diagnosticOnly) fail(`Additional or unsupported ${name} assignment`);
    }
    exports[name] = assignments[0];
  }
  const sandboxBypassMentioned = script.includes('--no-sandbox');
  const automaticNoSandboxFallbackPresent = /NO_SANDBOX=\(--no-sandbox\)/.test(script) && /!\s+unshare\s+-Ur\s+true/.test(script);
  return { appRunSHA256: digest(bytes), appRunBytes: bytes.length, environmentPathFixVerified: true, environmentExports: exports,
    sandboxBypassMentioned, automaticNoSandboxFallbackPresent,
    status: sandboxBypassMentioned ? 'requires-wallet-runtime-sandbox-guard' : 'launcher-paths-verified',
    walletRuntimeSandboxVerified: false, eligibleForWalletRecommendation: false,
    limits: 'This verifies the four generated path assignments and records sandbox bypass text. It does not execute AppRun, verify the Wallet startup guard, or establish complete sandbox enforcement.' };
}

export async function verifyAppImageLauncher({ imagePath, outputDirectory = path.dirname(path.resolve(imagePath)), unsquashfsPath = '/usr/bin/unsquashfs' }) {
  const absolute = path.resolve(imagePath);
  if (!path.isAbsolute(unsquashfsPath)) fail('unsquashfs must be an explicit system executable path');
  const before = fs.lstatSync(absolute, { bigint: true }), metadata = inspectAppImageMetadata(absolute), hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(absolute)) hash.update(chunk);
  const extracted = spawnSync(unsquashfsPath, ['-cat', '-o', String(metadata.squashfs.offset), absolute, 'AppRun'], { shell: false, encoding: 'buffer', timeout: 30000, maxBuffer: MAX_APP_RUN_BYTES });
  if (extracted.error || extracted.status !== 0) fail(`System unsquashfs could not read AppRun (exit ${extracted.status}, ${extracted.error?.code ?? 'tool error'})`);
  const after = fs.lstatSync(absolute, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail('AppImage changed during inspection');
  const analysis = analyzeAppRun(extracted.stdout), base = path.basename(absolute), directory = path.resolve(outputDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const appRunPath = path.join(directory, base + '.AppRun.txt'), receiptPath = path.join(directory, base + '.launcher.json');
  const result = { schemaVersion: 1, sourceCommit: process.env.GITHUB_SHA ?? null, imagePath: absolute, imageSHA256: hash.digest('hex'), ...metadata,
    extractor: { path: unsquashfsPath, arguments: ['-cat', '-o', String(metadata.squashfs.offset), absolute, 'AppRun'], imageExecuted: false },
    ...analysis, appRunPath, receiptPath };
  fs.writeFileSync(appRunPath, extracted.stdout, { flag: 'wx', mode: 0o644 });
  if (digest(fs.readFileSync(appRunPath)) !== analysis.appRunSHA256) fail('AppRun evidence readback failed');
  fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 3 || process.argv.length > 5) fail('Usage: node verify-appimage-launcher.mjs <exact.AppImage> [output-directory] [absolute-unsquashfs-path]');
    const result = await verifyAppImageLauncher({ imagePath: process.argv[2], outputDirectory: process.argv[3], unsquashfsPath: process.argv[4] });
    // Exit zero means metadata/path verification and evidence collection
    // succeeded. The receipt deliberately does not promote sandbox or release
    // readiness; the Wallet startup guard needs its own native evidence.
    console.log(JSON.stringify({ imageSHA256: result.imageSHA256, status: result.status, environmentPathFixVerified: result.environmentPathFixVerified,
      automaticNoSandboxFallbackPresent: result.automaticNoSandboxFallbackPresent, walletRuntimeSandboxVerified: false, eligibleForWalletRecommendation: false, receiptPath: result.receiptPath }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
