// Original Member/Action/snapshot math only. Compiler authentication remains Go.
import {Buffer} from 'node:buffer';
import {decodeMember} from '@ynx/batch-v01-candidate';
import {encodePQContractDeploymentTransportData,decodePQContractDeploymentTransportData} from './pq-contract-deployment-transport.js';
import {decodePQNativeAction} from './pq-native-action.js';
import {planPQNativeAction} from './pq-wallet-policy.js';
import {verifyPQRegisteredMemberData} from './pq-registered-member.js';
import {pqError} from './pq-wallet-contract.js';
export function preparePQContractDeploymentTransportData(snapshot,input){
  const body=encodePQContractDeploymentTransportData(input),captured=decodePQContractDeploymentTransportData(body);
  const member=decodeMember(Buffer.from(captured.member)),action=decodePQNativeAction(member.message);
  if(action.kind!=='contract_deploy')throw pqError('PQ_CONTRACT_DEPLOYMENT_KIND_INVALID');
  const plan=planPQNativeAction(snapshot,action);
  const verified=verifyPQRegisteredMemberData(snapshot,captured.member,{chainId:plan.policy.chainId,owner:plan.policy.owner,keyVersion:plan.policy.policyRevision,executionHeight:plan.policy.executionHeight,purpose:'TX-BATCH',message:member.message});
  return Object.freeze({...verified,action,compilerMaterialValidationRequired:true,get body(){return new Uint8Array(body);}});
}
