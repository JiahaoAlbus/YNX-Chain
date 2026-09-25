import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MAX_FILE = 1024 * 1024 * 1024, MAX_HEADER = 8 * 1024 * 1024;
const SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const readAt = (fd, offset, length, size) => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) fail('Read exceeds file bounds');
  const bytes = Buffer.alloc(length);
  if (fs.readSync(fd, bytes, 0, length, offset) !== length) fail('Truncated file');
  return bytes;
};
function regular(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(MAX_FILE)) fail('Expected a bounded regular file');
  return stat;
}
function unchanged(before, file) {
  const after = regular(file);
  for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) if (before[field] !== after[field]) fail('Input changed during inspection');
}
async function fileHash(file) {
  const before = regular(file), hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  unchanged(before, file);
  return { bytes: Number(before.size), sha256: hash.digest('hex') };
}

export function inspectPE(file) {
  const stat = regular(file), size = Number(stat.size), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (size < 2 || !readAt(fd, 0, 2, size).equals(Buffer.from('MZ'))) return null;
    if (size < 64) fail('Truncated DOS header');
    const offset = readAt(fd, 0x3c, 4, size).readUInt32LE();
    if (offset < 64 || offset > MAX_HEADER || offset + 24 > size) fail('Invalid PE offset');
    const header = readAt(fd, offset, 24, size);
    if (!header.subarray(0, 4).equals(Buffer.from([80, 69, 0, 0]))) fail('Invalid PE signature');
    const machine = header.readUInt16LE(4), optionalSize = header.readUInt16LE(20), sections = header.readUInt16LE(6);
    if (![0x14c, 0x8664, 0xaa64, 0xa641, 0xa64e].includes(machine) || !sections || sections > 96 || optionalSize < 2 || offset + 24 + optionalSize + sections * 40 > size) fail('Invalid PE header bounds');
    const magic = readAt(fd, offset + 24, 2, size).readUInt16LE();
    if (![0x10b, 0x20b].includes(magic)) fail('Invalid PE optional header');
    return { machine, optionalMagic: magic };
  } finally { fs.closeSync(fd); }
}

export async function collectPEFiles(root, { allowEmpty = false } = {}) {
  const absolute = path.resolve(root), files = [];
  let count = 0;
  async function visit(directory, depth) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || depth > 32) fail('Unsafe package directory');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++count > 50000 || entry.isSymbolicLink()) fail('Unsafe package entry');
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, depth + 1);
      else if (entry.isFile()) {
        const before = regular(file);
        const pe = inspectPE(file);
        if (!pe && /\.(?:exe|dll|node)$/i.test(entry.name)) fail('Expected PE content for ' + entry.name);
        if (pe) files.push({ path: path.relative(absolute, file).split(path.sep).join('/'), ...pe, ...await fileHash(file) });
        unchanged(before, file);
      } else fail('Unsupported package entry');
    }
  }
  await visit(absolute, 0);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if ((!allowEmpty && !files.length) || new Set(files.map(f => f.path.toLowerCase())).size !== files.length) fail('Missing or ambiguous PE set');
  return files;
}

export function comparePESets(expected, actual, uninstallerName) {
  if (typeof uninstallerName !== 'string' || /[/\\]/.test(uninstallerName)) fail('Invalid uninstaller name');
  const byPath = new Map(actual.map(f => [f.path.toLowerCase(), f]));
  if (byPath.size !== actual.length) fail('Ambiguous installed PE paths');
  const missing = [], changed = [];
  for (const file of expected) {
    const key = file.path.toLowerCase(), found = byPath.get(key);
    if (!found) missing.push(file.path);
    else {
      if (found.sha256 !== file.sha256 || found.bytes !== file.bytes || found.machine !== file.machine) changed.push(file.path);
      byPath.delete(key);
    }
  }
  const added = [...byPath.values()], unexpected = added.filter(f => f.path.toLowerCase() !== uninstallerName.toLowerCase()).map(f => f.path);
  return { matched: !missing.length && !changed.length && !unexpected.length, expectedCount: expected.length, actualCount: actual.length, missing, changed, unexpected, installerAddedFiles: added.filter(f => f.path.toLowerCase() === uninstallerName.toLowerCase()) };
}

