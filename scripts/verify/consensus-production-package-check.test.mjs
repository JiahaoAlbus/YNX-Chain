import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const caller = readFileSync(join(root, 'scripts/verify/consensus-production-package-check.sh'), 'utf8');
const commit = 'a'.repeat(40);
const manifestSHA = 'c'.repeat(64);
const roles = ['primary', 'singapore', 'silicon-valley', 'seoul'];
const values = path => existsSync(path) ? readFileSync(path, 'utf8').split('\0').slice(0, -1) : null;

function actualFunction(name) {
  const source = caller.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(source, `missing actual ${name}`);
  return source;
}

// Actual caller code, instrumented external callees only. Synthetic shell
// files never enter the ELF parser. The original deploy tests cover that real
// parser/helper; the full CI package check uses the real eight-binary artifact.
function invoke(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ynx-package-runtime-input-'));
  const bundle = join(directory, 'runtime original with spaces');
  const prepared = join(directory, 'retained runtime');
  const validation = join(directory, 'validation');
  const preparation = join(directory, 'preparation');
  const deployment = join(directory, 'deployment');
  const selected = join(directory, 'selected-verifier');
  const forbidden = join(directory, 'forbidden');
  const environment = {
    ...process.env,
    CONSENSUS_CANDIDATE_RUNTIME_BUNDLE: bundle,
    CONSENSUS_CANDIDATE_RUNTIME_COMMIT: commit,
    CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256: manifestSHA,
    YNX_TEST_COMMIT: commit,
    YNX_TEST_VALIDATION: validation,
    YNX_TEST_PREPARATION: preparation,
    YNX_TEST_PREPARED: prepared,
    YNX_TEST_DEPLOYMENT: deployment,
    YNX_TEST_SELECTED: selected,
    YNX_TEST_FORBIDDEN: forbidden,
    YNX_TEST_VALIDATION_EXIT: String(options.validationExit ?? 0),
    YNX_TEST_PREPARATION_EXIT: String(options.preparationExit ?? 0),
    YNX_TEST_COPY_MODE: options.preparedNotExecutable ? '0644' : '0755',
    YNX_TEST_DEPLOYMENT_EXIT: String(options.deploymentExit ?? 0),
    YNX_TEST_ENV_FILE: join(directory, 'explicit deploy.env'),
    YNX_TEST_PACKAGE: join(directory, 'public package'),
    YNX_TEST_WORK: join(directory, 'fresh work'),
  };
  try {
    mkdirSync(bundle, { mode: 0o700 });
    const verifier = join(bundle, 'ynx-consensus-package');
    writeFileSync(verifier, '#!/bin/sh\nexit 99\n', { mode: 0o644 });
    chmodSync(verifier, 0o644);
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (value === null) delete environment[key];
      else environment[key] = value;
    }
    const script = [
      'set -Eeuo pipefail',
      'git() { [[ "$*" == "rev-parse HEAD" ]] || return 98; printf "%s\\n" "$YNX_TEST_COMMIT"; }',
      'validate_runtime_bundle() { printf "%s\\0" "$@" > "$YNX_TEST_VALIDATION"; return "$YNX_TEST_VALIDATION_EXIT"; }',
      'prepare_runtime_bundle() { printf "%s\\0" "$@" > "$YNX_TEST_PREPARATION"; [[ "$YNX_TEST_PREPARATION_EXIT" == 0 ]] || return "$YNX_TEST_PREPARATION_EXIT"; mkdir -m 0700 "$4" || return; cp "$1/ynx-consensus-package" "$4/ynx-consensus-package" || return; chmod "$YNX_TEST_COPY_MODE" "$4/ynx-consensus-package"; }',
      'go() { : > "$YNX_TEST_FORBIDDEN"; return 97; }',
      'ssh() { : > "$YNX_TEST_FORBIDDEN"; return 97; }',
      'sudo() { : > "$YNX_TEST_FORBIDDEN"; return 97; }',
      'bash() { printf "%s\\0" "$DEPLOY_DRY_RUN" "$ENV_FILE" "$CONSENSUS_CANDIDATE_PACKAGE" "$CONSENSUS_CANDIDATE_WORK_ROOT" "$CONSENSUS_CANDIDATE_RUNTIME_BUNDLE" "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" "$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256" "$@" > "$YNX_TEST_DEPLOYMENT"; return "$YNX_TEST_DEPLOYMENT_EXIT"; }',
      actualFunction('consensus_production_runtime_inputs'),
      actualFunction('consensus_production_prepare_runtime'),
      actualFunction('consensus_production_deploy_dry_run'),
      'consensus_production_runtime_inputs',
      'consensus_production_prepare_runtime "$YNX_TEST_PREPARED"',
      'printf "%s" "$package_verifier" > "$YNX_TEST_SELECTED"',
      ...(options.poisonAfterValidation ? [
        'CONSENSUS_CANDIDATE_RUNTIME_BUNDLE=/untrusted/replacement',
        `CONSENSUS_CANDIDATE_RUNTIME_COMMIT=${'b'.repeat(40)}`,
        `CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256=${'d'.repeat(64)}`,
        'DEPLOY_DRY_RUN=0',
      ] : []),
      'consensus_production_deploy_dry_run "$YNX_TEST_ENV_FILE" "$YNX_TEST_PACKAGE" "$YNX_TEST_WORK"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { cwd: root, env: environment, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    return {
      status: result.status, stderr: result.stderr, validation: values(validation), preparation: values(preparation), deployment: values(deployment),
      selected: existsSync(selected) ? readFileSync(selected, 'utf8') : null,
      forbidden: existsSync(forbidden), bundle, prepared, originalMode: statSync(verifier).mode & 0o777,
      envFile: environment.YNX_TEST_ENV_FILE, packageRoot: environment.YNX_TEST_PACKAGE, work: environment.YNX_TEST_WORK,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('actual CI caller preserves independent v2 pins and uses a retained executable copy of 0644 input', () => {
  const result = invoke({ poisonAfterValidation: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.validation, [result.bundle, commit, manifestSHA]);
  assert.deepEqual(result.preparation, [result.bundle, commit, manifestSHA, result.prepared]);
  assert.equal(result.selected, join(result.prepared, 'ynx-consensus-package'));
  assert.equal(result.originalMode, 0o644);
  assert.deepEqual(result.deployment, ['1', result.envFile, result.packageRoot, result.work, result.bundle, commit, manifestSHA, 'scripts/deploy/deploy-consensus-candidate.sh']);
  assert.equal(result.forbidden, false);
});

test('missing, malformed or different-source runtime pins fail before copying or staging', async t => {
  for (const env of [
    { CONSENSUS_CANDIDATE_RUNTIME_BUNDLE: null },
    { CONSENSUS_CANDIDATE_RUNTIME_COMMIT: null },
    { CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256: null },
    { CONSENSUS_CANDIDATE_RUNTIME_BUNDLE: 'relative/runtime' },
    { CONSENSUS_CANDIDATE_RUNTIME_COMMIT: 'a'.repeat(12) },
    { CONSENSUS_CANDIDATE_RUNTIME_COMMIT: 'A'.repeat(40) },
    { CONSENSUS_CANDIDATE_RUNTIME_COMMIT: 'b'.repeat(40) },
    { CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256: 'C'.repeat(64) },
    { CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256: 'c'.repeat(63) },
  ]) {
    await t.test(JSON.stringify(env), () => {
      const result = invoke({ env });
      assert.notEqual(result.status, 0);
      for (const field of ['validation', 'preparation', 'selected', 'deployment']) assert.equal(result[field], null);
      assert.equal(result.originalMode, 0o644);
      assert.equal(result.forbidden, false);
    });
  }
});

test('strict parser or preparation rejection never falls back to a build', () => {
  const rejected = invoke({ validationExit: 73 });
  assert.equal(rejected.status, 73, rejected.stderr);
  assert.deepEqual(rejected.validation, [rejected.bundle, commit, manifestSHA]);
  assert.equal(rejected.preparation, null);
  const preparationFailure = invoke({ preparationExit: 74 });
  assert.equal(preparationFailure.status, 74, preparationFailure.stderr);
  for (const result of [rejected, preparationFailure, invoke({ preparedNotExecutable: true })]) {
    assert.notEqual(result.status, 0);
    assert.equal(result.selected, null);
    assert.equal(result.deployment, null);
    assert.equal(result.originalMode, 0o644);
    assert.equal(result.forbidden, false);
  }
});

test('the caller preserves the deployment first failure instead of retrying', () => {
  const result = invoke({ deploymentExit: 71 });
  assert.equal(result.status, 71, result.stderr);
  assert.equal(result.deployment[0], '1');
  assert.equal(result.forbidden, false);
});

test('sourcing shared runtime helpers and the verifier has no initialization or process effects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ynx-runtime-parser-source-'));
  try {
    const marker = join(directory, 'forbidden');
    const script = [
      'set -Eeuo pipefail',
      'forbidden() { : > "$YNX_SOURCE_MARKER"; return 97; }',
      ...['go', 'git', 'python3', 'ssh', 'sudo', 'mkdir', 'cp', 'chmod', 'ynx_ops_init'].map(name => `${name}() { forbidden; }`),
      'source "$YNX_SOURCE_DEPLOY"',
      'source "$YNX_SOURCE_VERIFY"',
      'declare -F validate_runtime_bundle >/dev/null',
      'declare -F prepare_runtime_bundle >/dev/null',
      'declare -F consensus_candidate_verify >/dev/null',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, YNX_SOURCE_MARKER: marker, YNX_SOURCE_DEPLOY: join(root, 'scripts/deploy/deploy-consensus-candidate.sh'), YNX_SOURCE_VERIFY: join(root, 'scripts/verify/verify-consensus-candidate.sh') },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function evidenceFixture(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'ynx-candidate-evidence-'));
  const bundle = join(directory, 'runtime original');
  const packageRoot = join(directory, 'public package');
  const evidence = join(directory, 'evidence');
  const validation = join(directory, 'validation');
  const preparation = join(directory, 'preparation');
  const packageCalls = join(directory, 'package-calls');
  const initialized = join(directory, 'initialized');
  const transport = join(directory, 'transport');
  const forbidden = join(directory, 'forbidden');
  try {
    mkdirSync(bundle, { mode: 0o700 });
    mkdirSync(packageRoot, { mode: 0o700 });
    // Stand-in is limited to this caller test, not a fake ELF/parser positive.
    const verifier = join(bundle, 'ynx-consensus-package');
    writeFileSync(verifier, '#!/bin/bash\nprintf "%s\\0" "$@" >> "$YNX_TEST_PACKAGE_CALLS"\nexit "$YNX_TEST_PACKAGE_EXIT"\n', { mode: 0o644 });
    chmodSync(verifier, 0o644);
    const invokeEvidence = (options = {}) => {
      const environment = {
        ...process.env,
        CONSENSUS_CANDIDATE_PACKAGE: packageRoot,
        CONSENSUS_CANDIDATE_EVIDENCE_DIR: evidence,
        CONSENSUS_CANDIDATE_RUNTIME_BUNDLE: bundle,
        CONSENSUS_CANDIDATE_RUNTIME_COMMIT: commit,
        CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256: manifestSHA,
        DEPLOY_DRY_RUN: options.dryRun === false ? '0' : '1',
        YNX_TEST_COMMIT: commit,
        YNX_TEST_VALIDATION: validation,
        YNX_TEST_VALIDATION_EXIT: String(options.validationExit ?? 0),
        YNX_TEST_PREPARATION: preparation,
        YNX_TEST_PREPARATION_EXIT: String(options.preparationExit ?? 0),
        YNX_TEST_PACKAGE_CALLS: packageCalls,
        YNX_TEST_PACKAGE_EXIT: String(options.packageExit ?? 0),
        YNX_TEST_INITIALIZED: initialized,
        YNX_TEST_TRANSPORT: transport,
        YNX_TEST_FORBIDDEN: forbidden,
        YNX_TEST_VERIFY: join(root, 'scripts/verify/verify-consensus-candidate.sh'),
        YNX_TEST_OPS: join(root, 'scripts/ops/lib.sh'),
        ...(options.env ?? {}),
      };
      const script = [
        'set -Eeuo pipefail',
        'source "$YNX_TEST_VERIFY"',
        'source "$YNX_TEST_OPS"',
        'git() { [[ "$*" == "rev-parse HEAD" ]] || return 98; printf "%s\\n" "$YNX_TEST_COMMIT"; }',
        'validate_runtime_bundle() { printf "%s\\0" "$@" >> "$YNX_TEST_VALIDATION"; return "$YNX_TEST_VALIDATION_EXIT"; }',
        'prepare_runtime_bundle() { printf "%s\\0" "$@" >> "$YNX_TEST_PREPARATION"; mkdir -m 0700 "$4" || return; [[ "$YNX_TEST_PREPARATION_EXIT" == 0 ]] || return "$YNX_TEST_PREPARATION_EXIT"; cp "$1/ynx-consensus-package" "$4/ynx-consensus-package" || return; chmod 0755 "$4/ynx-consensus-package"; }',
        'ynx_ops_init() { : > "$YNX_TEST_INITIALIZED"; PRIMARY_NODE_USER=test; PRIMARY_NODE_HOST=127.0.0.1; PRIMARY_NODE_SSH_KEY=unused; SG_NODE_USER=test; SG_NODE_HOST=127.0.0.2; SG_NODE_SSH_KEY=unused; SILICON_VALLEY_NODE_USER=test; SILICON_VALLEY_NODE_HOST=127.0.0.3; SILICON_VALLEY_NODE_SSH_KEY=unused; SEOUL_NODE_USER=test; SEOUL_NODE_HOST=127.0.0.4; SEOUL_NODE_SSH_KEY=unused; }',
        'ynx_transport_ssh() { printf "%s\\0" "$@" >> "$YNX_TEST_TRANSPORT"; printf "partial UNKNOWN status"; return 71; }',
        'forbidden() { : > "$YNX_TEST_FORBIDDEN"; return 97; }',
        ...['go', 'node', 'ssh', 'sudo'].map(name => `${name}() { forbidden; }`),
        'consensus_candidate_verify',
      ].join('\n');
      const result = spawnSync('bash', ['-c', script], { cwd: root, env: environment, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.error, undefined);
      assert.equal(existsSync(forbidden), false, 'external builder or transport escaped its test boundary');
      assert.equal(statSync(verifier).mode & 0o777, 0o644, 'original downloaded runtime mode changed');
      return result;
    };
    callback({ directory, bundle, packageRoot, evidence, validation, preparation, packageCalls, initialized, transport, invoke: invokeEvidence });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('actual evidence dry-run uses a retained copy, no remote transport and no claimed proof', () => {
  evidenceFixture(f => {
    const result = f.invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(values(f.validation), [f.bundle, commit, manifestSHA]);
    assert.deepEqual(values(f.preparation), [f.bundle, commit, manifestSHA, join(f.evidence, 'runtime')]);
    assert.deepEqual(values(f.packageCalls), ['-verify-package', f.packageRoot]);
    assert.equal(statSync(f.evidence).mode & 0o777, 0o700);
    assert.equal(statSync(join(f.evidence, 'runtime/ynx-consensus-package')).mode & 0o777, 0o755);
    assert.equal(existsSync(f.transport), false);
    for (const role of roles) {
      assert.ok(result.stdout.includes(`DRY RUN [${role}]`));
      assert.equal(existsSync(join(f.evidence, role, 'status.json')), false);
    }
    assert.ok(result.stdout.includes('no remote or public proof was generated'));
  });
});

test('actual evidence collection refuses existing directory, file or symlink without changing UNKNOWN', async t => {
  for (const kind of ['directory', 'file', 'symlink']) {
    await t.test(kind, () => evidenceFixture(f => {
      const target = join(f.directory, 'original UNKNOWN');
      if (kind === 'directory') {
        mkdirSync(f.evidence);
        writeFileSync(join(f.evidence, 'UNKNOWN.json'), 'original UNKNOWN');
      } else if (kind === 'file') {
        writeFileSync(f.evidence, 'original UNKNOWN');
      } else {
        mkdirSync(target);
        writeFileSync(join(target, 'UNKNOWN.json'), 'original UNKNOWN');
        symlinkSync(target, f.evidence);
      }
      const result = f.invoke();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /retain and reconcile/);
      for (const path of [f.preparation, f.initialized, f.transport]) assert.equal(existsSync(path), false);
      assert.equal(readFileSync(kind === 'file' ? f.evidence : join(f.evidence, 'UNKNOWN.json'), 'utf8'), 'original UNKNOWN');
      if (kind === 'symlink') {
        assert.equal(lstatSync(f.evidence).isSymbolicLink(), true);
        assert.equal(readlinkSync(f.evidence), target);
      }
    }));
  }
});

test('partial transport failure retains exact bytes and repeat cannot retry or overwrite them', () => {
  evidenceFixture(f => {
    const first = f.invoke({ dryRun: false });
    assert.equal(first.status, 71, first.stderr);
    const status = join(f.evidence, 'primary/status.json');
    assert.equal(readFileSync(status, 'utf8'), 'partial UNKNOWN status');
    assert.equal(existsSync(join(f.evidence, 'runtime/ynx-consensus-package')), true);
    const originalTransport = readFileSync(f.transport);
    const originalPackageCalls = readFileSync(f.packageCalls);
    const second = f.invoke({ dryRun: false });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /retain and reconcile/);
    assert.equal(readFileSync(status, 'utf8'), 'partial UNKNOWN status');
    assert.deepEqual(readFileSync(f.transport), originalTransport);
    assert.deepEqual(readFileSync(f.packageCalls), originalPackageCalls);
    assert.equal(existsSync(join(f.evidence, 'singapore')), false);
  });
});

test('invalid runtime or wrong source refuses before evidence creation and transport initialization', () => {
  for (const options of [{ validationExit: 73 }, { env: { CONSENSUS_CANDIDATE_RUNTIME_COMMIT: 'b'.repeat(40) } }]) {
    evidenceFixture(f => {
      assert.notEqual(f.invoke(options).status, 0);
      for (const path of [f.evidence, f.preparation, f.initialized, f.transport]) assert.equal(existsSync(path), false);
    });
  }
});

test('evidence cannot be written inside either original input', () => {
  for (const input of ['bundle', 'packageRoot']) {
    evidenceFixture(f => {
      const destination = join(f[input], 'evidence');
      const result = f.invoke({ env: { CONSENSUS_CANDIDATE_EVIDENCE_DIR: destination } });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /outside the original runtime and package/);
      for (const path of [destination, f.preparation, f.initialized]) assert.equal(existsSync(path), false);
    });
  }
});

test('failed package verification or partial preparation retains the reserved evidence without transport', () => {
  for (const options of [{ packageExit: 75 }, { preparationExit: 74 }]) {
    evidenceFixture(f => {
      const result = f.invoke(options);
      assert.equal(result.status, options.packageExit ?? options.preparationExit, result.stderr);
      assert.equal(existsSync(join(f.evidence, 'runtime')), true);
      assert.equal(existsSync(f.initialized), false);
      assert.equal(existsSync(f.transport), false);
    });
  }
});
