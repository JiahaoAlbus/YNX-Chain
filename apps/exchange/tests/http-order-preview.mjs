// A test-only independent process consumes real HTTP rules and compares them
// with vectors produced by the existing Go engine's exact money functions.
import assert from 'node:assert/strict';
import {buildOrderPreview} from '../web/order-preview.js';
let raw='';for await(const part of process.stdin)raw+=part;
const vectors=JSON.parse(raw);
const response=await fetch(`${process.argv[2]}/v1/market-data/snapshot`,{method:'GET',credentials:'omit'});
assert.equal(response.status,200);
const snapshot=await response.json();
assert.equal(snapshot.tradingRules.makerFeeBps,17);assert.equal(snapshot.tradingRules.takerFeeBps,43);
for(const vector of vectors){const value=buildOrderPreview({...vector,rules:snapshot.tradingRules,source:snapshot.sourceMetadata,marketPhase:'live',now:Date.parse(snapshot.sourceMetadata.asOf)});for(const key of ['notionalMicro','makerFeeMicro','takerFeeMicro','initialReservationMicro'])assert.equal(value[key].toString(),vector.expected[key],key)}
process.stdout.write(`ENGINE_RULE_VECTORS=${vectors.length}\n`);
