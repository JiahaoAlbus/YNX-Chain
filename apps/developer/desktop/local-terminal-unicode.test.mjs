import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { localWorkbenchEnvironment } from './local-workbench.mjs';

const require = createRequire(new URL('../runtime/theia/package.json', import.meta.url));
const pty = require('node-pty');
test('local interactive Bash preserves Chinese and spaced paths sent through the actual PTY', { timeout: 10000 }, async () => {
  const env = localWorkbenchEnvironment({ node: process.execPath, runtime: { root: '/private/tmp' }, context: { workspace: '/private/tmp', profile: '/private/tmp', id: 'unicode-qa', temporary: '/private/tmp' }, plugins: '/private/tmp' });
  const expected = '/private/tmp/中文目录 hello/hello.py';
  const result = await new Promise((resolve, reject) => {
    const terminal = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-i'], { env: { ...env, PS1: 'YNX_READY> ' }, cwd: '/private/tmp', cols: 200, rows: 24 });
    let output = '', sent = false;
    terminal.onData(data => {
      output += data;
      if (!sent && output.includes('YNX_READY> ')) {
        sent = true;
        terminal.write(`printf 'YNX_RESULT:%s\\n' '${expected}'\rexit\r`);
      }
    });
    terminal.onExit(({ exitCode }) => exitCode === 0 ? resolve(output) : reject(Error(output)));
  });
  assert.ok(result.includes(`YNX_RESULT:${expected}`), result);
});
