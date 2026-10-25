import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import test from 'node:test';

// Source/context checks only. These do not run Docker, compile an image,
// supply an Auth Source or prove an installed/deployed service.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const recipePath = 'infra/docker/ynx-cloudd.Dockerfile';
const ignorePath = recipePath + '.dockerignore';
const recipe = read(recipePath);
const ignore = read(ignorePath);

function localGoClosure() {
  const prefix = 'github.com/JiahaoAlbus/YNX-Chain/';
  const pending = ['apps/cloud/cmd/ynx-cloudd'];
  const selected = new Set();
  while (pending.length) {
    const directory = pending.pop();
    if (selected.has(directory)) continue;
    selected.add(directory);
    for (const entry of readdirSync(path.join(root, directory), {withFileTypes: true})) {
      if (!entry.isFile() || !entry.name.endsWith('.go') || entry.name.endsWith('_test.go')) continue;
      const source = read(path.posix.join(directory, entry.name));
      for (const declaration of source.matchAll(/\bimport\s*(?:\(([\s\S]*?)\)|((?:[\w.]+\s+)?"[^"\r\n]+"))/g)) {
        for (const item of (declaration[1] ?? declaration[2]).matchAll(/"([^"\r\n]+)"/g)) {
          if (item[1].startsWith(prefix)) pending.push(item[1].slice(prefix.length));
        }
      }
    }
  }
  return selected;
}

function assertBuildContext(dockerfile, dockerignore, packages) {
  const buildStage = dockerfile.split(/\nFROM /)[0];
  const copies = new Set(buildStage.split(/\r?\n/).map(line => line.trim()));
  const rules = dockerignore.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  assert.equal(rules[0], '**', 'retain deny-by-default context');
  for (const directory of packages) {
    assert.ok(copies.has(`COPY ${directory} ./${directory}`), `missing build COPY: ${directory}`);
    assert.ok(rules.includes(`!${directory}/`), `missing context directory: ${directory}`);
    assert.ok(rules.includes(`!${directory}/**`), `missing context contents: ${directory}`);
  }
  assert.ok(!rules.includes('!internal/**'), 'do not expose the entire internal tree');
  assert.ok(!rules.includes('!**'), 'do not expose the entire repository');
}

test('normal IDE recipe carries the actual transitive local Go source closure', () => {
  const packages = localGoClosure();
  assert.ok(packages.has('internal/cloud'));
  assert.ok(packages.has('internal/developerauthority'), 'exercise the real normal-main Auth import');
  assertBuildContext(recipe, ignore, packages);
});

test('removing the Auth COPY reproduces the omitted dependency failure', () => {
  const broken = recipe.replace(/^COPY internal\/developerauthority .*\r?\n/m, '');
  assert.notEqual(broken, recipe);
  assert.throws(() => assertBuildContext(broken, ignore, ['internal/developerauthority']), /missing build COPY/);
});

test('either missing Auth context exception is rejected', () => {
  for (const rule of ['!internal/developerauthority/', '!internal/developerauthority/**']) {
    const broken = ignore.split(/\r?\n/).filter(line => line !== rule).join('\n');
    assert.notEqual(broken, ignore);
    assert.throws(() => assertBuildContext(recipe, broken, ['internal/developerauthority']), /missing context/);
  }
});

test('source-only CI admits only the two original recipe leaves, without activating full gates', () => {
  const workflow = read('.github/workflows/cloud-security.yml');
  const start = workflow.indexOf('case "$file" in');
  const end = workflow.indexOf('\n            esac', start);
  assert.ok(start >= 0 && end > start);
  const gate = workflow.slice(start, end);
  const infraRules = gate.split('\n').filter(line => line.includes('infra/')).map(line => line.trim());
  assert.deepEqual(infraRules, [recipePath + '|' + ignorePath + ') ;;']);
  assert.match(gate, /\*\) printf 'Outside authorized IDE consumer scope:/);
  assert.ok(workflow.includes('node --test apps/cloud/tests/ide-deployment*.test.mjs'));
  assert.match(workflow, /security-recovery:\n    if: >-\n      \$\{\{ !\(github\.event_name == 'pull_request'/);
});
