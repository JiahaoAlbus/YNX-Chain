import {selectedOriginalIDEContractRelayIssuance} from './original-ide-relay-issuance-selection.js';
import {loadReleaseSelectedOriginalSourceIssuanceV2} from './original-auth-source-issuance-v2.js';
// Private normal administration entry. It neither signs at acquisition nor
// installs public files. The existing issuer retains once/current/approval/key
// custody. Caller must preserve error.partial and the SAME returned owner.
export async function acquireOriginalIDEContractRelayIssuanceSource(){
 if(arguments.length)throw Object.assign(new Error('IDE_RELAY_ISSUANCE_ZERO_INPUT'),{code:'IDE_RELAY_ISSUANCE_ZERO_INPUT'});
 const entry=selectedOriginalIDEContractRelayIssuance();
 if(entry?.plan?.policy?.signatureContract?.purpose!=='ide-contract-relay-v1')throw Object.assign(new Error('IDE_RELAY_ISSUANCE_DEDICATED_PURPOSE_REQUIRED'),{code:'IDE_RELAY_ISSUANCE_DEDICATED_PURPOSE_REQUIRED'});
 return loadReleaseSelectedOriginalSourceIssuanceV2(entry);
}
