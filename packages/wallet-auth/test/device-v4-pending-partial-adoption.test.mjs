import test,{mock}from'node:test';import assert from'node:assert/strict';
test('Native produce exception retains SAME held partial and closes it before parent',async()=>{
 const calls=[],child=Object.freeze({readOriginalMember:()=>new Uint8Array([1]),assertCurrent(){},retire(){calls.push('child-retire')},join(){calls.push('child-join')},close(){calls.push('child-close')},readOriginalStatus:()=>Object.freeze({unknown:true})}),error=Object.assign(Error('PUBLIC entered failure'),{partial:child});
 const source=Object.freeze({readOriginalReview:()=>new Uint8Array([1]),assertCurrent(){},produceRegistrationProof(){throw error},produceChallengeProof(){throw false},retire(){calls.push('parent-retire')},join(){assert(calls.includes('child-close'));calls.push('parent-join')},close(){calls.push('parent-close')}});
 const fixed=new URL('../src/original-auth-identity-fixed-native-image.js',import.meta.url);mock.module(fixed.href,{namedExports:{loadOriginalAuthIdentityNativeImage:()=>({acquireOriginalProductSessionDeviceV4PendingSource:()=>source})}});
 const{openOriginalProductSessionDeviceV4PendingProofClient}=await import('../src/original-product-device-v4-pending-client.js');
 const client=await openOriginalProductSessionDeviceV4PendingProofClient(),context=Object.freeze({signal:new AbortController().signal});await assert.rejects(client.produceRegistrationProof(context),e=>e===error&&e.partial===child);
 assert.equal(client.status().operationRetained,true);assert.equal(client.status().firstBoundaryCause,error);await client.close();assert.deepEqual(calls,['child-retire','child-join','child-close','parent-retire','parent-join','parent-close']);assert.equal(client.status().unknown,true);assert.equal(client.status().closed,true);
});
