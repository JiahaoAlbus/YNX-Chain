import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectPE, collectPEFiles, comparePESets, locateEmbedded7z, parse7zListing, validateArchiveRecords, verifyInstalledPE } from '../scripts/verify-windows-package.mjs';

function pe(machine = 0xaa64) {
  const b = Buffer.alloc(1024);
  b.write('MZ'); b.writeUInt32LE(64, 0x3c); b.set([80, 69, 0, 0], 64);
  b.writeUInt16LE(machine, 68); b.writeUInt16LE(1, 70); b.writeUInt16LE(224, 84); b.writeUInt16LE(0x20b, 88);
  return b;
}
function sevenZip() {
  const next = Buffer.from([1, 5, 0]), b = Buffer.alloc(35);
  b.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]);
  b.writeBigUInt64LE(3n, 20); b.writeUInt32LE(zlib.crc32(next), 28);
  b.writeUInt32LE(zlib.crc32(b.subarray(12, 32)), 8); next.copy(b, 32);
  return b;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-windows-package-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(dir, name, bytes) {
  const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); return p;
}
const listing = (method = 'BCJ LZMA2:20', name = 'YNX Wallet.exe', size = 1024) => `Path = payload.7z\nType = 7z\nMethod = ${method}\n\n----------\nPath = ${name}\nSize = ${size}\nAttributes = A\nEncrypted = -\nMethod = ${method}\n\n`;

test('PE parser reads machine without executing and rejects truncated or out-of-bounds headers', t => {
  const d = temp(t), file = put(d, 'app.exe', pe());
  assert.equal(inspectPE(file).machine, 0xaa64);
  for (const bytes of [Buffer.from('MZ'), (() => { const b = pe(); b.writeUInt32LE(0xffffffff, 0x3c); return b; })(), (() => { const b = pe(); b[64] = 0; return b; })()]) {
    assert.throws(() => inspectPE(put(d, 'bad.exe', bytes)));
  }
  assert.equal(inspectPE(put(d, 'data.json', Buffer.from('{}'))), null);
});

