import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const bytes = (path) => readFileSync(path);
const json = (path) => JSON.parse(bytes(path).toString('utf8'));
const requestPath = `${root}/apps/finance/evidence/finance-p0304-execution-objects-request-20260831.json`;
const candidatePath = `${root}/apps/finance/evidence/finance-p0304-unsigned-lease-stdin-candidate-20260831.json`;
const argvPath = `${root}/apps/finance/evidence/finance-p0304-literal-argv-candidate-20260831.json`;
const observerPath = `${root}/apps/finance/evidence/finance-p0304-parent-preserving-observer-contract-20260831.json`;
const handoffPath = `${root}/apps/finance/FINANCE_P0304_EXECUTION_OBJECTS_HANDOFF_20260831.md`;
const request = json(requestPath);

function identity(path) {
  const raw = bytes(`${root}/${path}`);
  return {
    blob: execFileSync('git', ['hash-object', `${root}/${path}`], { encoding: 'utf8' }).trim(),
    bytes: raw.length,
    sha256: sha(raw)
  };
}

function assertLiteralArgv(argv) {
  assert.equal(argv.length, 25, 'exact direct process argv length');
  assert.equal(argv[0], '/bin/bash');
  assert.match(argv[1], /finance-phase3-openssh-serialized-command\.sh$/);
  assert.equal(argv[2], '/tmp/ynx-finance-p0304-finance-phase3-20260831t030400z-unsigned.json');
  assert.equal(argv[3], '/tmp/ynx-finance-p0304-finance-phase3-20260831t030400z.stdout');
  assert.equal(argv[4], '/tmp/ynx-finance-p0304-finance-phase3-20260831t030400z.stderr');
  assert.equal(argv[5], '/tmp/ynx-finance-p0304-finance-phase3-20260831t030400z.receipt');
  assert.equal(argv[9], 'p0304-finance-phase3-20260831t030400z');
  assert.equal(argv[20].length, 34508, 'executor is an exact base64 argument, not a path or shell expansion');
  assert.equal(argv[21], '25880');
  assert.equal(argv[22], 'd3b604223a6f1e93279481a8b0db06ddb6acfb20dff316d22329337498d2bcdb');
  for (const value of argv) {
    assert.equal(typeof value, 'string');
    assert.equal(/[\r\n;$`|&]/.test(value), false, 'literal argv rejects shell, variable and string-concatenation tokens');
  }
}

assert.equal(request.taskId, 'P0-304');
assert.equal(request.status, 'SOURCE_ONLY_UNSIGNED_CENTRAL_SIGNATURE_READY_P0304_NAMESPACE_CORRECTED');
assert.deepEqual(request.truth, {
  centralSignaturePresent: false,
  leaseIssued: false,
  sshExecuted: false,
  deployed: false,
  publicVerified: false,
  accountApproved: false,
  signatureCreated: false,
  transactionSubmitted: false
});
assert.equal(request.predecessor.p0303CentralCommit, '8a15916604e8115c1bc13ebb21a5391a771bd505');
assert.equal(request.reviewedExecutor.blob, '69f69b46d1290e95e9c99b5ee03f459799e80cd7');
for (const item of [request.reviewedExecutor, request.reviewedTransport, request.reviewedBootstrap]) {
  assert.equal(sha(bytes(`${root}/${item.path}`)), item.sha256, `${item.path} content SHA`);
}
for (const [name, expected] of Object.entries(request.candidateObjects)) {
  assert.deepEqual(identity(expected.path), { blob: expected.blob, bytes: expected.bytes, sha256: expected.sha256 }, `${name} identity`);
}
assert.deepEqual(identity(request.verificationFixture.path), {
  blob: request.verificationFixture.blob,
  bytes: request.verificationFixture.bytes,
  sha256: request.verificationFixture.sha256
}, 'verification fixture identity');

const candidate = json(candidatePath);
const candidateRaw = bytes(candidatePath);
assert.equal(candidate.lease.signed, false);
assert.equal(candidate.lease.centralSignature, null);
assert.equal(candidate.executionCandidate.executable, false);
assert.equal(candidate.executionCandidate.state, 'UNSIGNED_CENTRAL_SIGNATURE_REQUIRED');
assert.equal(candidate.executionCandidate.p0303Terminal.commit, request.predecessor.p0303CentralCommit);

const argvManifest = json(argvPath);
const argvRaw = bytes(argvPath);
assertLiteralArgv(argvManifest.argv);
const encodedArgv = Buffer.from(JSON.stringify(argvManifest.argv));
assert.equal(argvManifest.argvJsonBytes, encodedArgv.length);
assert.equal(argvManifest.argvJsonSha256, sha(encodedArgv));
assert.equal(argvManifest.unsignedStdinCandidate.bytes, candidateRaw.length);
assert.equal(argvManifest.unsignedStdinCandidate.sha256, sha(candidateRaw));
assert.equal(argvManifest.unsignedStdinCandidate.executionPath, argvManifest.argv[2]);
assert.equal(argvManifest.argv[23], String(candidateRaw.length));
assert.equal(argvManifest.argv[24], sha(candidateRaw));

const observer = json(observerPath);
assert.deepEqual(observer.literalArgv, argvManifest.argv);
assert.equal(observer.literalArgvJsonSha256, argvManifest.argvJsonSha256);
assert.equal(observer.argvManifest.bytes, argvRaw.length);
assert.equal(observer.argvManifest.sha256, sha(argvRaw));
assert.deepEqual(observer.declaredOutputArgvIndexes, [3, 4, 5]);
assert.equal(JSON.stringify(observer.environment), '{}');
assert.equal(observer.shell, false);
assert.equal(observer.stdio, 'inherit');
assert.equal(observer.parentPreservation.observerMustNotOpenOrInspectDeclaredOutputs, true);

const six = request.uniqueSixPathNamespace;
assert.deepEqual(Object.keys(six).sort(), ['backup', 'backupContainer', 'id', 'release', 'releaseContainer', 'stage', 'stageContainer'].sort());
assert.equal(six.stage, `${six.stageContainer}/stage`);
assert.equal(six.backup, `${six.backupContainer}/backup`);
assert.equal(six.release, `${six.releaseContainer}/ynx-finance-7824af677dd0`);
assert.equal(request.exactOutputPaths.phaseReceipt, request.exactOutputPaths.stdout);
assert.equal(request.exactOutputPaths.phaseReceiptPending, request.exactOutputPaths.transportReceiptPending);
assert.equal(request.literalExecution.shellOrVariableReconstructionForbidden, true);
assert.equal(request.literalExecution.oneSshAttempt, 1);
assert.equal(request.literalExecution.oneDeployInvocation, 1);
assert.equal(request.literalExecution.retryAllowed, false);

const staleMarker = String.fromCharCode(80, 48, 50, 57, 56);
for (const path of [requestPath, candidatePath, argvPath, observerPath, handoffPath, fileURLToPath(import.meta.url)]) {
  assert.equal(bytes(path).includes(Buffer.from(staleMarker)), false, `stale namespace reference in ${path}`);
}

const mutated = [...argvManifest.argv];
mutated[3] = '$(echo reconstructed)';
assert.throws(() => assertLiteralArgv(mutated), assert.AssertionError);
const observerSource = readFileSync(`${root}/apps/finance/scripts/finance-parent-preserving-observer.mjs`, 'utf8');
assert.match(observerSource, /spawnSync\(contract\.literalArgv\[0\], contract\.literalArgv\.slice\(1\)/);
for (const forbidden of ['.join(', 'process.env', 'shell: true', 'execSync(']) assert.equal(observerSource.includes(forbidden), false, `observer rejects ${forbidden}`);

console.log('finance p0304 execution objects: pass');
