// PUBLIC metadata-only negatives. No original A runtime, Native, keys or I/O
// qualification; these fixtures cannot produce a reuse receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createMainComponentCompileReuseBinding, inspectMainComponentPlanData} from '../scripts/normal-native-main-component-reuse.mjs';

const anchor = {
  path: '/Volumes/西部数据/YNX-large-work/original-a-builds/wallet-main711-auth26-component-light-intake-20261024/component-suffix-r2-once/MAIN711_AUTH26_COMPLETE_MATCHING_COMPONENT_HANDOFF.json',
  bytes: 47461,
  sha256: '5812ebd34aa76e532dd71cc038338fdee449baa61398ce097a247aef2cfb8dcc',
};
function fixture(run) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'PUBLIC-main-component-reuse-'));
  try {
    const sourceTuplePath = join(root, 'source.json'), targetTuplePath = join(root, 'target.json');
    writeFileSync(sourceTuplePath, JSON.stringify({version: '1.3.0-pq.3.32-auth.26'}));
    writeFileSync(targetTuplePath, JSON.stringify({version: '1.3.0-pq.3.32-auth.28'}));
    return run({sourceExecutionHandoff: {...anchor}, sourceTuplePath, targetTuplePath}, root);
  } finally { rmSync(root, {recursive: true, force: true}); }
}
const rejects = (request, code) => assert.throws(() => createMainComponentCompileReuseBinding(request), error => error.code === code);

test('PUBLIC exact A26 anchor and 26-to-28 tuples require independent Main profile; no receipt', () => fixture(request => {
  rejects(request, 'MAIN_COMPONENT_REUSE_TARGET_MAIN_PROFILE_REQUIRED');
  rejects({...request, targetMainProfileHandoff: null}, 'MAIN_COMPONENT_REUSE_TARGET_MAIN_PROFILE_REQUIRED');
}));

test('PUBLIC old versions and generic/changed source handoffs cannot select Main17 branch', () => fixture(request => {
  rejects({...request, sourceExecutionHandoff: {...anchor, sha256: '0'.repeat(64)}}, 'MAIN_COMPONENT_REUSE_SOURCE_HANDOFF');
  writeFileSync(request.sourceTuplePath, JSON.stringify({version: '1.3.0-pq.3.32-auth.23'}));
  rejects(request, 'MAIN_COMPONENT_REUSE_VERSION');
  writeFileSync(request.sourceTuplePath, JSON.stringify({version: '1.3.0-pq.3.32-auth.26'}));
  writeFileSync(request.targetTuplePath, JSON.stringify({version: '1.3.0-pq.3.32-auth.24'}));
  rejects(request, 'MAIN_COMPONENT_REUSE_VERSION');
}));

test('PUBLIC correctly pinned fake profile cannot mint receipt; tampered profile and symlink rejected', () => fixture((request, root) => {
  const path = join(root, 'profile.json'), raw = Buffer.from(JSON.stringify({schema: 'PUBLIC_FAKE_MAIN28_PROFILE', qualified: true}));
  writeFileSync(path, raw);
  const ref = {path, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex')};
  rejects({...request, targetMainProfileHandoff: ref}, 'MAIN_COMPONENT_REUSE_TARGET_MAIN_PROFILE_UNSUPPORTED');
  rejects({...request, targetMainProfileHandoff: {...ref, sha256: '0'.repeat(64)}}, 'MAIN_COMPONENT_REUSE_INPUT_DIFFERS');
  const link = join(root, 'profile-link.json'); symlinkSync(path, link);
  rejects({...request, targetMainProfileHandoff: {...ref, path: link}}, 'MAIN_COMPONENT_REUSE_SYMLINK');
}));

test('PUBLIC malformed getter never executes or becomes profile authority', () => fixture(request => {
  let calls = 0;
  Object.defineProperty(request, 'targetMainProfileHandoff', {get() { calls++; throw null; }});
  rejects(request, 'MAIN_COMPONENT_REUSE_DATA');
  assert.equal(calls, 0);
}));

function publicPlan(role, root = '/PUBLIC/owned') {
  const sources = Array.from({length: role === 'node' ? 17 : 11}, (_, i) => `${root}/src/${role}${i}.mm`);
  const output = `${root}/out/${role}`;
  const argv = role === 'node' ? ['-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI=1', '-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL=1', '-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1', '-DYNX_ORIGINAL_WALLET_ARTIFACT_CABI=1', '-DNAPI_VERSION=8', '-framework', 'LocalAuthentication'] : [];
  argv.push('-mmacosx-version-min=13.0', '-arch', 'arm64', ...sources);
  if (role === 'node') argv.push(`${root}/apps/wallet-desktop/native/libynx_project_control.a`);
  argv.push('-o', output);
  return {sources, output, commands: [{tool: '/usr/bin/clang++', argv}], ownedUndefinedScan: {tool: '/usr/bin/nm', argv: ['-u', output], rejectPattern: 'YNX|ynx'}};
}
test('PUBLIC successor plan DATA compares roots without producing or executing a plan', () => {
  for (const role of ['node', 'helper']) {
    assert.deepEqual(inspectMainComponentPlanData(publicPlan(role), '/PUBLIC/owned', role), inspectMainComponentPlanData(publicPlan(role, '/PUBLIC/target'), '/PUBLIC/target', role));
  }
});
test('PUBLIC successor plan rejects missing Main role, extra archive and helper LA', () => {
  const reject = (plan, role, code) => assert.throws(() => inspectMainComponentPlanData(plan, '/PUBLIC/owned', role), e => e.code === code);
  let p = publicPlan('node'); p.commands[0].argv.shift(); reject(p, 'node', 'MAIN_COMPONENT_REUSE_ROLE_FLAGS');
  p = publicPlan('node'); p.commands[0].argv.splice(-2, 0, '/PUBLIC/owned/libsecond.a'); reject(p, 'node', 'MAIN_COMPONENT_REUSE_ARCHIVE');
  p = publicPlan('helper'); p.commands[0].argv.unshift('-framework', 'LocalAuthentication'); reject(p, 'helper', 'MAIN_COMPONENT_REUSE_LOCAL_AUTHENTICATION');
});
test('PUBLIC successor plan rejects wrong ABI, TU permutation and source traversal', () => {
  const reject = (p, code) => assert.throws(() => inspectMainComponentPlanData(p, '/PUBLIC/owned', 'node'), e => e.code === code);
  let p = publicPlan('node'); p.commands[0].argv[p.commands[0].argv.indexOf('arm64')] = 'x86_64'; reject(p, 'MAIN_COMPONENT_REUSE_ABI');
  p = publicPlan('node'); [p.sources[1], p.sources[2]] = [p.sources[2], p.sources[1]]; reject(p, 'MAIN_COMPONENT_REUSE_TU_ORDER');
  p = publicPlan('node'); p.sources[0] = '/PUBLIC/owned/src/../outside.mm'; reject(p, 'MAIN_COMPONENT_REUSE_PLAN_ROOT');
});
