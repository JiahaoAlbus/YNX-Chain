import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync, readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as native from '../src/index.mjs';
import * as browser from '../src/browser.mjs';
import {makePublicFixture, runVerificationVectors} from './browser-vectors.mjs';

test('one native signed public fixture verifies through native and ordinary Uint8Array APIs', () => {
  const fixture = makePublicFixture(native, value => Buffer.from(value));
  const node = runVerificationVectors(native, fixture, {fromBytes: value => Buffer.from(value),
    sharedBytes: size => Buffer.from(new SharedArrayBuffer(size))});
  const publicBytes = runVerificationVectors(browser, fixture, {publicBoundary: true});
  assert.ok(node.checks > 100 && publicBytes.checks > node.checks);
  assert.deepEqual(publicBytes.cases.slice(0, node.cases.length), node.cases);
  assert.equal(publicBytes.cases.at(-1), 'browser public surface exposes no signer or provider switch');
  assert.throws(() => native.decodeCertificate(Uint8Array.from(fixture.certificateWire)), {code: 'ERR_YNX_BATCH'},
    'original Node codec still requires its Buffer ABI');
});

test('the transitive YNX browser source graph is public and contains no Node runtime or private provider calls', () => {
  const sourceRoot = realpathSync(fileURLToPath(new URL('../src', import.meta.url))), seen = new Set();
  // A comment scanner keeps quoted import specifiers intact. Strings are not
  // interpreted or executed; browser source uses static ESM imports only.
  function withoutComments(source) {
    let out = '', at = 0;
    while (at < source.length) {
      const ch = source[at];
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch; out += ch; at++;
        while (at < source.length) {
          const value = source[at++]; out += value;
          if (value === '\\' && at < source.length) out += source[at++];
          else if (value === quote) break;
        }
      } else if (source.startsWith('//', at)) {
        while (at < source.length && source[at] !== '\n') at++;
      } else if (source.startsWith('/*', at)) {
        const end = source.indexOf('*/', at + 2); assert.ok(end >= 0, 'terminated source comment');
        out += ' '; at = end + 2;
      } else { out += ch; at++; }
    }
    return out;
  }
  function visit(filename) {
    filename = realpathSync(filename);
    assert.ok(filename.startsWith(sourceRoot + path.sep), 'browser relative import stays in src');
    assert.ok(lstatSync(filename).isFile(), 'regular source leaf');
    if (seen.has(filename)) return;
    seen.add(filename);
    assert.ok(!['index.mjs', 'native.mjs', 'portable.mjs', 'codec.mjs', 'tree.mjs'].includes(path.basename(filename)), 'no Node facade/provider loaded');
    const source = withoutComments(readFileSync(filename, 'utf8'));
    assert.doesNotMatch(source, /\b(?:Buffer|process|require|keyGen|KeyGen|batchSign|BatchSign|importKeyMaterial|exportKeyMaterial|generateNativeKeys|signNative|randomBytes|getRandomValues|randomUUID)\b/,
      'YNX browser graph contains no runtime globals, private operations or randomness: ' + filename);
    assert.doesNotMatch(source, /\bimport\s*\(/, 'no dynamic engine loading');
    assert.doesNotMatch(source, /\bMath\s*\.\s*random\s*\(/, 'verification requires no randomness');
    const imports = source.matchAll(/\b(?:import|export)\s+(?:[\w*{},\s]+?\s+from\s+)?(['"])([^'"]+)\1/g);
    for (const [, , specifier] of imports) {
      assert.ok(!specifier.startsWith('node:'), 'no Node import');
      if (specifier.startsWith('.')) {
        assert.ok(specifier.endsWith('.mjs'), 'explicit relative ESM leaf'); visit(path.resolve(path.dirname(filename), specifier));
      } else assert.match(specifier, /^@noble\/(?:post-quantum\/(?:ml-dsa|slh-dsa)|hashes\/(?:sha2|sha3))\.js$/, 'only the original fixed Noble public primitives');
    }
  }
  visit(path.join(sourceRoot, 'browser.mjs'));
  for (const required of ['browser.mjs', 'browser-codec.mjs', 'codec-core.mjs', 'public-bytes.mjs', 'tree-core.mjs', 'verify-core.mjs', 'public-noble.mjs'])
    assert.ok(seen.has(path.join(sourceRoot, required)), 'shared public source traversed: ' + required);
});
