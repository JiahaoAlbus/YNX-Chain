// Existing Node semantics/math against an SDK-branded snapshot, still DATA.
// Main retains genuine review/current/private-custody/journal/send ownership.
import {Buffer} from 'node:buffer';
import {decodeMember} from '@ynx/batch-v01-candidate';
import {encodePQActionTransportData,decodePQActionTransportData} from './pq-action-transport.js';
import {decodePQNativeAction} from './pq-native-action.js';
import {planPQNativeAction} from './pq-wallet-policy.js';
import {verifyPQRegisteredMemberData} from './pq-registered-member.js';
import {pqError} from './pq-wallet-contract.js';
const staking=new Set(['stake_delegate','stake_unbond','stake_withdraw']);
export function preparePQNativeActionTransportData(snapshot,input){
  const body=encodePQActionTransportData(input),captured=decodePQActionTransportData(body);
  const member=decodeMember(Buffer.from(captured.member)),action=decodePQNativeAction(member.message);
  if(captured.originals.length&&!staking.has(action.kind))throw pqError('PQ_ACTION_ORIGINALS_KIND_INVALID');
  if(action.kind==='contract_deploy')throw pqError('PQ_ACTION_COMPILER_MATERIAL_REQUIRED');
  const plan=planPQNativeAction(snapshot,action);
  const verified=verifyPQRegisteredMemberData(snapshot,captured.member,{chainId:plan.policy.chainId,owner:plan.policy.owner,keyVersion:plan.policy.policyRevision,executionHeight:plan.policy.executionHeight,purpose:'TX-BATCH',message:member.message});
  return Object.freeze({...verified,action,classicWitnessValidationRequired:captured.originals.length>0,get body(){return new Uint8Array(body);}});
}
