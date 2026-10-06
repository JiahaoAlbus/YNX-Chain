import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('native drawing eligibility supports an interactive window without treating unknown occlusion bits as visibility', {
  skip: process.platform !== 'darwin',
}, async () => {
  const source = await readFile(new URL('../desktop/macos/main.m', import.meta.url), 'utf8');
  const policy = source.match(/static BOOL YNXLocalWindowRenderEligible\([^]*?\n\}/)?.[0];
  assert.ok(policy);
  const root = await mkdtemp('/private/tmp/ynx-native-render-');
  const binary = join(root, 'policy');
  try {
    await writeFile(join(root, 'policy.m'), `#import <AppKit/AppKit.h>\n#include <assert.h>\n${policy}\nint main(void) {
      // The observed 8192 value lacks the documented visible bit. It cannot
      // enable a background window, but real foreground/key state can.
      assert(!(8192 & NSWindowOcclusionStateVisible));
      assert(!YNXLocalWindowRenderEligible(YES,NO,YES,NO,8192,NO,NO,YES,NO));
      assert(YNXLocalWindowRenderEligible(YES,NO,YES,NO,8192,YES,YES,YES,NO));
      assert(YNXLocalWindowRenderEligible(YES,NO,YES,NO,NSWindowOcclusionStateVisible,NO,NO,YES,NO));
      assert(!YNXLocalWindowRenderEligible(YES,NO,YES,NO,0,YES,NO,YES,NO));
      assert(!YNXLocalWindowRenderEligible(YES,NO,YES,NO,0,NO,YES,YES,NO));
      assert(!YNXLocalWindowRenderEligible(NO,NO,YES,NO,NSWindowOcclusionStateVisible,YES,YES,YES,NO));
      assert(!YNXLocalWindowRenderEligible(YES,YES,YES,NO,NSWindowOcclusionStateVisible,YES,YES,YES,NO));
      assert(!YNXLocalWindowRenderEligible(YES,NO,NO,NO,NSWindowOcclusionStateVisible,YES,YES,YES,NO));
      assert(!YNXLocalWindowRenderEligible(YES,NO,YES,YES,NSWindowOcclusionStateVisible,YES,YES,YES,NO));
      assert(!YNXLocalWindowRenderEligible(YES,NO,YES,NO,NSWindowOcclusionStateVisible,YES,YES,NO,NO));
      assert(!YNXLocalWindowRenderEligible(YES,NO,YES,NO,NSWindowOcclusionStateVisible,YES,YES,YES,YES));
      return 0;
    }`);
    const exec = promisify(execFile);
    await exec('/Library/Developer/CommandLineTools/usr/bin/clang', [
      '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-isysroot',
      '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
      join(root, 'policy.m'), '-framework', 'AppKit', '-o', binary,
    ]);
    await exec(binary);
    await exec('/Library/Developer/CommandLineTools/usr/bin/clang', [
      '-fsyntax-only', '-fobjc-arc', '-fblocks', '-isysroot',
      '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
      fileURLToPath(new URL('../desktop/macos/main.m', import.meta.url)),
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
