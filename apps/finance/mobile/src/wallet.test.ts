import test from 'node:test';import assert from 'node:assert/strict';import {canonical} from './protocol';
test('wallet signing canonicalization is key-order stable and rejects no data by omission',()=>assert.equal(canonical({b:2,a:['x']}),'{"a":["x"],"b":2}'));
