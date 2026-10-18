import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const nativeInclude = process.env.YNX_IDE_IDENTITY_NATIVE_INCLUDE;
test('original native launch consumer maps fd5 and retains actual spawn/cleanup ownership', {
  skip: process.platform !== 'darwin' ? 'Requires native macOS Foundation controls.' : !nativeInclude ? 'Matching Auth launch-holder header input not supplied; no native acceptance claimed.' : false,
  timeout: 30000,
}, async () => {
  const header = await readFile(path.join(nativeInclude, 'original-ide-identity-launch-holder.h'));
  assert.equal(header.length, 2258);
  assert.equal(createHash('sha256').update(header).digest('hex'), '384d6a853f770cb7465b6d1bd31bd120182fc6b70a7c6761b6a9a55967af8a83');
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), 'ynx-identity-control-'));
  try {
    const binary = path.join(directory, 'consumer');
    const source = fileURLToPath(new URL('../../../desktop/macos/identity-launch-consumer-test.m', import.meta.url));
    const clang = process.env.YNX_QA_CLANG || '/Library/Developer/CommandLineTools/usr/bin/clang';
    const sdk = process.env.YNX_QA_MACOS_SDK || '/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk';
    execFileSync(clang, ['-fobjc-arc', '-Werror', '-isysroot', sdk, '-mmacosx-version-min=15.0', '-arch', 'arm64', '-I' + nativeInclude, '-framework', 'Foundation', source, '-o', binary], { timeout: 20000, stdio: 'pipe' });
    const output = execFileSync(binary, [], { timeout: 5000, encoding: 'utf8' });
    assert.match(output, /PUBLIC identity-only spawn\/finish.*controls PASS/);
  } finally {
    // Only this newly-created public control output is removed.
    await rm(directory, { recursive: true, force: true });
  }
});
