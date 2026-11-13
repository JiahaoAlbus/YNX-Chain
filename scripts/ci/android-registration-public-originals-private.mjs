import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = join(root, 'packages/wallet-auth');
const out = process.env.YNX_PUBLIC_ORIGINALS_OUT ?? mkdtempSync(join(tmpdir(), 'ynx-public-originals-'));
const env = { ...process.env, YNX_PENDING_BUNDLE: join(out, 'PENDING_SOURCE_ONLY_COLLECTOR.bundle.js') };
mkdirSync(out, { recursive: true });
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run([join(pkg, 'scripts/build-original-device-pending-source-private-bundle.mjs'), '--out=' + out]);
run(['--test', join(pkg, 'test/android-registration-public-originals-private.test.mjs')]);
run([
  join(pkg, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false',
  '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--target', 'ES2022', join(pkg, 'test/types/android-registration-public-originals-private.mts'),
]);

writeFileSync(join(out, 'PUBLIC_ORIGINALS_CI_RESULT.json'), JSON.stringify({
  sourceCommit: process.env.GITHUB_SHA ?? null,
  passed: true,
  actualBundleNodeVM: true,
  strictTypes: true,
  HermesExecuted: false,
  NativeExecuted: false,
  MainJournalExecuted: false,
  RootAdmission: false,
  SourceAdmission: false,
}, null, 2) + '\n');
