import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// Test execution evidence only, never Source/approval/deployment authorization.
const authority = 'github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority';
const main = 'github.com/JiahaoAlbus/YNX-Chain/apps/cloud/cmd/ynx-cloudd';
const all13 = 'TestOriginalIDEFactoryActualConstructorAndAllThirteenMethods';
const flows = ['principal_source_catalog', 'control_and_same_approval_current',
  'publisher_registration_and_current', 'selector_artifact_and_same_approval_current',
  'same_artifact_resource_and_current'];
const lease = 'TestOriginalIDEFactoryPrincipalSessionAndObservationWindowsRemainIndependent';
const startup = 'TestOriginalIDEFactoryHTTPWindowStartsAfterStartupAndNeverRenews';

export function requireOriginalRaceEvidence(records) {
  const runs = new Set(), passes = new Set(), packages = new Set();
  const key = r => r.Package + '\0' + r.Test;
  for (const r of records) {
    assert.ok(r && typeof r === 'object' && typeof r.Action === 'string', 'invalid Go event');
    assert.ok(r.Action !== 'fail' && r.Action !== 'skip', 'failed or skipped race evidence');
    if (r.Test && r.Action === 'run') runs.add(key(r));
    if (r.Test && r.Action === 'pass') passes.add(key(r));
    if (!r.Test && r.Action === 'pass') packages.add(r.Package);
  }
  for (const pkg of [authority, main]) assert.ok(packages.has(pkg), 'missing executed package: ' + pkg);
  assert.ok(runs.size > 0, 'zero race tests executed');
  for (const k of runs) assert.ok(passes.has(k), 'test did not complete: ' + k);
  const required = [all13, lease, startup, ...flows.map(f => all13 + '/' + f)];
  for (const name of required) assert.ok(runs.has(authority + '\0' + name) && passes.has(authority + '\0' + name), 'missing original flow: ' + name);
  for (const [prefix, minimum] of [['TestOriginalIDEFactory', 7], ['TestOriginalIDEWire', 3], ['TestIDECommissioning', 9], ['TestPostgres', 1]]) {
    const count = [...runs].filter(k => k.startsWith(authority + '\0' + prefix) && !k.split('\0')[1].includes('/')).length;
    assert.ok(count >= minimum, 'missing original race group: ' + prefix);
  }
  for (const name of ['TestIDERuntimeSourceConstructorPartialAndCleanupAreOwned',
    'TestIDERuntimeSourceConfigurationCannotInventCommissioningOrFallback',
    'TestIDERuntimeCommissioningExplicitActionAndConfigNoFallback',
    'TestIDERuntimeCommissioningOnlySelectedActionAndPartialCleanup']) {
    assert.ok(runs.has(main + '\0' + name) && passes.has(main + '\0' + name), 'missing normal caller: ' + name);
  }
  return {testsIncludingSubcases: runs.size, packages: packages.size};
}

if (process.argv[2] === '--verify') {
  assert.equal(process.argv.length, 4, 'one original Go JSON log required');
  const raw = readFileSync(process.argv[3], 'utf8');
  assert.ok(raw.trim(), 'race log empty');
  const records = raw.trim().split(/\r?\n/).map(line => JSON.parse(line));
  process.stdout.write(JSON.stringify(requireOriginalRaceEvidence(records)) + '\n');
} else {
  function fixture() {
    const names = [all13, lease, startup, ...flows.map(f => all13 + '/' + f),
      ...Array.from({length: 4}, (_, i) => 'TestOriginalIDEFactoryNegative' + i),
      ...Array.from({length: 3}, (_, i) => 'TestOriginalIDEWireBoundary' + i),
      ...Array.from({length: 9}, (_, i) => 'TestIDECommissioningBoundary' + i), 'TestPostgresBoundary'];
    const mainNames = ['TestIDERuntimeSourceConstructorPartialAndCleanupAreOwned',
      'TestIDERuntimeSourceConfigurationCannotInventCommissioningOrFallback',
      'TestIDERuntimeCommissioningExplicitActionAndConfigNoFallback',
      'TestIDERuntimeCommissioningOnlySelectedActionAndPartialCleanup'];
    return [...names.flatMap(Test => [{Action: 'run', Package: authority, Test}, {Action: 'pass', Package: authority, Test}]),
      ...mainNames.flatMap(Test => [{Action: 'run', Package: main, Test}, {Action: 'pass', Package: main, Test}]),
      {Action: 'pass', Package: authority}, {Action: 'pass', Package: main}];
  }
  test('PUBLIC complete event fixture is accepted only as execution DATA', () => {
    assert.ok(requireOriginalRaceEvidence(fixture()).testsIncludingSubcases > 0);
  });
  test('empty and compile-only output cannot claim race execution', () => {
    assert.throws(() => requireOriginalRaceEvidence([]));
    assert.throws(() => requireOriginalRaceEvidence([{Action: 'pass', Package: authority}, {Action: 'pass', Package: main}]));
  });
  test('one missing original workflow refuses the whole matrix', () => {
    assert.throws(() => requireOriginalRaceEvidence(fixture().filter(r => r.Test !== all13 + '/' + flows[4])));
  });
  test('skipped or failed cases never count as passing evidence', () => {
    for (const Action of ['skip', 'fail']) assert.throws(() => requireOriginalRaceEvidence([...fixture(), {Action, Package: authority, Test: all13}]));
  });
  test('started but unfinished cases are rejected', () => {
    assert.throws(() => requireOriginalRaceEvidence([...fixture(), {Action: 'run', Package: main, Test: 'TestIDERuntimeUnfinished'}]));
  });
}
