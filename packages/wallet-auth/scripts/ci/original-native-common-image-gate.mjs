import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const required = Object.freeze([
  'ynx_wallet_capture_original_pay_loan_v1',
  'ynx_wallet_capture_original_pay_channel_v1',
  'ynx_wallet_pay_ctx_current_v1',
  'ynx_wallet_pay_ctx_get_original_loan_v1',
  'ynx_wallet_pay_ctx_get_fence_v1',
  'ynx_wallet_pay_source_adopt_registration_v1',
  'ynx_link_pay_native_startup_open_v1',
  'ynx_link_pay_native_startup_adopt_source_v1',
  'ynx_link_pay_native_startup_join_v1',
  'ynx_link_pay_native_startup_close_v1',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(message) { throw new Error(message); }
function bound(row) {
  if (!row || !row.path?.startsWith('/') || !Number.isSafeInteger(row.bytes) ||
      !/^[a-f0-9]{64}$/.test(row.sha256)) fail('exact input identity required');
  const stat = fs.lstatSync(row.path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('regular input required');
  const bytes = fs.readFileSync(row.path);
  if (bytes.length !== row.bytes || hash(bytes) !== row.sha256) fail('input changed: ' + row.path);
}
function nm(path, flags = ['-g']) {
  const result = spawnSync('/usr/bin/nm', [...flags, path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail('nm failed: ' + result.stderr);
  return result.stdout;
}
function finalImage(path) {
  const result = spawnSync('/usr/bin/otool', ['-hv', path], { encoding: 'utf8' });
  if (result.status !== 0 || !/\b(?:BUNDLE|DYLIB|EXECUTE)\b/.test(result.stdout) || /\bOBJECT\b/.test(result.stdout))
    fail('final common image required; a relocatable object is not a normal link');
}
export function check(plan) {
  if (plan.version !== 1 || !Array.isArray(plan.goArchives) || plan.goArchives.length !== 1)
    fail('exactly one complete Go archive required; never old plus startup archive');
  bound(plan.image);
  bound(plan.goArchives[0]);
  finalImage(plan.image.path);
  const symbols = nm(plan.image.path);
  const attributes = nm(plan.image.path, ['-m']);
  if (attributes.split('\n').some(line => /\bweak\b|\bundefined\b/.test(line) && /\b_ynx_\w+\s*$/.test(line)))
    fail('owned weak/undefined symbol in normal common image');
  for (const symbol of required) {
    const rows = symbols.split('\n').filter(line => line.trim().split(/\s+/).at(-1) === '_' + symbol);
    const attrs = attributes.split('\n').filter(line => line.trim().split(/\s+/).at(-1) === '_' + symbol);
    if (rows.length !== 1 || !/^[a-f0-9]+\s+[TDSB]\s+_/.test(rows[0].trim()) ||
        attrs.length !== 1 || /\bweak\b|\bundefined\b/.test(attrs[0]))
      fail('missing/weak/undefined/duplicate normal callee: ' + symbol);
  }
  // Even a final image with strong definitions must identify the complete archive
  // containing the actual startup bridge, not just an unrelated Go runtime.
  if (!/\bT\s+_ynx_link_pay_native_startup_open_v1\s*$/m.test(nm(plan.goArchives[0].path)))
    fail('Go archive lacks actual strong startup');
  bound(plan.image); bound(plan.goArchives[0]);
  return { version: 1, status: 'COMMON_IMAGE_STRONG_CALLEES_VERIFIED',
    image: plan.image, goArchives: plan.goArchives,
    symbols: required, rootAdmission: false, sourceAdmission: false,
    accountApproval: false, installed: false, signed: false,
    limitation: 'symbol/identity gate only; not Root, actor lifecycle or normal build provenance' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(check(plan), null, 2) + '\n');
}
