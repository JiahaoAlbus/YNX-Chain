#!/usr/bin/env node
// Original protected administrative entry. No HTTP route, role/body arguments,
// ENV selection, automatic retry, registry install or service activation.
import {loadOriginalAuthSourceIssuanceService} from '../src/original-auth-identity-source-current.js';
if(process.argv.length!==2)throw Error('AUTH_ISSUANCE_CALLER_SELECTION_FORBIDDEN');
const acquired=await loadOriginalAuthSourceIssuanceService();
if(!acquired)throw Error('AUTH_ISSUANCE_RELEASE_NOT_CONFIGURED');
const owner=acquired.partial??acquired;let failure,present=false;
try{
 if(acquired.partial)throw acquired.error;
 const original=await owner.issueSelected();
 // Await return is not delivery: use the SAME retained journal, approval,
 // custody and temporal fence immediately before synchronous public output.
 owner.assertOriginalCompletion(original);
 process.stdout.write(original+'\n');
}catch(error){failure=error;present=true;}
finally{
 let cleanupCause,cleanupCausePresent=false;
 try{owner.retire();owner.join();owner.close();}catch(error){cleanupCause=error;cleanupCausePresent=true;}
 if(present||cleanupCausePresent){const error=Error('AUTH_ISSUANCE_FAILED',{cause:present?failure:cleanupCause});Object.assign(error,{partial:owner,cleanupCausePresent,cleanupCause});throw error;}
}
