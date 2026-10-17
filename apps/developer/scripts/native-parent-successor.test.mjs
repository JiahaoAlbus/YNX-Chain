import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const scripts = dirname(fileURLToPath(import.meta.url));
const native = resolve(scripts, '../../../packages/wallet-auth/native');
const compiler = '/Library/Developer/CommandLineTools/usr/bin/clang++';
// Compile the included production source/header from this candidate, not a
// second copy of the implementation. Source authority is a PUBLIC test double.
for (const [name, objectiveC] of [
  ['sequence-post-fence.test.mm', true],
  ['deadline-post-io.test.cc', false],
  ['transport-regression.test.cc', false],
  ['bounded-io.test.cc', false],
  ['foundation-pump.test.mm', true],
]) {
  test(`actual candidate Native lifecycle: ${name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ynx-ide-native-successor-'));
    try {
      const binary = join(directory, 'control');
      const args = ['-std=c++17', '-Wall', '-Wextra', '-Werror',
        '-mmacosx-version-min=13.0', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-I', native];
      if (objectiveC) args.push('-fobjc-arc', '-framework', 'Foundation');
      args.push(join(scripts, 'fixtures/native-parent-successor', name), '-o', binary);
      const compile = spawnSync(compiler, args, {encoding:'utf8', timeout:30000});
      assert.equal(compile.error, undefined, compile.error?.message);
      assert.equal(compile.status, 0, compile.stderr);
      const result = spawnSync(binary, [], {encoding:'utf8', timeout:30000});
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, result.stderr);
    } finally { rmSync(directory, {recursive:true, force:true}); }
  });
}
