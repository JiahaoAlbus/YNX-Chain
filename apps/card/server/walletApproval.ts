import {CardError,CHAIN,type WalletAuthority} from './contracts.ts';
import {requireScope} from './permissions.ts';
import {cardApplicationApprovalId,evmAddressFromYNX,verifySignedCardApplicationApproval} from './vendor/wallet-session-a7dad7ec/product-session-server.mjs';

/** Authentication is a separately accepted, fresh Product Session verifier.
 * No external adapter can substitute its own unverified application approval.
 * This module imports only Wallet Owner verification, never a signing helper. */
export function withCardApplicationVerifier(authentication:Pick<WalletAuthority,'authenticate'>,clock:()=>Date=()=>new Date()):WalletAuthority {
  return {
    authenticate:request=>authentication.authenticate(request),
    async approve(principal,challenge,proof,details){
      const now=clock();
      requireScope(principal,'card:application:write');
      if(!Number.isFinite(Date.parse(principal.expiresAt))||Date.parse(principal.expiresAt)<=now.getTime())throw new CardError('CARD_AUTH_EXPIRED',401);
      if(principal.chainId!==CHAIN&&principal.chainId!=='ynx_6423-1')throw new CardError('WRONG_TESTNET_CHAIN');
      if(details.riskAccepted!==true||details.termsVersion!=='card-testnet-v1')throw new CardError('TESTNET_TERMS_AND_DETAILS_REQUIRED',400);
      try{
        const verified=verifySignedCardApplicationApproval(proof,{
          challenge,details:{...details,riskAccepted:true,termsVersion:'card-testnet-v1'},account:principal.owner,
        },now);
        return {
          approved:true,approvalId:cardApplicationApprovalId(verified),challengeId:verified.challenge.id,
          owner:verified.challenge.owner,payloadHash:verified.challenge.payloadHash,expiresAt:verified.expiresAt,
          evmAddress:evmAddressFromYNX(verified.account),
        };
      }catch{throw new CardError('INVALID_CARD_APPROVAL',403)}
    },
  };
}
