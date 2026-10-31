// Normal daemon lifecycle only. This inventory is not a Source/Principal or
// readiness grant. Actual acquisition is the Host's zero-input fixed supplier.
const states=new WeakMap();
export async function openOriginalBinaryV5PolicyAfterHost(host){
 const reference=Object.freeze({}),state={host,configured:false,failurePresent:false,failure:undefined,closed:false,closeFailurePresent:false,closeFailure:undefined};states.set(reference,state);
 try{const result=await host.supplyOriginalBinaryV5AccountPolicy();if(!result||result.configured!==true)throw Object.assign(Error('ACCOUNT_POLICY_BINARY_V5_SUPPLY_INVALID'),{code:'ACCOUNT_POLICY_BINARY_V5_SUPPLY_INVALID'});state.configured=true;}
 catch(cause){state.failurePresent=true;state.failure=cause;}
 return reference;
}
export function originalBinaryV5PolicyStartupStatus(reference){const s=states.get(reference);if(!s)throw Error('ORIGINAL_BINARY_V5_STARTUP_REQUIRED');return Object.freeze({configured:s.configured,failurePresent:s.failurePresent,failure:s.failure,closed:s.closed,closeFailurePresent:s.closeFailurePresent,closeFailure:s.closeFailure});}
export function closeOriginalBinaryV5PolicyAfterHost(reference){const s=states.get(reference);if(!s)throw Error('ORIGINAL_BINARY_V5_STARTUP_REQUIRED');
 // Host retains a partial before errors; its join must settle before close.
 // A pending/uncertain close remains owned and is never relabeled closed.
 if(s.closed){if(s.closeFailurePresent)throw s.closeFailure;return;}try{s.host.closeOriginalBinaryV5AccountPolicy();s.closed=true;}catch(cause){if(!s.closeFailurePresent){s.closeFailurePresent=true;s.closeFailure=cause}throw s.closeFailure;}if(s.closeFailurePresent)throw s.closeFailure;
}
