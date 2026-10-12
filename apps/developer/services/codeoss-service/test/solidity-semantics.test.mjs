import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import { createSolidityCompiler } from '../src/solidity-compiler.mjs';
import { createNativeToolsService } from '../src/tools-service.mjs';
import { compilerReadiness } from '../../../scripts/compiler-pin.mjs';
import { soliditySemanticIndex } from '../../../scripts/solidity-semantic-index.mjs';
const require = createRequire(import.meta.url), { byteOffset } = require('../../../native/ynx-tools/src/solidity-diagnostics.cjs');
const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const files = {
  'contracts/Use.sol': '// SPDX-License-Identifier: MIT\n// 中文😀\npragma solidity 0.8.24; import "./Math.sol"; contract Use { function ping() public pure returns(uint256) { uint256 local = Math.value(); return local; } }',
  'contracts/Math.sol': '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24; library Math { function value() internal pure returns(uint256) { return 3; } function value(uint256 n) internal pure returns(uint256) { return n; } }',
};
const snapshot = () => ({ protocol: 'ynx-solidity-project/v1', sessionId, entryPath: 'contracts/Use.sol', sources: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, { content, sha256: createHash('sha256').update(content).digest('hex'), documentVersion: 2 }])) });
function reviewed(t) { if (!compilerReadiness().available) { t.skip('Supply the reviewed compiler closure.'); return false; } return true; }
test('real compiler resolves cross-file overloaded member references and exact Unicode locations', async t => {
  if (!reviewed(t)) return;
  const compiler = createSolidityCompiler(), result = await compiler.analyze({ owner: 'owner-A', snapshot: snapshot(), sessionId });
  assert.equal(result.ok, true); assert.equal(result.compiler.version, '0.8.24'); assert.equal(result.semantics.protocol, 'ynx-solidity-semantics/v1');
  const index = result.semantics, call = index.references.find(r => r.location.file === 'contracts/Use.sol' && Buffer.from(files[r.location.file]).subarray(r.location.start, r.location.end).toString() === 'value');
  assert.ok(call); assert.equal(call.type, 'function () pure returns (uint256)');
  const definition = index.declarations.find(d => d.id === call.targetId); assert.equal(definition.location.file, 'contracts/Math.sol'); assert.equal(definition.name, 'value');
  assert.equal(byteOffset(files[definition.location.file], definition.location.start), files[definition.location.file].indexOf('value()'));
  assert.equal(byteOffset(files[call.location.file], call.location.start), files[call.location.file].indexOf('Math.value') + 'Math.'.length);
  assert.equal(index.declarations.filter(d => d.name === 'value').length, 2);
  const local = index.declarations.find(d => d.name === 'local'); assert.equal(local.type, 'uint256'); assert.ok(index.references.some(r => r.targetId === local.id && r.type === 'uint256'));
  assert.equal(result.sourceDigests['contracts/Use.sol'], snapshot().sources['contracts/Use.sol'].sha256); assert.equal(compiler.status().active, 0);
  assert.equal(result.bytecode, undefined); assert.equal(result.artifactHash, undefined);
});
test('analysis refuses changed snapshots and unresolved imports without invented semantic data', async t => {
  if (!reviewed(t)) return;
  const compiler = createSolidityCompiler(), value = snapshot(); value.sources['contracts/Use.sol'].content += ' changed';
  await assert.rejects(compiler.analyze({ owner: 'A', snapshot: value, sessionId }), e => e.code === 'compiler_snapshot');
  const missing = snapshot(); delete missing.sources['contracts/Math.sol']; const result = await compiler.analyze({ owner: 'A', snapshot: missing, sessionId });
  assert.equal(result.ok, false); assert.equal(result.status, 422); assert.equal(result.semantics, undefined); assert.ok(result.diagnostics.some(d => d.severity === 'error')); assert.equal(compiler.status().active, 0);
});
test('analysis and compilation share owner/global quota and cancellation releases the real worker', async t => {
  if (!reviewed(t)) return;
  const compiler = createSolidityCompiler({ maxConcurrent: 1 }), abort = new AbortController();
  const pending = compiler.analyze({ owner: 'A', snapshot: snapshot(), sessionId, signal: abort.signal });
  await assert.rejects(compiler.compile({ owner: 'A', name: 'Use', snapshot: snapshot(), sessionId }), e => e.code === 'compiler_capacity');
  await assert.rejects(compiler.analyze({ owner: 'B', snapshot: snapshot(), sessionId }), e => e.code === 'compiler_capacity');
  abort.abort(); await assert.rejects(pending, e => e.code === 'compiler_retired'); assert.equal(compiler.status().active, 0);
  assert.equal((await compiler.analyze({ owner: 'B', snapshot: snapshot(), sessionId })).ok, true); assert.equal(compiler.status().active, 0);
});
test('compact index excludes unknown files, builtin/unknown targets and split UTF8; bounds hostile trees', () => {
  const sources = { 'A.sol': { content: '中文😀x' } }, output = { sources: { 'A.sol': { id: 0, ast: { nodeType: 'SourceUnit', nodes: [
    { nodeType: 'VariableDeclaration', id: 1, name: 'x', nameLocation: '10:1:0' },
    { nodeType: 'Identifier', referencedDeclaration: 1, src: '10:1:0' },
    { nodeType: 'Identifier', referencedDeclaration: 1, src: '4:1:0' },
    { nodeType: 'Identifier', referencedDeclaration: 999, src: '10:1:0' },
    { nodeType: 'Identifier', referencedDeclaration: -1, src: '10:1:0' },
  ] } }, 'outside.sol': { id: 1, ast: { nodeType: 'VariableDeclaration', id: 9, name: 'secret', src: '0:1:1' } } } };
  const index = soliditySemanticIndex(output, sources); assert.equal(index.declarations.length, 1); assert.equal(index.references.length, 1); assert.equal(index.references[0].targetId, 1);
  const hostile = { sources: { 'A.sol': { id: 0, ast: { nodes: Array.from({ length: 100001 }, () => ({})) } } } };
  assert.throws(() => soliditySemanticIndex(hostile, sources), e => e.code === 'compiler_semantic_limit');
});
test('actual HTTP analysis consumes a source-bound ticket and rejects foreign origin/session/replay', async t => {
  if (!reviewed(t)) return;
  const compiler = createSolidityCompiler(); let generation = 1, mutateAfterAnalysis = false;
  const service = createNativeToolsService({ compiler: { async analyze(args) { const result = await compiler.analyze(args); if (mutateAfterAnalysis) generation++; return result; } }, admittedOwners: new WeakMap(), coreService: { async authorizeConnection(req, id) { if (req.headers.cookie !== 'wallet=A' || id !== sessionId) throw Object.assign(Error('unauthorized'), { status: 401 }); return { context: { owner: 'owner-A', projectId: 'project-A', runtimeId: 'runtime-A', sessionId }, identity: { account: 'account-A', generation, identityReference: 'reference-A' }, expiresAt: Date.now() + 60000 }; } } });
  const server = createServer((req, res) => service.handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path: '/runtime/native-tools/' + path + '?sessionId=' + sessionId, method: body ? 'POST' : 'GET', headers: { host: 'developer.ynxweb4.com', cookie: 'wallet=A', ...(body ? { origin: 'https://developer.ynxweb4.com', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : {}), ...headers } }, res => { let bytes = ''; res.on('data', chunk => bytes += chunk); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(bytes) })); }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const context = await send('context'), body = { csrf: context.value.csrf, snapshot: snapshot() };
  assert.equal((await send('chain/analyze', body, { origin: 'https://foreign.example' })).status, 403);
  const result = await send('chain/analyze', body); assert.equal(result.status, 200); assert.ok(result.value.semantics.references.length); assert.equal(result.value.projectId, 'project-A'); assert.equal(result.value.signed, false); assert.equal(result.value.submitted, false);
  assert.equal((await send('chain/analyze', body)).status, 403); assert.equal((await send('chain/analyze', body, { cookie: 'wallet=B' })).status, 401);
  const ticket = await send('context'); generation++; assert.equal((await send('chain/analyze', { csrf: ticket.value.csrf, snapshot: snapshot() })).status, 403);
  const fresh = await send('context'); mutateAfterAnalysis = true;
  const retired = await send('chain/analyze', { csrf: fresh.value.csrf, snapshot: snapshot() }); assert.equal(retired.status, 401); assert.equal(retired.value.code, 'tools_identity_changed'); assert.equal(retired.value.semantics, undefined);
  assert.equal(compiler.status().active, 0);
});