test('all PE files are identified by content, including nested files without executable suffix', async t => {
  const d = temp(t); put(d, 'YNX Wallet.exe', pe()); put(d, 'nested/native.bin', pe(0x8664)); put(d, 'data.txt', Buffer.from('data'));
  const files = await collectPEFiles(d); assert.deepEqual(files.map(f => f.path), ['YNX Wallet.exe', 'nested/native.bin']);
  assert(files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
});

test('missing main exe or native DLL after a successful installer remains a failure', async t => {
  const d = temp(t), expected = path.join(d, 'expected'), actual = path.join(d, 'actual');
  put(expected, 'YNX Wallet.exe', pe()); put(expected, 'ffmpeg.dll', pe());
  put(actual, 'Uninstall YNX Wallet.exe', pe(0x14c));
  const report = await verifyInstalledPE(expected, actual, 'Uninstall YNX Wallet.exe');
  assert.equal(report.verified, false); assert.deepEqual(report.missing, ['YNX Wallet.exe', 'ffmpeg.dll']);
  assert.equal(report.installerAddedFiles.length, 1);
});

test('exact installed PE set passes, only the root uninstaller addition is permitted', async t => {
  const d = temp(t), expected = path.join(d, 'expected'), actual = path.join(d, 'actual');
  for (const root of [expected, actual]) { put(root, 'YNX Wallet.exe', pe()); put(root, 'resources/native.node', pe()); }
  put(actual, 'Uninstall YNX Wallet.exe', pe(0x14c));
  assert.equal((await verifyInstalledPE(expected, actual, 'Uninstall YNX Wallet.exe')).verified, true);
  put(actual, 'resources/Uninstall YNX Wallet.exe', pe());
  const report = await verifyInstalledPE(expected, actual, 'Uninstall YNX Wallet.exe');
  assert.equal(report.verified, false); assert.deepEqual(report.unexpected, ['resources/Uninstall YNX Wallet.exe']);
});

test('changed bytes and case-colliding PE paths cannot pass exact-set comparison', () => {
  const a = { path: 'YNX Wallet.exe', bytes: 1, sha256: 'a', machine: 0xaa64 };
  assert.equal(comparePESets([a], [{ ...a, sha256: 'b' }], 'Uninstall YNX Wallet.exe').matched, false);
  assert.throws(() => comparePESets([a], [a, { ...a, path: 'ynx wallet.EXE' }], 'Uninstall YNX Wallet.exe'));
});

test('CLI persists a negative receipt when the installed directory contains no PE files', t => {
  const d = temp(t), expected = path.join(d, 'expected'), actual = path.join(d, 'actual'), output = path.join(d, 'failure.json');
  put(expected, 'YNX Wallet.exe', pe()); put(actual, 'app-data.txt', Buffer.from('data only'));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/verify-windows-package.mjs', import.meta.url)), 'installed', expected, actual, output], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.verified, false); assert.equal(report.actualCount, 0); assert.deepEqual(report.missing, ['YNX Wallet.exe']);
});

test('CRC-verified embedded payload is bounded and uniquely located after installer PE', t => {
  const d = temp(t), b = Buffer.concat([pe(), Buffer.alloc(23), sevenZip()]);
  const result = locateEmbedded7z(put(d, 'installer.exe', b));
  assert.equal(result.offset, 1047); assert.equal(result.bytes, 35);
  assert.throws(() => locateEmbedded7z(put(d, 'ambiguous.exe', Buffer.concat([b, sevenZip()]))), /Multiple/);
});
for (const [name, mutate] of [
  ['start header CRC', b => { b[8] ^= 1; }],
  ['next header CRC', b => { b[34] ^= 1; }],
  ['next header outside installer', b => { b.writeBigUInt64LE(99999999n, 12); b.writeUInt32LE(zlib.crc32(b.subarray(12, 32)), 8); }],
  ['unsafe integer header offset', b => { b.writeBigUInt64LE(0xffffffffffffffffn, 12); b.writeUInt32LE(zlib.crc32(b.subarray(12, 32)), 8); }],
]) test(`embedded 7z ${name} rejects rather than guessing`, t => {
  const d = temp(t), zip = sevenZip(); mutate(zip);
  assert.throws(() => locateEmbedded7z(put(d, 'installer.exe', Buffer.concat([pe(), zip]))));
});

test('signature straddling the scan chunk boundary remains correctly bound', t => {
  const d = temp(t), prefix = Buffer.alloc(1024 * 1024 - 3); pe().copy(prefix);
  assert.equal(locateEmbedded7z(put(d, 'boundary.exe', Buffer.concat([prefix, sevenZip()]))).offset, prefix.length);
});

test('real 7z technical listing shape binds exact PE path, size and compatible method', () => {
  const records = parse7zListing(listing());
  assert.equal(records.length, 1);
  assert.deepEqual(validateArchiveRecords(records, [{ path: 'YNX Wallet.exe', bytes: 1024 }]), [{ path: 'YNX Wallet.exe', bytes: 1024, method: 'BCJ LZMA2:20' }]);
  assert.throws(() => validateArchiveRecords(records, [{ path: 'YNX Wallet.exe', bytes: 1025 }]), /missing exact/);
});
test('empty data files need no codec but cannot substitute for the expected PE stream', () => {
  const records = parse7zListing(listing() + listing('', 'empty.txt', 0));
  assert.equal(validateArchiveRecords(records, [{ path: 'YNX Wallet.exe', bytes: 1024 }]).length, 1);
  assert.throws(() => validateArchiveRecords(records, [{ path: 'missing.exe', bytes: 1024 }]));
});
for (const method of ['BCJ2 LZMA2:20 LZMA:20', 'ARM64 LZMA2:20', 'LZMA:20', 'ZSTD', '']) {
  test(`install-time incompatible ${method || 'missing'} method cannot claim payload compatibility`, () => {
    assert.throws(() => validateArchiveRecords(parse7zListing(listing(method)), [{ path: 'YNX Wallet.exe', bytes: 1024 }]));
  });
}
test('encrypted, linked, duplicate, traversal or deceptive listings fail closed', () => {
  for (const bad of [listing().replace('Encrypted = -', 'Encrypted = +'), listing().replace('Encrypted = -', 'Encrypted = -\nSymbolic Link = other')]) {
    assert.throws(() => validateArchiveRecords(parse7zListing(bad), [{ path: 'YNX Wallet.exe', bytes: 1024 }]));
  }
  for (const bad of [listing() + listing(), listing('BCJ LZMA2:20', '../YNX Wallet.exe'), listing().replace('Size = 1024', 'Size = 01024'), listing().replace('Size = 1024', 'Size = 1024\nSize = 1024')]) assert.throws(() => parse7zListing(bad));
});