// NSIS uses SetCompress off for its already-compressed app payload. Locate it
// as data by both 7z header CRCs and exact bounds; never execute the installer.
export function locateEmbedded7z(file) {
  if (!inspectPE(file)) fail('Expected a PE installer');
  const stat = regular(file), size = Number(stat.size), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW), candidates = [];
  try {
    let carry = Buffer.alloc(0);
    for (let position = 0; position < size; position += 1024 * 1024) {
      const block = Buffer.concat([carry, readAt(fd, position, Math.min(1024 * 1024, size - position), size)]), base = position - carry.length;
      for (let i = block.indexOf(SIGNATURE); i >= 0; i = block.indexOf(SIGNATURE, i + 1)) {
        const offset = base + i;
        if (offset + 32 > size || candidates.some(c => c.offset === offset)) continue;
        const header = readAt(fd, offset, 32, size);
        if (header[6] !== 0 || zlib.crc32(header.subarray(12)) !== header.readUInt32LE(8)) continue;
        const nextOffset = header.readBigUInt64LE(12), nextSize = header.readBigUInt64LE(20), total = 32n + nextOffset + nextSize;
        if (!nextSize || nextSize > BigInt(MAX_HEADER) || total > BigInt(size - offset)) continue;
        const next = readAt(fd, offset + 32 + Number(nextOffset), Number(nextSize), size);
        if (zlib.crc32(next) !== header.readUInt32LE(28)) continue;
        candidates.push({ offset, bytes: Number(total), major: header[6], minor: header[7], nextHeaderBytes: next.length, nextHeaderSHA256: digest(next) });
        if (candidates.length > 1) fail('Multiple embedded 7z archives; refusing to guess app payload');
      }
      carry = block.subarray(Math.max(0, block.length - 5));
    }
    if (candidates.length !== 1) fail('No unique CRC-verified embedded 7z payload');
    unchanged(stat, file);
    return candidates[0];
  } finally { fs.closeSync(fd); }
}

