'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,LIMIT=160*1024;
const CODES=new Set(['IDE_CONTRACT_MATERIAL_REVIEW_REQUIRED','PQ_CONTRACT_DEPLOYMENT_MATERIAL_INVALID','IDE_CONTRACT_NOT_CONNECTED','IDE_CONTRACT_WALLET_CHANGED','IDE_CONTRACT_RETIRED','IDE_CONTRACT_SIGNED_REFERENCE_INVALID','IDE_CONTRACT_REFERENCE_EXISTS','IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED','IDE_CONTRACT_REFERENCE_NOT_DURABLE']);
CODES.add('IDE_CONTRACT_EXECUTION_REVIEW_REQUIRED');
CODES.add('IDE_PUBLICATION_OBSERVATION_CANCELLED');
CODES.add('PQ_NATIVE_ACTION_INVALID');
CODES.add('IDE_CONTRACT_ORIGINAL_RESULT_INVALID');
// Only reviewed public diagnostics cross this DATA channel. Never serialize
// the original exception message, stack, path, Source record or opaque owner.
for(const code of ['IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED','IDE_PUBLICATION_NOT_SUPPLIED','IDE_PUBLICATION_PROJECT_UNAVAILABLE','IDE_PUBLICATION_PROJECT_RETIRED','IDE_PUBLICATION_PUBLISHER_UNAVAILABLE','IDE_ARTIFACT_FILE_CHANGED','IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED','IDE_ARTIFACT_PATH_CHANGED','IDE_ARTIFACT_OUTSIDE_PROJECT','IDE_ARTIFACT_CLOUD_NOT_SUPPLIED'])CODES.add(code);
const fail=()=>Object.assign(Error('Project Wallet request unavailable; retained references were preserved.'),{code:'IDE_CONTRACT_SERVICE_UNAVAILABLE'});
function valid(action,body){
 if(!body||Object.getPrototypeOf(body)!==Object.prototype)return false;
 const keys=Object.keys(body).sort().join();
 if(['inspect','connect','cancel','references'].includes(action))return keys==='';
 if(action==='read')return keys==='referenceId'&&UUID.test(body.referenceId||'');
 if(action==='deployment-prepare'||action==='execution-prepare')return keys==='draftId'&&UUID.test(body.draftId||'');
 if(action==='deployment-broadcast'||action==='execution-broadcast')return keys==='referenceId'&&UUID.test(body.referenceId||'');
 if(action==='execution-preview')return keys==='calldata,compilerConfigHash,deployedBytecodeHash,expectedStorageCommitment,name,sourceHash,target,value'&&Object.values(body).every(value=>typeof value==='string'&&value.length<=4096);
 if(action==='deployment-preview')return keys==='artifactURI,buildInfoURI,constructorArg,name,sourceURI'&&['SampleEVMWriteCounter','SampleYNXTCompatibleERC20'].includes(body.name)&&typeof body.constructorArg==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(body.constructorArg)&&['sourceURI','artifactURI','buildInfoURI'].every(key=>typeof body[key]==='string'&&body[key].length<=4096);
 if(action==='publication-observe-cancel')return keys==='observationId'&&UUID.test(body.observationId||'');
 if(action==='publication-observe')return (keys==='requestId'||keys==='observationId,requestId'&&UUID.test(body.observationId||''))&&UUID.test(body.requestId||'');
 if(action==='publication-preview')return keys==='artifactURI,publishPurpose,targetEnvironment,version'&&typeof body.artifactURI==='string'&&body.artifactURI.length<=4096&&['publishPurpose','targetEnvironment','version'].every(key=>typeof body[key]==='string'&&body[key].length>0&&body[key].length<=256);
 return action==='query'&&keys==='referenceId,refresh'&&UUID.test(body.referenceId||'')&&typeof body.refresh==='boolean';
}
module.exports={valid,CODES};
