import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PUBLIC normal native caller adopts original parent and routes owned backend through adapter', async () => {
  const main = await readFile(new URL('./main.m', import.meta.url), 'utf8');
  assert.match(main, /YNXAcquireWalletAdmissionParent\(\[self resources\]\)/);
  assert.match(main, /initWithParent:_localWalletAdmissionParent resources:\[self resources\]/);
  assert.match(main, /_server\.standardInput=_localGoInput/);
  assert.match(main, /_server\.standardOutput=_serverLog; _server\.standardError=_serverLog/);
  assert.match(main, /YNXWalletAdmissionBackendTask \*task/);
  assert.match(main, /cancelLocalReadiness\];\[_server retireAdmission\]/);
});
test('PUBLIC native propagation has exact descriptor staging and owned-PID exit fence', async () => {
  const header = await readFile(new URL('./ynx-wallet-admission-launch.h', import.meta.url), 'utf8');
  assert.match(header, /YNXOriginalAcquireIDEAdmissionParent.*weak_import/);
  assert.match(header, /guard\.parentPID!=getppid\(\)/);
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
  assert.match(header, /@catch\(id error\)\{_admissionCleanupFailure=error;_cleanupComplete=NO/);
  assert.match(header, /finishAdmissionCleanup.*return _cleanupComplete/);
  assert.match(main, /replyToApplicationShouldTerminate:accepted&&\[self finishLocalWalletAdmissionCleanup\]/);
  assert.match(main, /_localWalletParentCloseSelected=YES/);
  assert.match(main, /if\(!\[_server finishAdmissionCleanup\]\)return NO/);
});
