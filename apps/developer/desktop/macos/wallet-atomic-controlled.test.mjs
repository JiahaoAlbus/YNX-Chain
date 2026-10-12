import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = dirname(fileURLToPath(import.meta.url));
test('controlled protected provider: original native lock, single-record migration/CAS/recovery', async () => {
  const supplied = process.env.YNX_NATIVE_ATOMIC_TEST_ROOT;
  assert.ok(supplied, 'Provide an explicit private external artifact directory; do not use system temp');
  assert.equal(await realpath(supplied), supplied);
  const metadata = await stat(supplied); assert.equal(metadata.uid, process.getuid());
  assert.equal(metadata.mode & 0o077, 0);
  const root = await mkdtemp(join(supplied, 'native-atomic-test-'));
  const binary = join(root, 'controlled-test');
  const options = { encoding: 'utf8', timeout: 30000, env: { PATH: '/usr/bin:/bin', TMPDIR: root, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' } };
  execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-fobjc-arc', '-fblocks', join(source, 'wallet-atomic-controlled-test.m'), '-o', binary, '-framework', 'Foundation', '-framework', 'Security'], options);
  for (const mode of ['run', 'migration', 'completion', 'journal']) {
    const state = await mkdtemp(join(root, `${mode}-`));
    const output = execFileSync(binary, [mode, state], options);
    assert.match(output, mode === 'run' ? /CONTROLLED_ATOMIC_PASS/ : mode === 'migration' ? /MIGRATION_CORRUPTION_PASS/ : mode === 'completion' ? /SIGNED_COMPLETION_PASS/ : /CONSUMER_JOURNAL_PASS/);
  }
  // Retain isolated evidence under the operator-supplied directory. The fixture
  // overrides every protected provider/key method; it never opens a Keychain.
});
