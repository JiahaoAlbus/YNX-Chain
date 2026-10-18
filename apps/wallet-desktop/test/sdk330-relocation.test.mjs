import test from 'node:test';
import assert from 'node:assert/strict';
import {relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';
const name='packages/wallet-auth/src/original-ide-admission-parent-delivery.js';
const version='1.3.0-pq.3.30-auth.1';
const operand='../../../apps/wallet-desktop/native/original-auth-identity.node';
const body=count=>Buffer.from(Array.from({length:count},(_,i)=>`const original${i}=new URL('${operand}',import.meta.url);`).join('\n'));
test('SDK330 selected version requires exactly three original Native operands without rewriting',()=>{
 const source=body(3),result=relocateDesktopRuntimeSource(name,source,version);
 assert.deepEqual(result.bytes,source);assert.equal(result.operands[0].count,3);
});
test('SDK330 rejects missing, extra, foreign and SDK318 operands',()=>{
 for(const count of [0,1,2,4])assert.throws(()=>relocateDesktopRuntimeSource(name,body(count),version),/operand count differs/);
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.concat([body(3),Buffer.from("\nnew URL('../../../apps/wallet-desktop/native/foreign.node',import.meta.url);")]),version),/Unlisted repository operand/);
});
test('SDK318 stays exactly two; SDK330 does not change the original single Host operand',()=>{
 assert.equal(relocateDesktopRuntimeSource(name,body(2),'1.3.0-pq.3.18').operands[0].count,2);
 assert.throws(()=>relocateDesktopRuntimeSource(name,body(3),'1.3.0-pq.3.18'),/operand count differs/);
 const host='packages/wallet-auth/src/original-host-terminal-journal.js';
 assert.equal(relocateDesktopRuntimeSource(host,body(1),version).operands[0].count,1);
 assert.throws(()=>relocateDesktopRuntimeSource(host,body(2),version),/operand count differs/);
});
