import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectAppImageMetadata, analyzeAppRun } from '../scripts/verify-appimage-launcher.mjs';

// A minimal ELF file with an appended SquashFS v4 superblock. The byte layout
// comes from the ELF/SquashFS formats; no executable payload is ever run.
function image({ bits = 64, bigEndian = false, secondFilesystem = false } = {}) {
  const bytes = Buffer.alloc(2048);
  bytes.set([0x7f, 69, 76, 70, bits === 64 ? 2 : 1, bigEndian ? 2 : 1, 1, 0, 65, 73, 2]);
  const u16 = (value, offset) => bigEndian ? bytes.writeUInt16BE(value, offset) : bytes.writeUInt16LE(value, offset);
  const u32 = (value, offset) => bigEndian ? bytes.writeUInt32BE(value, offset) : bytes.writeUInt32LE(value, offset);
  const u64 = (value, offset) => bigEndian ? bytes.writeBigUInt64BE(BigInt(value), offset) : bytes.writeBigUInt64LE(BigInt(value), offset);
  u16(2, 16); u16(bits === 64 ? 62 : 40, 18);
  u16(bits === 64 ? 64 : 52, bits === 64 ? 52 : 40);
  u16(1, bits === 64 ? 56 : 44);
  u16(bits === 64 ? 56 : 32, bits === 64 ? 54 : 42);
  if (bits === 64) { u64(64, 32); u64(0, 72); u64(256, 96); }
  else { u32(64, 28); u32(0, 68); u32(256, 80); }
  for (const offset of secondFilesystem ? [512, 1112] : [512]) {
    bytes.write('hsqs', offset);
    bytes.writeUInt32LE(4, offset + 4);
    bytes.writeUInt32LE(131072, offset + 12);
    bytes.writeUInt16LE(1, offset + 20);
    bytes.writeUInt16LE(17, offset + 22);
    bytes.writeUInt16LE(4, offset + 28);
    bytes.writeBigUInt64LE(400n, offset + 40);
    for (const field of [48, 56, 80, 88]) bytes.writeBigUInt64LE(0xffffffffffffffffn, offset + field);
    bytes.writeBigUInt64LE(100n, offset + 64);
    bytes.writeBigUInt64LE(180n, offset + 72);
  }
  return bytes;
}
function withImage(bytes, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-launcher-test-'));
  try { const file = path.join(directory, 'fixture.AppImage'); fs.writeFileSync(file, bytes); return callback(file); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const fixedExports = [
  'export PATH="${APPDIR}:${APPDIR}/usr/sbin${PATH:+:${PATH}}"',
  'export XDG_DATA_DIRS="${APPDIR}/usr/share/${XDG_DATA_DIRS:+:${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share/:/usr/share/"',
  'export LD_LIBRARY_PATH="${APPDIR}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"',
  'export GSETTINGS_SCHEMA_DIR="${APPDIR}/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:${GSETTINGS_SCHEMA_DIR}}"',
];
const script = '#!/usr/bin/env bash\n' + fixedExports.join('\n') + '\n';

for (const bits of [32, 64]) for (const bigEndian of [false, true]) {
  test(`ELF ${bits} ${bigEndian ? 'BE' : 'LE'} locates appended SquashFS independently of magic in runtime`, () => {
    const bytes = image({ bits, bigEndian });
    bytes.write('hsqs', 200); // Runtime data is not an appended filesystem.
    const metadata = withImage(bytes, inspectAppImageMetadata);
    assert.equal(metadata.elf.bits, bits);
    assert.equal(metadata.elf.littleEndian, !bigEndian);
    assert.equal(metadata.squashfs.offset, 512);
    assert.equal(metadata.squashfs.bytesUsed, 400);
  });
}
for (const [name, mutate] of [
  ['type-1 AppImage', bytes => { bytes[10] = 1; }],
  ['invalid ELF magic', bytes => { bytes[0] = 0; }],
  ['ELF segment past file', bytes => bytes.writeBigUInt64LE(9999n, 96)],
  ['unsafe integer offset', bytes => bytes.writeBigUInt64LE(0xffffffffffffffffn, 32)],
  ['filesystem past EOF', bytes => bytes.writeBigUInt64LE(9000n, 552)],
  ['inode table inside superblock', bytes => bytes.writeBigUInt64LE(90n, 576)],
  ['invalid block size', bytes => bytes.writeUInt32LE(123, 524)],
  ['missing filesystem', bytes => bytes.fill(0, 512, 608)],
]) test(`rejects ${name}`, () => {
  const bytes = image(); mutate(bytes);
  assert.throws(() => withImage(bytes, inspectAppImageMetadata));
});
test('multiple valid appended filesystems refuse offset guessing', () => {
  assert.throws(() => withImage(image({ secondFilesystem: true }), inspectAppImageMetadata), /found 2/);
});
test('truncated file refuses parsing', () => {
  assert.throws(() => withImage(image().subarray(0, 150), inspectAppImageMetadata));
});
test('fixed path template records automatic sandbox downgrade without claiming safety', () => {
  const result = analyzeAppRun(Buffer.from(script + 'if ! unshare -Ur true; then\n NO_SANDBOX=(--no-sandbox)\nfi\n'));
  assert.equal(result.environmentPathFixVerified, true);
  assert.equal(result.automaticNoSandboxFallbackPresent, true);
  assert.equal(result.status, 'requires-wallet-runtime-sandbox-guard');
  assert.equal(result.walletRuntimeSandboxVerified, false);
  assert.equal(result.eligibleForWalletRecommendation, false);
});
for (const line of fixedExports) {
  const name = line.match(/^export ([A-Z_]+)=/)[1];
  test(`${name} rejects unsafe legacy and later duplicate/bare/readonly/compound assignments`, () => {
    const unsafe = 'export ' + name + '="${APPDIR}:${' + name + '}"';
    assert.throws(() => analyzeAppRun(Buffer.from(script.replace(line, unsafe))));
    for (const extra of [line, `${name}=""`, `readonly ${name}=""`, `true; ${name}=""`, `${name}+=":"`]) {
      assert.throws(() => analyzeAppRun(Buffer.from(script + extra + '\n')));
    }
  });
}
test('known diagnostic child-command environments preserve Wallet environment; reassignment rejects', () => {
  for (const command of ['zenity', 'kdialog', 'Xdialog']) {
    analyzeAppRun(Buffer.from(script + `  LD_LIBRARY_PATH="" ${command} --error --text "message" 2>/dev/null\n`));
  }
  assert.throws(() => analyzeAppRun(Buffer.from(script + 'LD_LIBRARY_PATH="" zenity --error; LD_LIBRARY_PATH=""\n')));
});
test('invalid, truncated, or oversized AppRun text fails closed', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from([255]), Buffer.from(script + '\0'), Buffer.alloc(131073, 65), Buffer.from(script.replace('#!/usr/bin/env bash', '#!/bin/sh'))]) {
    assert.throws(() => analyzeAppRun(bytes));
  }
});
