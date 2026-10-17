import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('real signed native peers: exact project focus, wrong project/code, unready/retired owner and cleanup', { skip: process.platform !== 'darwin', timeout: 30000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'ynx-native-focus-test-'));
  try {
    const binary = join(root, 'owner-control'), foreign = join(root, 'foreign-control');
    execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang', [
      '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-mmacosx-version-min=15.0',
      '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
      fileURLToPath(new URL('./macos/project-focus-control.m', import.meta.url)),
      '-framework', 'Cocoa', '-framework', 'Security', '-o', binary,
    ], { timeout: 15000 });
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.ynx.control.focus-owner', binary]);
    copyFileSync(binary, foreign);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.ynx.control.foreign-peer', foreign]);
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, YNX_FOCUS_FOREIGN_BINARY: foreign } });
    assert.match(output, /^PASS same-code real peer activates once;/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
