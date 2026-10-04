import test from 'node:test';
import assert from 'node:assert/strict';
import {guestRecoveryNotice} from './guestRecoveryNotice';
test('healthy guest surface has no misleading recovery failure',()=>assert.equal(guestRecoveryNotice(null),null));
test('public guest notice retains recovery direction without copying private error details',()=>{
 const original='fixture-account /callback?token=fixture-permission Unexpected native error';
 const notice=guestRecoveryNotice(original);
 if(notice===null)throw new Error('Expected guest recovery notice');
 assert.ok(notice?.includes('local data is retained'));assert.ok(notice.includes('Settings'));
 assert.equal(notice.includes('fixture-account'),false);assert.equal(notice.includes('token='),false);assert.equal(notice.includes('/callback'),false);
});
test('empty failure still has a nonblank recovery direction',()=>assert.ok(guestRecoveryNotice('')?.length));
