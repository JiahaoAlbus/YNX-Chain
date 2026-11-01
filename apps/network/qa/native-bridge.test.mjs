// Auto-discovered Node test wrapper for the original Darwin launcher contract.
// It starts only isolated fixed subprocess fixtures, never NSApplication/GUI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
test('boolean delta: actual host result keeps CFBoolean across the WebKit arguments boundary',
  { skip: process.platform !== 'darwin', timeout: 30000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-native-boolean-'));
    fs.chmodSync(directory, 0o700);
    try {
      const binary = path.join(directory, 'native-bridge-test');
      await exec('xcrun', ['--sdk', 'macosx', 'clang', '-arch', process.arch === 'x64' ? 'x86_64' : process.arch,
        '-mmacosx-version-min=12.0', '-fobjc-arc', '-fblocks', '-Wno-deprecated-declarations',
        '-Wall', '-Wextra', '-Wno-unused-parameter', '-Werror', '-framework', 'Cocoa',
        '-framework', 'WebKit', path.join(here, 'native_bridge_test.m'), path.join(here, 'proof_profile.m'),
        '-o', binary], { timeout: 25000, maxBuffer: 256 << 10 });
      const result = await exec(binary, [directory, '--boolean-delta'], { timeout: 5000, maxBuffer: 256 << 10 });
      assert.equal(result.stderr, '');
      assert.match(result.stdout, /SUMMARY BOOLEAN 5 passed; actual original host nativeResult boundary; no GUI or task/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
test('actual Clang launcher: fixed bridge, exact task Wait, limits, timeout and retired-document refusal',
  { skip: process.platform !== 'darwin', timeout: 60000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-native-bridge-'));
    fs.chmodSync(directory, 0o700);
    try {
      const binary = path.join(directory, 'native-bridge-test');
      await exec('xcrun', ['--sdk', 'macosx', 'clang', '-arch', process.arch === 'x64' ? 'x86_64' : process.arch,
        '-mmacosx-version-min=12.0', '-fobjc-arc', '-fblocks', '-Wno-deprecated-declarations',
        '-Wall', '-Wextra', '-Wno-unused-parameter', '-Werror', '-framework', 'Cocoa',
        '-framework', 'WebKit', path.join(here, 'native_bridge_test.m'),
        path.join(here, 'proof_profile.m'), '-o', binary], { timeout: 25000, maxBuffer: 256 << 10 });
      const result = await exec(binary, [directory], { timeout: 25000, maxBuffer: 256 << 10 });
      assert.equal(result.stderr, '');
      assert.match(result.stdout, /SUMMARY \d+ passed; no GUI/);
      assert.match(result.stdout, /real12s deadline terminates exact task and Wait without replay/);
      assert.match(result.stdout, /caller control denied: RawE5/);
      assert.match(result.stdout, /navigation retires session and cancels only original held task/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

test('resolve delta: actual Clang exact original request alias and normal Native gates without effects',
  { skip: process.platform !== 'darwin', timeout: 30000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-native-resolve-'));
    fs.chmodSync(directory, 0o700);
    try {
      const binary = path.join(directory, 'native-bridge-test');
      await exec('xcrun', ['--sdk', 'macosx', 'clang', '-arch', process.arch === 'x64' ? 'x86_64' : process.arch,
        '-mmacosx-version-min=12.0', '-fobjc-arc', '-fblocks', '-Wno-deprecated-declarations',
        '-Wall', '-Wextra', '-Wno-unused-parameter', '-Werror', '-framework', 'Cocoa',
        '-framework', 'WebKit', path.join(here, 'native_bridge_test.m'), path.join(here, 'proof_profile.m'),
        '-o', binary], { timeout: 25000, maxBuffer: 256 << 10 });
      const result = await exec(binary, [directory, '--resolve-delta'], { timeout: 5000, maxBuffer: 256 << 10 });
      assert.equal(result.stderr, ''); assert.match(result.stdout, /SUMMARY RESOLVE \d+ passed/);
      assert.match(result.stdout, /zero task launch reader Wallet prepare sign submit or GUI/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