export function parse7zListing(text) {
  if (typeof text !== 'string' || text.length > MAX_HEADER || text.includes('\0')) fail('Invalid 7z listing');
  const records = [];
  for (const block of text.replaceAll('\r\n', '\n').split(/\n\s*\n/)) {
    const record = {};
    for (const line of block.split('\n')) {
      const match = line.match(/^([^=\n]+?) = (.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      if (Object.hasOwn(record, key)) fail('Duplicate 7z listing field');
      record[key] = match[2];
    }
    if (!record.Path || record.Type) continue; // Archive summary is not a file.
    const name = record.Path.replaceAll('\\', '/');
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) fail('Unsafe payload entry path');
    if (record.Folder === '+' || record.Attributes?.startsWith('D')) continue;
    if (!/^(0|[1-9][0-9]*)$/.test(record.Size ?? '') || Number(record.Size) > MAX_FILE) fail('Invalid payload entry size');
    records.push({ path: name, bytes: Number(record.Size), method: record.Method ?? '', encrypted: record.Encrypted, symbolicLink: record['Symbolic Link'], hardLink: record['Hard Link'] });
  }
  if (!records.length || records.length > 50000 || new Set(records.map(r => r.path.toLowerCase())).size !== records.length) fail('Empty or ambiguous payload listing');
  return records;
}
export function validateArchiveRecords(records, expectedPE) {
  const map = new Map(records.map(r => [r.path.toLowerCase(), r]));
  for (const record of records) {
    if (record.encrypted !== '-' || record.symbolicLink || record.hardLink) fail('Encrypted or linked payload entry');
    const methods = record.method.split(/\s+/).filter(Boolean);
    if (record.bytes === 0 && methods.length === 0) continue; // Empty files have no coded stream.
    if (!methods.length || methods.some(m => m !== 'BCJ' && m !== 'Copy' && !/^LZMA2(?::[0-9]+)?$/.test(m))) fail('Install-time unsupported archive method: ' + record.method);
  }
  const peMethods = [];
  for (const file of expectedPE) {
    const entry = map.get(file.path.toLowerCase());
    if (!entry || entry.bytes !== file.bytes) fail('Payload is missing exact PE entry: ' + file.path);
    peMethods.push({ path: entry.path, bytes: entry.bytes, method: entry.method });
  }
  if (!peMethods.length || !peMethods.some(f => f.method.split(/\s+/).includes('BCJ'))) fail('Expected explicit BCJ-filtered PE payload');
  return peMethods;
}

export async function verifyWindowsArchive(installer, unpacked, { toolPath } = {}) {
  const before = regular(installer), expectedPE = await collectPEFiles(unpacked), embedded = locateEmbedded7z(installer), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-nsis-payload-'));
  try {
    const payload = path.join(directory, 'app.7z');
    await pipeline(fs.createReadStream(installer, { start: embedded.offset, end: embedded.offset + embedded.bytes - 1 }), fs.createWriteStream(payload, { flags: 'wx', mode: 0o600 }));
    if (!toolPath) {
      if (process.env.ELECTRON_BUILDER_7ZIP_PATH) fail('Unexpected external 7zip override');
      const require = createRequire(new URL('../package.json', import.meta.url));
      toolPath = await require('app-builder-lib/out/toolsets/7zip.js').getPath7za();
    }
    if (!path.isAbsolute(toolPath)) fail('Expected absolute 7za path');
    const tool = await fileHash(toolPath), args = ['l', '-slt', '-sccUTF-8', payload];
    const listed = spawnSync(toolPath, args, { encoding: 'buffer', maxBuffer: MAX_HEADER, timeout: 60000, shell: false });
    if (listed.error || listed.status !== 0) fail('Trusted 7za could not list embedded payload');
    const listing = new TextDecoder('utf-8', { fatal: true }).decode(listed.stdout), records = parse7zListing(listing), peMethods = validateArchiveRecords(records, expectedPE);
    const installerDigest = await fileHash(installer), payloadDigest = await fileHash(payload);
    unchanged(before, installer);
    return { schemaVersion: 1, sourceCommit: process.env.GITHUB_SHA ?? null, kind: 'archive', verified: true, installer: { path: path.resolve(installer), ...installerDigest }, payload: { ...embedded, ...payloadDigest }, tool: { path: toolPath, ...tool, arguments: args }, listingSHA256: digest(listed.stdout), listing, expectedPE, peMethods, installTimeMethodsVerified: true, installerExecuted: false, actualInstallationVerified: false };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
export async function verifyInstalledPE(unpacked, installed, uninstallerName) {
  const expectedPE = await collectPEFiles(unpacked), actualPE = await collectPEFiles(installed, { allowEmpty: true }), comparison = comparePESets(expectedPE, actualPE, uninstallerName);
  return { schemaVersion: 1, sourceCommit: process.env.GITHUB_SHA ?? null, kind: 'installed', verified: comparison.matched, unpacked: path.resolve(unpacked), installed: path.resolve(installed), expectedPE, actualPE, ...comparison, executableInvokedByVerifier: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, first, second, output] = process.argv.slice(2);
  let report;
  try {
    if (!['archive', 'installed'].includes(mode) || !first || !second || !output || process.argv.length !== 6) fail('Usage: verify-windows-package.mjs archive <installer> <unpacked> <report.json> OR installed <unpacked> <installed> <report.json>');
    const metadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    report = mode === 'archive' ? await verifyWindowsArchive(path.resolve(first), path.resolve(second)) : await verifyInstalledPE(first, second, `Uninstall ${metadata.build.win.executableName}.exe`);
    if (report.listing) { fs.writeFileSync(output + '.listing.txt', report.listing, { flag: 'wx' }); delete report.listing; report.listingPath = path.resolve(output + '.listing.txt'); }
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (!report.verified) fail('Installed PE set differs from exact unpacked package');
    console.log(JSON.stringify({ kind: report.kind, verified: true, expectedPEFiles: report.expectedPE.length, report: path.resolve(output) }));
  } catch (error) {
    if (output && !report) fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, sourceCommit: process.env.GITHUB_SHA ?? null, kind: mode, verified: false, error: error.message }, null, 2) + '\n', { flag: 'wx' });
    console.error(error.message); process.exitCode = 1;
  }
}
