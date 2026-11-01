import {ProductSessionGatewayNodeHost,type OriginalAccountPolicyRunner} from '@ynx-chain/wallet-auth/product-session-gateway-node-host';
import {pqProductSessionRegisteredPublicBinding,type ProductSessionAccountPolicyObservation} from '@ynx-chain/wallet-auth/product-session-account-policy';
import {preparePQClassicMigrationProof,type PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import type {PQRegistrationIntentInput,PQClassicSignerPublicResult} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createProductSessionReturnURL,parseProductSessionReturnURL,type ProductSessionAccountContext,type VerifiedPQProductSessionApproval} from '@ynx-chain/wallet-auth';
declare const context:ProductSessionAccountContext,observation:ProductSessionAccountPolicyObservation,verified:VerifiedPQProductSessionApproval;
declare const snapshot:PQAuthorizationSnapshot,intent:PQRegistrationIntentInput,signature:PQClassicSignerPublicResult;
const run:OriginalAccountPolicyRunner=async(operation,execute)=>{const requestId:string=operation.requestId;const at:string=operation.at;void requestId;void at;execute({...context,required:true});};
new ProductSessionGatewayNodeHost({}, {now:()=>new Date(),statePath:'/QA/state',tokenFactory:()=>'',accountPolicy:{mode:'required',run}});
// @ts-expect-error Normal service cannot configure an optional policy mode.
new ProductSessionGatewayNodeHost({}, {now:()=>new Date(),statePath:'/QA/state',tokenFactory:()=>'',accountPolicy:{mode:'optional',run}});
const binding=pqProductSessionRegisteredPublicBinding(observation,'account');const key:string=binding.pkA;void key;
const proof=preparePQClassicMigrationProof(snapshot,intent,signature);const der:Uint8Array=proof.classicSignature;void der;
const url=createProductSessionReturnURL({}, {}, {},new Date(),verified);parseProductSessionReturnURL({}, {},url,new Date(),verified);
