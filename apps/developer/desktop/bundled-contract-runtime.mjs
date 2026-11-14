import {loadBundledIdentitySDK} from './identity-sdk-loader.mjs';
export async function openBundledContractRelayAuthority({serverModuleURL,expectedScope,localContext}){
  const guardAPI=await loadBundledIdentitySDK('original-ide-contract-relay-guard'),connectionAPI=await loadBundledIdentitySDK('walletconnect-dapp-connection');
  if(typeof guardAPI.acquireOriginalIDEContractRelayGuard!=='function'||typeof guardAPI.assertOriginalIDEContractRelayGuardCurrent!=='function'||typeof connectionAPI.createDeveloperContractConnection!=='function')throw Object.assign(Error('Original contract authority is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
  let guard,firstCause,failed=false,closed=false,cleanup;
  try{guard=await guardAPI.acquireOriginalIDEContractRelayGuard({serverModuleURL,...(expectedScope===undefined?{}:{expectedScope}),...(localContext===undefined?{}:{localContext})});}catch(error){failed=true;firstCause=error;guard=error?.cleanupOwner;}
  const current=()=>{if(closed)throw Object.assign(Error('Contract authority retired.'),{code:'IDE_CONTRACT_RETIRED'});if(failed)throw firstCause;return guardAPI.assertOriginalIDEContractRelayGuardCurrent(guard);};
  // A partial result stays cleanup-only, retaining its exact original cause.
  return Object.freeze({assertCurrent:current,createConnection(){const scope=current();return connectionAPI.createDeveloperContractConnection({relayGuard:guard,relayContext:{projectId:scope.projectId,projectGeneration:scope.projectGeneration}});},close(){closed=true;return cleanup ||= Promise.resolve().then(()=>guard?.close());}});
}
export async function createBundledProjectContractRuntime({context,serverModuleURL}){
  const {createProjectContractRuntime}=await import('./project-contract-runtime.mjs');
  return createProjectContractRuntime({context,loadMaterialBuilder:async()=>{const module=await loadBundledIdentitySDK('pq-contract-deployment-material');if(typeof module.preparePQContractDeploymentMaterialData!=='function')throw Object.assign(Error('Contract DATA builder unavailable'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});return module.preparePQContractDeploymentMaterialData;},loadExecutionCodec:()=>loadBundledIdentitySDK('pq-native-action'),acquireAuthority:localContext=>openBundledContractRelayAuthority({serverModuleURL,localContext})});
}
