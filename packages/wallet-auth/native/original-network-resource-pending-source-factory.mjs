// Normal fixed factory boundary, independently scoped from execution Source.
// No pending Root rows/Native constructor have been supplied in this snapshot.
// A PUBLIC staged DATA handle can never be passed here to gain Source custody.
const pendingRootRows=Object.freeze([]);
const fail=code=>{throw Object.assign(Error(code),{code});};
export async function openOriginalNetworkPendingConsentSourceV1(){
 if(arguments.length!==0)fail('NETWORK_PENDING_SOURCE_ARGUMENTS_FORBIDDEN');
 if(pendingRootRows.length===0)fail('NETWORK_PENDING_SOURCE_ROOT_NOT_SUPPLIED');
 fail('NETWORK_PENDING_SOURCE_MATCHING_NATIVE_BINDING_NOT_SUPPLIED');
}
