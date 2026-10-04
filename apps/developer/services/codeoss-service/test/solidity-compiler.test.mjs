import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolidityCompiler } from '../src/solidity-compiler.mjs';
import { compilerReadiness } from '../../../scripts/compiler-pin.mjs';
const source = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24; contract PinCheck { function ping() external pure returns(uint256) { return 1; } }';
test('real pinned compiler returns source-bound ABI and diagnostics without executing a project', async t => {
  if (!compilerReadiness().available) return t.skip('The reviewed compiler input must be supplied.');
  const compiler = createSolidityCompiler();
  const result = await compiler.compile({ owner: 'owner-A', name: 'PinCheck', source });
  assert.equal(result.ok, true); assert.equal(result.compiler.version, '0.8.24');
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/); assert.ok(result.abi.some(item => item.name === 'ping'));
  const invalid = await compiler.compile({ owner: 'owner-A', name: 'PinCheck', source: 'pragma solidity 0.8.24; contract PinCheck { broken }' });
  assert.equal(invalid.ok, false); assert.equal(invalid.status, 422); assert.ok(invalid.diagnostics.some(item => item.severity === 'error'));
  const missing = await compiler.compile({ owner: 'owner-A', name: 'AnotherContract', source });
  assert.equal(missing.ok, false); assert.equal(missing.status, 422); assert.equal(missing.bytecode, undefined);
  assert.equal(missing.code, 'compiler_contract_missing'); assert.equal(compiler.status().active, 0);
});
test('owner and global quotas reject concurrent work and return only after worker cleanup', async () => {
  const compiler = createSolidityCompiler({ maxConcurrent: 1 });
  const first = compiler.compile({ owner: 'owner-A', name: 'PinCheck', source });
  await assert.rejects(compiler.compile({ owner: 'owner-A', name: 'PinCheck', source }), error => error.code === 'compiler_capacity');
  await assert.rejects(compiler.compile({ owner: 'owner-B', name: 'PinCheck', source }), error => error.code === 'compiler_capacity');
  await first; assert.equal(compiler.status().active, 0); assert.equal(compiler.status().queued, 0);
});
test('cancelled and timed-out real workers release quota after termination', async () => {
  const compiler = createSolidityCompiler(), controller = new AbortController();
  const pending = compiler.compile({ owner: 'owner-A', name: 'PinCheck', source, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, error => error.code === 'compiler_retired'); assert.equal(compiler.status().active, 0);
  const timed = createSolidityCompiler({ timeoutMs: 1 });
  await assert.rejects(timed.compile({ owner: 'owner-A', name: 'PinCheck', source }), error => error.code === 'compiler_timeout');
  assert.equal(timed.status().active, 0);
});
test('caller fields cannot authorize owner access or oversized compilation', async () => {
  const compiler = createSolidityCompiler();
  for (const [value, code] of [[{name:'PinCheck',source},'compiler_owner'],[{owner:'A',name:'../x',source},'compiler_source'],[{owner:'A',name:'PinCheck',source:'x'.repeat(65537)},'compiler_source']])
    await assert.rejects(compiler.compile(value), error => error.code === code);
  assert.equal(compiler.status().active, 0);
});
