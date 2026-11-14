import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, AUTH_SERVER_CURRENT_STAGE: root, AUTH_SERVER_CURRENT_PUBLIC_PARENT: homedir() };
function run(args, expected) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 180000 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error || result.status !== 0) throw result.error ?? new Error(`command failed: ${result.status}`);
  if (expected && (!result.stdout.includes(`# tests ${expected}\n`) || !result.stdout.includes(`# pass ${expected}\n`) || !result.stdout.includes('# fail 0\n') || !result.stdout.includes('# skipped 0\n'))) throw new Error('expected test count did not run cleanly');
}
run(['--test', '--test-reporter=tap', '--test-name-pattern=^per-held release', 'test/auth-server-device-current/server-current.test.mjs'], 7);
run(['--test', '--test-reporter=tap', '--test-name-pattern=^per-held launcher', 'test/server-current-normal-launcher.test.mjs'], 1);
run(['node_modules/typescript/bin/tsc', '--strict', '--skipLibCheck', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'test/auth-server-current-types.mts']);
