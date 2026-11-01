// DATA equality/window continuation for the actual P09 Runner getter. Root
// selection, peer/FD/current ownership remain mandatory in the calling capture.
import {inspectOriginalNetworkResourceCurrent9V1DATA} from './original-network-resource-source-v2-contract.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function assertOriginalP09CurrentSnapshotContinuesV1DATA(original,observed,atMs){
 const first=inspectOriginalNetworkResourceCurrent9V1DATA(original),next=inspectOriginalNetworkResourceCurrent9V1DATA(observed);
 if(first.expiresAtMs-first.issuedAtMs>20000||next.expiresAtMs-next.issuedAtMs>20000)fail('NETWORK_CURRENT_P09_TTL20_REQUIRED');
 if(!Number.isSafeInteger(atMs)||atMs<first.issuedAtMs||atMs>=first.expiresAtMs||atMs<next.issuedAtMs||atMs>=next.expiresAtMs)fail('NETWORK_CURRENT_P09_ORIGINAL_WINDOW');
 // ReadCurrentResourceDATA issues a fresh 20s read window on every actual read.
 // Do not compare new timestamps as if they were state, nor use them to extend
 // the held original's signing window. Compare the seven original state fields.
 if(next.issuedAtMs<first.issuedAtMs)fail('NETWORK_CURRENT_P09_CLOCK_ROLLBACK');
 for(const field of ['sourceId','instanceId','resourceKey','epoch','sequence','head','status'])if(first[field]!==next[field])fail('NETWORK_CURRENT_P09_SNAPSHOT_CHANGED');
 return Object.freeze({sameOriginalState:true,originalExpiresAtMs:first.expiresAtMs,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}

