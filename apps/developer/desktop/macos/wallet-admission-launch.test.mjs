import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

test('PUBLIC normal native caller adopts original parent and routes owned backend through adapter', async () => {
  const main = await readFile(new URL('./main.m', import.meta.url), 'utf8');
  assert.match(main, /YNXAcquireWalletAdmissionOutcome\(\[self resources\]\)/);
  assert.match(main, /initWithAcquireOutcome:_localWalletAdmissionAcquireOutcome resources:\[self resources\]/);
  assert.match(main, /_server\.standardInput=_localGoInput/);
  assert.match(main, /_server\.standardOutput=_serverLog; _server\.standardError=_serverLog/);
  assert.match(main, /YNXWalletAdmissionBackendTask \*task/);
  assert.match(main, /cancelLocalReadiness\];\[self finishLocalWalletAdmissionCleanup\]/);
  const cleanup = main.slice(main.indexOf('- (BOOL)finishLocalWalletAdmissionCleanup {'), main.indexOf('- (NSApplicationTerminateReply)applicationShouldTerminate:'));
  assert.match(cleanup, /\[_server retireAdmission\]/);
});
test('PUBLIC native propagation has exact descriptor staging and owned-PID exit fence', async () => {
  const header = await readFile(new URL('./ynx-wallet-admission-launch.h', import.meta.url), 'utf8');
  assert.match(header, /return YNXOriginalAcquireIDEAdmissionParent\(resources,getppid\(\),&error\)/);
  assert.doesNotMatch(header, /weak_import/);
  assert.match(header, /_parent\.parentPID!=getppid\(\)/);
  assert.match(header, /int targets\[4\]=\{0,1,2,4\}/);
  assert.match(header, /F_DUPFD_CLOEXEC,10/); assert.match(header, /POSIX_SPAWN_CLOEXEC_DEFAULT/);
  assert.match(header, /posix_spawn\(&_pid/); assert.match(header, /WEXITED\|WNOWAIT/);
  assert.match(header, /_running=NO;\s*do\{waited=waitpid/);
  assert.doesNotMatch(header, /socketpair\(|bind\(|listen\(|execvp\(|system\(/);
});

test('P2 repair native construction fixes identity before first current callback', async () => {
  const header = await readFile(new URL('./ynx-wallet-admission-launch.h', import.meta.url), 'utf8');
  const init = header.slice(header.indexOf('- (instancetype)initWithParent:', header.indexOf('@implementation')), header.indexOf('- (BOOL)isRunning'));
  assert.ok(init.indexOf('self.executableURL=[resources URLByAppendingPathComponent:@"runtime/node"]') < init.indexOf('[self current:&error]'));
  assert.match(init, /_cleanupComplete=parent==nil/);
  const harness = await readFile(new URL('./wallet-admission-launch-test.m', import.meta.url), 'utf8');
  assert.match(harness, /initWithParent:parent resources:resources/); assert.match(harness, /parent\.seenNode/);
});
test('P2 repair native cleanup is once-only observable and normal quit preserves incomplete owner', async () => {
  const header = await readFile(new URL('./ynx-wallet-admission-launch.h', import.meta.url), 'utf8');
  const main = await readFile(new URL('./main.m', import.meta.url), 'utf8');
  assert.match(header, /_parent&&!_cleanupSelected/); assert.match(header, /_cleanupSelected=YES;@try/);
  assert.match(header, /_parentCleanupFailure=error/);
  assert.match(header, /if\(!_admissionCleanupFailure\)_admissionCleanupFailure=error/);
  assert.match(header, /_cleanupComplete=!_channelCleanupFailed/);
  assert.match(header, /finishAdmissionCleanup.*return _cleanupComplete/);
  assert.match(main, /replyToApplicationShouldTerminate:accepted&&\[self finishLocalWalletAdmissionCleanup\]/);
  assert.match(main, /_localWalletParentCloseSelected=YES/);
  assert.match(main, /if\(!\[_server finishAdmissionCleanup\]\)return NO/);
});

// New whole-BackendTask controls. Existing historical controls above are kept;
// this batch selects only the owned-channel tests and never reruns old greens.
let probes;
const commands = [];
function publicCommand(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1000000 });
  commands.push({ executable, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  if (probes) writeFileSync(join(probes.root, 'RAW_COMMANDS.json'), JSON.stringify(commands, null, 2) + '\n');
  return result;
}
function publicProbes() {
  if (probes) return probes;
  const evidence = process.env.YNX_OWNED_CLOSE_CONTROLS;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(evidence || tmpdir(), 'ynx-owned-close-'));
  probes = { root, fixed: join(root, 'fixed-probe'), parent: join(root, 'parent-probe') };
  const folder = fileURLToPath(new URL('.', import.meta.url));
  const clang = '/Library/Developer/CommandLineTools/usr/bin/clang';
  const base = ['-fobjc-arc', '-mmacosx-version-min=15.0', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-fmodules-cache-path=' + join(root, 'modules'), join(folder, 'wallet-admission-launch-test.m'), join(folder, 'ynx-wallet-admission-parent.m'), '-framework', 'Cocoa', '-framework', 'Security'];
  let result = publicCommand(clang, [...base, '-o', probes.fixed]);
  assert.equal(result.status, 0, result.stderr);
  if (process.env.YNX_OWNED_CLOSE_PARENT_HEADER) {
    result = publicCommand(clang, [...base, '-DYNX_PUBLIC_ADMISSION_HEADER=' + JSON.stringify(process.env.YNX_OWNED_CLOSE_PARENT_HEADER), '-o', probes.parent]);
    assert.equal(result.status, 0, result.stderr);
  }
  return probes;
}
after(() => { if (probes && !process.env.YNX_OWNED_CLOSE_CONTROLS) rmSync(probes.root, { recursive: true, force: true }); });

for (const mode of ['eio', 'eintr', 'double']) {
  test(`owned channel ${mode}: actual launch/retire preserves debt and never recloses a recycled descriptor`, () => {
    const pair = publicProbes();
    const result = publicCommand(pair.fixed, [mode]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /actual BackendTask launch\/retire\/status PASS/);
  });
}
for (const mode of ['clean', 'ordinary']) {
  test(`owned channel ${mode}: actual clean lifecycle completes`, () => {
    const pair = publicProbes();
    const result = publicCommand(pair.fixed, [mode]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS/);
  });
}
test('owned channel exact parent counterfactual exposes all three failures; clean controls pass', { skip: !process.env.YNX_OWNED_CLOSE_PARENT_HEADER }, () => {
  const pair = publicProbes();
  for (const mode of ['eio', 'eintr', 'double']) {
    const result = publicCommand(pair.parent, [mode]);
    assert.notEqual(result.status, 0, `Parent unexpectedly accepted ${mode}`);
    assert.match(result.stderr, /PUBLIC control failed (7|8):/);
  }
  for (const mode of ['clean', 'ordinary']) {
    const result = publicCommand(pair.parent, [mode]);
    assert.equal(result.status, 0, result.stderr);
  }
});
