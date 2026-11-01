// Node-only, lazy optional peer. Legacy carriers never import a PQ provider.
import {createRequire} from 'node:module';
import {Buffer} from 'node:buffer';
import {canonicalJSON,WalletAuthError} from './canonical.js';
import {pqDecodeBase64url} from './pq-wallet-contract.js';
import {originalPrivateCarrierBudget} from './original-wallet-service-private-carrier.js';
const require=createRequire(import.meta.url);
export function assertOriginalPrivatePQCarrier(input){
 const budget=originalPrivateCarrierBudget(input);if(!budget.pq)return budget;
 const {decodeMember,encodeFields,u32}=require('@ynx/batch-v01-candidate');
 const body=JSON.parse(input.body),{walletProof,...unsigned}=body.approval,a=unsigned.accountAuthorization;
 const member=decodeMember(Buffer.from(pqDecodeBase64url(walletProof,{max:131072}))),c=member.certificate;
 const fail=code=>{throw new WalletAuthError(code,'Original private PQ session carrier is invalid')};
 if(c.N!==1||member.index!==0||member.pathA.length||member.pathB.length)fail('ORIGINAL_PRIVATE_PQ_N1_REQUIRED');
 if(c.purpose!=='PRODUCT-SESSION-APPROVAL'||c.owner!==a.canonicalOwner||!c.chainId.equals(Buffer.from(a.networkId,'hex'))||
  !c.pkA.equals(Buffer.from(a.pkA,'hex'))||!c.pkB.equals(Buffer.from(a.pkB,'hex'))||
  !member.message.equals(encodeFields([Buffer.from('YNX-PRODUCT-SESSION-APPROVAL/v3'),u32(3),Buffer.from(canonicalJSON(body.request)),Buffer.from(canonicalJSON(unsigned))])))fail('ORIGINAL_PRIVATE_PQ_CONTEXT_INVALID');
 // Structural framing only. Full dual crypto and trusted current source remain
 // mandatory in the original required-context authority before any session grant.
 return budget;
}
