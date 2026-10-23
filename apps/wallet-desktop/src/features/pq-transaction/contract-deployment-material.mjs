import {createHash} from 'node:crypto';
import {normalizePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {capturePQContractDeploymentMaterialData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport';
import {PQ_DEPLOYMENT_MATERIAL_PINS,PQ_DEPLOYMENT_MATERIAL_PROVENANCE} from './contract-deployment-material-pins.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Object.assign(Error('PQ_TYPED_CONTRACT_MATERIAL_UNAVAILABLE'),{code:'PQ_TYPED_CONTRACT_MATERIAL_UNAVAILABLE'})};
/** Match only the exact original Go-validated public compiler bytes and signed
 * commitments. No filesystem, remote attestation, Source/Root or permission.
 * A future compiler output requires its own original Go validation and release
 * pin update; caller booleans and caller-selected hashes cannot expand this. */
export function inspectPQGoValidatedContractMaterial(action,input){
 const normalized=normalizePQNativeAction(action);
 if(normalized.kind!=='contract_deploy')fail();
 const captured=capturePQContractDeploymentMaterialData(input),p=normalized.payload;
 const material=captured.material,sourceSha256=sha(Buffer.from(captured.source,'utf8')),artifactSha256=sha(material.artifactFile),buildInfoSha256=sha(material.buildInfoFile);
 // Multiple independently validated envelopes may exist for the same signed
 // action. Select by all original bytes; never replace a retained original.
 const row=PQ_DEPLOYMENT_MATERIAL_PINS.find(r=>r.name===p.name&&sourceSha256===r.sourceSha256&&artifactSha256===r.artifactSha256&&buildInfoSha256===r.buildInfoSha256);
 if(!row||p.sourceHash!==row.sourceHash||p.deployedBytecodeHash!==row.deployedBytecodeHash||p.compilerConfigHash!==row.compilerConfigHash||normalized.fee!=='10'||p.value!=='0')fail();
 return Object.freeze({contractName:p.name,sourceSha256,artifactSha256,buildInfoSha256,goSourceCommit:row.goSourceCommit??PQ_DEPLOYMENT_MATERIAL_PROVENANCE.sourceCommit,materialHandoffSha256:row.materialHandoffSha256??PQ_DEPLOYMENT_MATERIAL_PROVENANCE.materialHandoffSha256,goMaterialPinsMatched:true,dataOnly:true,nativeAdmission:false,permissionGranted:false,submitted:false,canRetry:false,consensusFinality:false});
}
