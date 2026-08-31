#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const observer = join(root, 'scripts', 'finance-parent-preserving-observer.mjs');
const launcher = join(root, 'scripts', 'finance-phase3-openssh-serialized-command.sh');
const request = join(root, 'evidence', 'finance-p0300-parent-preserving-observer-request-20260824.json');
const fixture = mkdtempSync('/tmp/ynx-finance-p0300-observer-');
const stdin = join(fixture, 'signed.json');
const stdout = join(fixture, 'stdout');
const stderr = join(fixture, 'stderr');
const receipt = join(fixture, 'receipt');
const bootstrap = join(fixture, 'bootstrap.sh');
const prefix = join(fixture, 'launcher-pre-ssh.sh');

writeFileSync(stdin, '{}\n');
writeFileSync(bootstrap, '#!/bin/bash\nexit 0\n');
const launcherPrefix = `${readFileSync(launcher, 'utf8').split('\n').slice(0, 25).join('\n')}\nexit 0\n`;
writeFileSync(prefix, launcherPrefix);
chmodSync(prefix, 0o755);

const sha = (value) => createHash('sha256').update(value).digest('hex');
const bootstrapBytes = readFileSync(bootstrap);
const argv = [
  '/bin/bash', prefix, stdin, stdout, stderr, receipt, bootstrap,
  String(bootstrapBytes.length), sha(bootstrapBytes),
  'p0300-finance-phase3-20260824t210000z',
  ...Array.from({ length: 15 }, (_, index) => `fixture-${index}`)
];
assert.equal(argv.length, 25, 'launcher contract remains exactly 25 argv elements');

const contract = {
  schemaVersion: 'finance-parent-preserving-observer@1',
  processWorkingDirectory: fixture,
  environment: {},
  literalArgv: argv,
  literalArgvJsonSha256: sha(JSON.stringify(argv)),
  declaredOutputArgvIndexes: [3, 4, 5],
  shell: false,
  stdio: 'inherit'
};
const contractPath = join(fixture, 'contract.json');
const contractBytes = Buffer.from(`${JSON.stringify(contract)}\n`);
writeFileSync(contractPath, contractBytes);
const observerBytes = readFileSync(observer);

const safe = spawnSync(process.execPath, [observer, contractPath, String(contractBytes.length), sha(contractBytes), String(observerBytes.length), sha(observerBytes)], { encoding: 'utf8' });
assert.equal(safe.status, 0, `${safe.stdout}${safe.stderr}`);
assert.match(safe.stdout, /FINANCE_PARENT_PRESERVING_NODE_SPAWN/);
assert.equal(safe.stderr, '');
for (const path of [stdout, stderr, receipt, `${receipt}.pending`]) assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined, 'pre-SSH observer must not create declared outputs');

const substitutedObserver = join(fixture, 'finance-parent-preserving-observer.mjs');
const marker = join(fixture, 'substituted-child-started');
const substitutedStdout = join(fixture, 'substituted.stdout');
const substitutedStderr = join(fixture, 'substituted.stderr');
const substitutedReceipt = join(fixture, 'substituted.receipt');
const markerChild = join(fixture, 'marker-child.sh');
writeFileSync(markerChild, '#!/bin/bash\n: > "$1"\n');
chmodSync(markerChild, 0o755);
const substitutedArgv = ['/bin/bash', markerChild, marker, substitutedStdout, substitutedStderr, substitutedReceipt, ...Array.from({ length: 19 }, (_, index) => `substituted-${index}`)];
assert.equal(substitutedArgv.length, 25);
const substitutedContract = { ...contract, literalArgv: substitutedArgv, literalArgvJsonSha256: sha(JSON.stringify(substitutedArgv)) };
const substitutedContractBytes = Buffer.from(`${JSON.stringify(substitutedContract)}\n`);
const substitutedContractPath = join(fixture, 'substituted-contract.json');
writeFileSync(substitutedContractPath, substitutedContractBytes);
writeFileSync(substitutedObserver, Buffer.concat([observerBytes, Buffer.from('\n// same-path byte drift\n')]));
const drift = spawnSync(process.execPath, [substitutedObserver, substitutedContractPath, String(substitutedContractBytes.length), sha(substitutedContractBytes), String(observerBytes.length), sha(observerBytes)], { encoding: 'utf8' });
assert.equal(drift.status, 65, 'same-path observer byte drift must fail closed');
assert.equal(lstatSync(marker, { throwIfNoEntry: false }), undefined, 'observer drift must fail before child spawn');
for (const path of [substitutedStdout, substitutedStderr, substitutedReceipt, `${substitutedReceipt}.pending`]) assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined, 'observer drift must not touch declared outputs');

const frozen = JSON.parse(readFileSync(request, 'utf8')).localHarmlessRootCauseProof;
assert.deepEqual(frozen.topLevelPythonOsExecve, { exitStatus: 137, stdoutBytes: 0, stderrBytes: 0, replacementStarted: false });
assert.equal(frozen.parentPreservingNodeSpawn.exitStatus, 0);
assert.equal(frozen.exactPreSshPrefix.exitStatus, 0);
assert.equal(frozen.exactPreSshPrefix.argvCount, 25);

const source = readFileSync(observer, 'utf8');
for (const forbidden of ['statSync(contract.literalArgv', 'lstatSync(contract.literalArgv', 'openSync(', 'createWriteStream(', 'writeFileSync(']) assert.equal(source.includes(forbidden), false, `observer must not use ${forbidden}`);
assert.match(source, /spawnSync\(contract\.literalArgv\[0\], contract\.literalArgv\.slice\(1\)/);
assert.match(source, /env: \{\}/);
assert.match(source, /shell: false/);
assert.match(source, /stdio: 'inherit'/);
assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
assert.match(source, /observer self identity mismatch/);

console.log('finance parent-preserving observer fixture: pass');
