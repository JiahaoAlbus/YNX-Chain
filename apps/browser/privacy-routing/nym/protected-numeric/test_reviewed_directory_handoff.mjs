import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readReviewedDirectoryCapture } from './fetch-reviewed-directory.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const scopeSHA256 = '8'.repeat(64);
const binarySHA256 = '9'.repeat(64);
const now = Date.now();
const root = process.env.YNX_NYM_TEST_OUTPUT ?? os.tmpdir();
const capture = fileURLToPath(new URL('./capture-reviewed-directory.py', import.meta.url));

const ownerGuard = '/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-qa-cdn-fullfeature-20261108/run_fullfeature_v4.py';
test('same owned Python capture binds the original receipt and exact three tables',
     { skip: process.platform !== 'darwin' || !existsSync(ownerGuard) }, () => {
  const parent = mkdtempSync(path.join(root, 'normal-directory-handoff.'));
  const scenario = String.raw`
import importlib.util, json, os, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
capture, parent = map(Path, sys.argv[1:3])
scope, digest = sys.argv[3:5]
spec = importlib.util.spec_from_file_location("owned", capture)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
guard = module.load_guard()
case = parent / ("normal-directory-once-" + scope); case.mkdir(mode=0o700)
now = datetime.now(timezone.utc)
table = {"data":[{"node_id":1}],"pagination":{"page":0,"total":1,"size":1}}
doc = {"schema":"YNX_NYM_DIRECTORY_V1","basic":{"metadata":{"status":None,"absolute_epoch_id":7,"rotation_id":5,"refreshed_at":now.strftime("%Y-%m-%d %H:%M:%S.%f +00:00:00")},"nodes":table},
       "described":table,"epoch":{"current_epoch_start":now.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),"total_elapsed_epochs":7,"epoch_length":{"secs":3600,"nanos":0}}}
result=module.process_capture(guard,case,[sys.executable,"-IB","-c","import sys;print(sys.argv[1])",json.dumps(doc)],{"PATH":"/usr/bin:/bin"},
       now+timedelta(seconds=5),time.monotonic_ns()+5000000000,binding={"scopeSHA256":scope,"binarySHA256":digest})
assert result["state"]=="fetched" and result["remainingOwned"]==[], result
receipt=case/"operation.json"
print(json.dumps({"state":result["state"],"out":result["out"],"receipt":str(receipt),"firstFailure":None,"receiptSHA256":module.sha(receipt)}))
`;
  const result = spawnSync('/usr/bin/python3', ['-IB', '-c', scenario, capture, parent, scopeSHA256, binarySHA256],
                           { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse(result.stdout);
  const pins = { root: parent, scopeSHA256, binarySHA256, now };
  const accepted = readReviewedDirectoryCapture(message, pins);
  assert.equal(accepted.epoch.total_elapsed_epochs, 7);
  assert.equal(accepted.digests.length, 3);
  assert.throws(() => readReviewedDirectoryCapture(message, { ...pins, binarySHA256: 'a'.repeat(64) }), /receipt rejected/);
  assert.throws(() => readReviewedDirectoryCapture(message, { ...pins, now: now + 10000 }), /receipt rejected/);
  writeFileSync(path.join(message.out, 'basic.json'), '{"modified":true}\n');
  assert.throws(() => readReviewedDirectoryCapture(message, pins), /table changed/);
});

test('receipt and output cannot point to another scope or be rebound after cancellation', () => {
  const parent = mkdtempSync(path.join(root, 'normal-directory-handoff.'));
  const dir = path.join(parent, 'normal-directory-once-' + scopeSHA256);
  const out = path.join(dir, 'tables');
  mkdirSync(dir, { mode: 0o700 });
  mkdirSync(out, { mode: 0o700 });
  const receipt = path.join(dir, 'operation.json');
  const failed = JSON.stringify({ schema: 'P05_NYM_NORMAL_DIRECTORY_OWNED_CAPTURE_V1', state: 'failed',
                                   firstFailure: 'directory-cancelled', out: null });
  writeFileSync(receipt, failed, { mode: 0o600 });
  const result = { state: 'fetched', out, receipt, firstFailure: null, receiptSHA256: hash(failed) };
  const pins = { root: parent, scopeSHA256, binarySHA256, now };
  assert.throws(() => readReviewedDirectoryCapture(result, pins), /receipt rejected/);
  assert.throws(() => readReviewedDirectoryCapture({ ...result, out: dir }, pins), /result rejected/);
  assert.throws(() => readReviewedDirectoryCapture({ ...result, receiptSHA256: '0'.repeat(64) }, pins), /receipt changed/);
  chmodSync(receipt, 0o644);
  assert.throws(() => readReviewedDirectoryCapture(result, pins), /Invalid private/);
});
