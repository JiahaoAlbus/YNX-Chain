import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPackagedServiceComponents } from './generate-code-sbom.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ynx-sbom-service-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function pkg(root, location, name, version, license = 'MIT') {
  const folder = join(root, location);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version, license, main: 'index.js' }));
  // Reading inventory must never evaluate packaged dependency code.
  writeFileSync(join(folder, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'EXECUTED'))}, 'bad');`);
  return folder;
}

test('keeps root and service TypeScript versions with actual license and location', t => {
  const root = fixture(t);
  const components = [{ 'bom-ref': 'pkg:npm/typescript@7.0.2', name: 'typescript', version: '7.0.2', properties: [] }];
  pkg(root, 'services/language-service/node_modules/typescript', 'typescript', '5.9.3', 'Apache-2.0');
  addPackagedServiceComponents(components, root);
  assert.deepEqual(components.map(x => x.version), ['7.0.2', '5.9.3']);
  assert.deepEqual(components[1].licenses, [{ license: { name: 'Apache-2.0' } }]);
  assert.equal(components[1].properties[0].value, 'services/language-service/node_modules/typescript');
  assert.equal(existsSync(join(root, 'EXECUTED')), false);
});

test('includes scoped and nested dependencies and valid prerelease/build versions', t => {
  const root = fixture(t);
  pkg(root, 'services/language/node_modules/@example/server', '@example/server', '1.0.0-beta.2+qa.1');
  pkg(root, 'services/language/node_modules/@example/server/node_modules/helper', 'helper', '2.0.0');
  const components = [];
  addPackagedServiceComponents(components, root);
  assert.deepEqual(components.map(x => x.purl), ['pkg:npm/%40example/server@1.0.0-beta.2+qa.1', 'pkg:npm/helper@2.0.0']);
  assert.equal(existsSync(join(root, 'EXECUTED')), false);
});

test('deduplicates the same identity without dropping multiple packaged locations', t => {
  const root = fixture(t);
  pkg(root, 'services/a/node_modules/helper', 'helper', '2.0.0');
  pkg(root, 'services/b/node_modules/helper', 'helper', '2.0.0');
  const components = [{ 'bom-ref': 'pkg:npm/helper@2.0.0', name: 'helper', version: '2.0.0', scope: 'optional', properties: [{ name: 'ynx:lockfilePath', value: 'node_modules/helper' }] }];
  addPackagedServiceComponents(components, root);
  assert.equal(components.length, 1);
  assert.equal(components[0].scope, 'required');
  assert.equal(components[0].properties.filter(x => x.name === 'ynx:packagedServicePath').length, 2);
  assert.equal(components[0].properties[0].name, 'ynx:lockfilePath');
  assert.equal(components[0].licenses.length, 1);
});

test('refuses an omitted service closure required by a command symlink', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  symlinkSync('../../services/language-service/node_modules/typescript/bin/tsserver', join(root, 'node_modules/.bin/tsserver'));
  assert.throws(() => addPackagedServiceComponents([], root), /ENOENT/);
});

test('refuses malformed or absent required package metadata', t => {
  for (const value of ['{', JSON.stringify({ name: 'helper' }), JSON.stringify({ name: '../escape', version: '1.0.0' })]) {
    const root = fixture(t);
    const folder = pkg(root, 'services/a/node_modules/helper', 'helper', '1.0.0');
    writeFileSync(join(folder, 'package.json'), value);
    assert.throws(() => addPackagedServiceComponents([], root));
  }
  const root = fixture(t);
  mkdirSync(join(root, 'services/a/node_modules/helper'), { recursive: true });
  assert.throws(() => addPackagedServiceComponents([], root), /ENOENT/);
});

test('rejects service dependencies pointing outside the packaged root', t => {
  const root = fixture(t), external = fixture(t);
  pkg(external, 'helper', 'helper', '1.0.0');
  mkdirSync(join(root, 'services/a/node_modules'), { recursive: true });
  symlinkSync(join(external, 'helper'), join(root, 'services/a/node_modules/helper'));
  assert.throws(() => addPackagedServiceComponents([], root), /escapes packaged root/);
});

test('retains logical locations for an internal service alias', t => {
  const root = fixture(t);
  pkg(root, 'services/a/node_modules/helper', 'helper', '1.0.0');
  symlinkSync('a', join(root, 'services/b'));
  const components = [];
  addPackagedServiceComponents(components, root);
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].properties.map(x => x.value), ['services/a/node_modules/helper', 'services/b/node_modules/helper']);
});

test('allows an absent optional service tree when no command requires one', t => {
  const root = fixture(t), components = [];
  addPackagedServiceComponents(components, root);
  assert.deepEqual(components, []);
});

test('normal CLI emits service inventory and retains compiler closure provenance', t => {
  const root = fixture(t), resources = join(root, 'Resources');
  pkg(resources, 'code/apps/developer/services/language/node_modules/typescript', 'typescript', '5.9.3', 'Apache-2.0');
  mkdirSync(join(resources, 'code/apps/developer/compiler-runtime'), { recursive: true });
  writeFileSync(join(resources, 'code/apps/developer/compiler-runtime/distribution.json'), JSON.stringify({ copiedClosureVerified: true, compiler: { available: true }, manifestSha256: 'public-fixture-closure', packages: [{ name: 'public-fixture-compiler', version: '1.0.0', license: 'MIT' }] }));
  const npmMetadata = join(root, 'npm-package.json');
  writeFileSync(npmMetadata, JSON.stringify({ version: '11.17.0' }));
  const output = join(resources, 'sbom.cdx.json');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./generate-code-sbom.mjs', import.meta.url)), output, process.execPath, npmMetadata, '1'.repeat(40)], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const bom = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.ok(bom.components.some(x => x.name === 'typescript' && x.version === '5.9.3'));
  assert.ok(bom.components.some(x => x.name === 'public-fixture-compiler' && x.properties.some(p => p.name === 'ynx:compilerClosureSha256' && p.value === 'public-fixture-closure')));
  assert.equal(existsSync(join(resources, 'EXECUTED')), false);
});
