import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedProcessSet } from './owned-process-set.mjs';

test('excludes shared ancestors while retaining actual launcher and whole job group', () => {
  const rows = '1093 1 1093\n20425 1093 20425\n30000 20425 30000\n30001 30000 30000\n40000 1093 40000\n';
  assert.deepEqual(ownedProcessSet(rows, 20425, 30000), [20425, 30000, 30001]);
});

test('includes recursive compiler descendants even if a descendant changes group', () => {
  const rows = '4 3 4\n3 2 3\n2 1 2\n1 1093 1\n1093 0 1093\n';
  assert.deepEqual(ownedProcessSet(rows, 1, 2), [1, 2, 3, 4]);
});

test('group members remain owned after parent exits; unrelated processes stay excluded', () => {
  assert.deepEqual(ownedProcessSet('40 1 30\n41 40 41\n70 1 70\n', 20, 30), [20, 40, 41]);
});

test('terminal absent job does not invent a readable PID or include shared parent', () => {
  assert.deepEqual(ownedProcessSet('1093 1 1093\n20 1093 20\n', 20, 30), [20]);
});

test('excess descendants fail closed rather than silently truncating watched set', () => {
  let rows = '20 1093 20\n30 20 30\n';
  for (let i = 31; i < 46; i++) rows += `${i} 30 30\n`;
  assert.throws(() => ownedProcessSet(rows, 20, 30), /bound exceeded/);
});

test('malformed, duplicate and oversized inventories fail closed', () => {
  for (const rows of ['x 1 2', '1 2', '1 -1 2', '1 2 3\n1 2 3\n', '1 2 9007199254740993', ' '.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => ownedProcessSet(rows, 20, 30));
  }
});
