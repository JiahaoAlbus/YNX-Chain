// Dedicated normal administrative/current selectors; NOT a Root installer.
import {loadReleaseSelectedOriginalSourceV2} from './original-auth-source-current-v2.js';
import {loadReleaseSelectedOriginalSourceIssuanceV2} from './original-auth-source-issuance-v2.js';
import {IDE_DEPLOYMENT_V2_SOURCE_PURPOSE} from '../native/original-ide-deployment-v2-contract.mjs';
const releaseSelectedIDEDeploymentV2Current=Object.freeze([]);
const releaseSelectedIDEDeploymentV2Issuance=Object.freeze([]);
const fail=code=>{throw Object.assign(Error(code),{code});};
function only(rows){if(rows.length===0)fail('IDE_DEPLOYMENT_V2_SOURCE_NOT_ADMITTED');if(rows.length!==1)fail('IDE_DEPLOYMENT_V2_SOURCE_RELEASE_AMBIGUOUS');return rows[0];}
export async function acquireOriginalIDEDeploymentV2Source(){
 if(arguments.length)fail('IDE_DEPLOYMENT_V2_SOURCE_CALLER_SELECTION_FORBIDDEN');
 const row=only(releaseSelectedIDEDeploymentV2Current);
 if(row.entry.policy.signatureContract.purpose!==IDE_DEPLOYMENT_V2_SOURCE_PURPOSE)fail('IDE_DEPLOYMENT_V2_SOURCE_PURPOSE');
 return loadReleaseSelectedOriginalSourceV2(row.entry,row.readOriginalPublic);
}
export async function acquireOriginalIDEDeploymentV2SourceIssuer(){
 if(arguments.length)fail('IDE_DEPLOYMENT_V2_SOURCE_CALLER_SELECTION_FORBIDDEN');
 const row=only(releaseSelectedIDEDeploymentV2Issuance);
 if(row.entry.plan.policy.signatureContract.purpose!==IDE_DEPLOYMENT_V2_SOURCE_PURPOSE)fail('IDE_DEPLOYMENT_V2_SOURCE_PURPOSE');
 return loadReleaseSelectedOriginalSourceIssuanceV2(row.entry);
}
