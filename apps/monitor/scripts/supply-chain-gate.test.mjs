import assert from 'node:assert/strict';
import test from 'node:test';
import { collectProductionPackages, scanText } from './supply-chain-gate.mjs';

function validLock(overrides = {}) {
  return {
    lockfileVersion: 3,
    packages: {
      '': { name: '@ynx/monitor', version: '0.1.0' },
      'node_modules/example-package': {
        version: '1.2.3',
        resolved: 'https://registry.npmjs.org/example-package/-/example-package-1.2.3.tgz',
        integrity: 'sha512-YWJj',
        license: 'MIT',
        ...overrides,
      },
      'node_modules/dev-only': {
        version: '9.9.9',
        resolved: 'https://registry.npmjs.org/dev-only/-/dev-only-9.9.9.tgz',
        integrity: 'sha512-YWJj',
        license: 'MIT',
        dev: true,
      },
    },
  };
}

test('collectProductionPackages emits locked production metadata', () => {
  const packages = collectProductionPackages(validLock());
  assert.equal(packages.length, 1);
  assert.equal(packages[0].name, 'example-package');
  assert.equal(packages[0].version, '1.2.3');
  assert.equal(packages[0].registryHost, 'registry.npmjs.org');
  assert.equal(packages[0].license, 'MIT');
});

test('collectProductionPackages fails closed on missing integrity', () => {
  assert.throws(() => collectProductionPackages(validLock({ integrity: undefined })), /missing a supported integrity hash/);
});

test('collectProductionPackages fails closed on unapproved license', () => {
  assert.throws(() => collectProductionPackages(validLock({ license: 'Custom-Proprietary' })), /unapproved license/);
});

test('scanText reports the matching line without mutating the source', () => {
  const source = 'safe line\nnew Function("return 1")\n';
  const findings = scanText(source, [{ id: 'dynamic-function', expression: /new\s+Function\s*\(/g }]);
  assert.deepEqual(findings.map(({ id, line }) => ({ id, line })), [{ id: 'dynamic-function', line: 2 }]);
  assert.equal(source.includes('new Function'), true);
});
