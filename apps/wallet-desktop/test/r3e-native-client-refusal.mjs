import assert from 'node:assert/strict';
import {acquireOriginalIDEAdmissionParentDelivery as parent,acquireOriginalIDEPrivateServiceChannel as acquire,getOriginalIDEPrivateServiceChannelCleanup as cleanup} from '../../../packages/wallet-auth/src/original-ide-admission-parent-delivery.js';
// Actual same-copy SDK and R33 Native, ordinary non-admitted test entry.
const owner=await parent(import.meta.url);assert.equal(owner,null);
let first,present=false;try{await acquire(import.meta.url);}catch(cause){first=cause;present=true;}
assert.equal(present,true);assert.equal(first.code,'IDE_ORIGINAL_PRIVATE_PARENT_NOT_SUPPLIED');
assert.equal(cleanup(import.meta.url),null);
console.log(JSON.stringify({state:'ACTUAL_UNCONFIGURED_SDK_REFUSES_WITHOUT_NATIVE_ACQUISITION',firstCause:first.code,node:process.versions.node,electron:process.versions.electron,positiveNativeGrant:false,hostACK:false,nativePartialAcquisitionTested:false}));
