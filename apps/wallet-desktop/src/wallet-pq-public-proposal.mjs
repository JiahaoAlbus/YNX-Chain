import {createHash} from 'node:crypto';
import {canonicalJSON} from '@ynx-chain/wallet-auth';
import {validatePQPublicBinding} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const fail=code=>{throw Object.assign(Error(code),{code,data:{code}});};
/** Normal Main-only PUBLIC projection. Original Vault catalog read only: no
 * encrypted PQ payload decode, key handle, backup, generation, Source or PoP.
 * Digest identifies this exact public tuple; it is never issuer/admission proof. */
export async function readPQPublicProposal({vault,networkId,guard}){
 if(typeof guard?.assert!=='function'||!/^0x[0-9a-f]{40}$/.test(guard.account??'')||! /^[0-9a-f]{64}$/.test(networkId??'')||typeof vault?.readPQProposalBinding!=='function')fail('PQ_PUBLIC_PROPOSAL_CONTEXT_REQUIRED');
 guard.assert();const binding=validatePQPublicBinding(await vault.readPQProposalBinding(networkId));guard.assert();
 if(binding.owner!==guard.account||binding.chainId!==networkId)fail('PQ_PUBLIC_PROPOSAL_BINDING_CHANGED');
 const keys=pqPublicBindingToRegistrationKeys(binding),original=Object.freeze({kind:'YNX_WALLET_PQ_PUBLIC_PROPOSAL/v1',protocolVersion:binding.protocolVersion,suite:binding.suite,networkId:binding.chainId,nativeChainId:'6423',owner:binding.owner,pkA:keys.pkA,pkB:keys.pkB});
 const publicBindingSHA256=createHash('sha256').update(Buffer.from(canonicalJSON(original),'utf8')).digest('hex');guard.assert();
 return Object.freeze({...original,publicBindingSHA256,chainRegistrationVerified:false,SourceAdmission:false,signed:false,broadcast:false,privateMaterialIncluded:false});
}
