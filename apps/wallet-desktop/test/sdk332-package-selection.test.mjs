import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXED_SDK_RUNTIME_IDENTITIES,relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';

test('SDK332 packaging selects only its fixed independent runtime manifest',()=>{
 const pin=FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.32-auth.1'];
 assert.deepEqual(pin,{bytes:65346,sha256:'0abdc434eb6e7aacc4708127e413c686e10963f4744b730c74f3d4300f522d07'});
 assert.equal(Object.isFrozen(pin),true);assert.equal(Object.isFrozen(FIXED_SDK_RUNTIME_IDENTITIES),true);
 assert.equal(FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.33-auth.1'],undefined);
 assert.notDeepEqual(pin,FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.30-auth.1']);
});
test('SDK332 normal relocation requires all three original independent Native loads',()=>{
 const file='packages/wallet-auth/src/original-ide-admission-parent-delivery.js';
 const load="new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)";
 const result=relocateDesktopRuntimeSource(file,Buffer.from(Array(3).fill(load).join(';')),'1.3.0-pq.3.32-auth.1');
 assert.equal(result.operands[0].count,3);
 for(const n of [2,4])assert.throws(()=>relocateDesktopRuntimeSource(file,Buffer.from(Array(n).fill(load).join(';')),'1.3.0-pq.3.32-auth.1'),/count differs/);
 assert.throws(()=>relocateDesktopRuntimeSource(file,Buffer.from(Array(3).fill(load).join(';')),'1.3.0-pq.3.18'),/count differs/);
});
