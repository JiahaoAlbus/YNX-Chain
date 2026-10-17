import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./consensus-local-window.mjs', import.meta.url));
test('expanded plans remain prepare-only and do not expand resource budgets', { skip: process.platform !== 'darwin' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-window-plan-'));
  try {
    for (const name of ['ynx-consensus-perf-fixture', 'ynx-abci', 'ynx-consensus-perf-client', 'ynx-consensus-perf-host', 'cometbft']) {
      // Empty executables deliberately cannot produce a valid fixture/node.
      // Preparation must only inspect them, never run them or create data.
      fs.writeFileSync(path.join(root, name), '', { mode: 0o700 });
    }
    const work = path.join(root, 'must-not-exist');
    for (const [count, rate] of [[512, 256], [1024, 1000], [2048, 1000]]) {
      const r = spawnSync(process.execPath, [runner, '--count', String(count), '--offered-rate', String(rate), '--bin-dir', root, '--comet-bin', path.join(root, 'cometbft'), '--work-parent', work], { encoding: 'utf8', timeout: 5000 });
      assert.equal(r.status, 0, r.stderr);
      const plan = JSON.parse(r.stdout);
      assert.equal(plan.status, 'prepared_only_no_processes_started');
      assert.equal(plan.count, count);
      assert.equal(plan.caps.rssBytes, 1024 ** 3);
      assert.equal(plan.caps.dataBytes, 32 * 1024 ** 2);
      assert.equal(plan.caps.activeMs, 45000);
      assert.equal(plan.caps.cleanupMs, 15000);
      assert.equal(plan.caps.rootDiskReserveBytes, 425 * 1024 ** 2);
      assert.equal(fs.existsSync(work), false);
    }
    for (const [count, rate] of [[0, 1], [2049, 1000], [1.5, 1], [32, 'NaN'], [32, 2049], [2048, 1]]) {
      const r = spawnSync(process.execPath, [runner, '--count', String(count), '--offered-rate', String(rate), '--bin-dir', root, '--comet-bin', path.join(root, 'cometbft'), '--work-parent', work], { encoding: 'utf8', timeout: 5000 });
      assert.notEqual(r.status, 0);
      assert.equal(fs.existsSync(work), false);
    }
  } finally { fs.rmSync(root, { recursive: true }); }
});
