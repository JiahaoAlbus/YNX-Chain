import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionOwnedValue} from './taskSessionView';

test('task content is hidden on the first render after logout or session replacement',()=>{
 const first={},second={},privateView={answer:'original private result'};
 assert.equal(sessionOwnedValue(first,first,privateView),privateView);
 assert.equal(sessionOwnedValue(undefined,first,privateView),null);
 assert.equal(sessionOwnedValue(second,first,privateView),null);
 assert.equal(sessionOwnedValue(undefined,undefined,privateView),null);
});
