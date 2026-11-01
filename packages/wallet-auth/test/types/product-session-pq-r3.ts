import {ProductSessionAuthority,ProductSessionGatewayHttpHandler,parseProductSession,createProductSessionProofV2,type ProductSession,type ProductSessionV3,type ProductSessionAccountContext} from '@ynx-chain/wallet-auth';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval,type PQProductSessionSigningPlan} from '@ynx-chain/wallet-auth/product-session-pq-approval';
import {captureProductSessionAccountPolicy,type OriginalProductSessionAccountPolicyResource} from '@ynx-chain/wallet-auth/product-session-account-policy';
import {signPQWalletProductSessionApproval,type PQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
declare const resource:OriginalProductSessionAccountPolicyResource,key:PQWalletKeyHandle;
const observation=captureProductSessionAccountPolicy(resource,{networkId:'network',account:'account'});
const plan=preparePQProductSessionApproval({}, {}, {account:'account',expiresAt:'expiry'},observation);
const signed=signPQWalletProductSessionApproval(key,plan);
const verified=verifyPQProductSessionApproval({}, {},signed,observation);
const context:ProductSessionAccountContext={observation,verifiedApproval:verified.verifiedApproval,required:true};
const authority=new ProductSessionAuthority({},undefined,context);
new ProductSessionGatewayHttpHandler({},()=>'',undefined,undefined,context);
const session:ProductSession=authority.complete({request:{},approval:signed,completion:{}});
if(session.version==='3'){const pq:ProductSessionV3=session;const revision:string=pq.accountAuthorization.revision;void revision;}
createProductSessionProofV2(parseProductSession({}),{method:'GET',path:'/',bodyDigest:'',nonce:'',issuedAt:'',expiresAt:''},'');
// @ts-expect-error Main-only plans cannot be reconstructed from a DTO.
const forged:PQProductSessionSigningPlan={};
// @ts-expect-error A session committed resource cannot omit original custody.
captureProductSessionAccountPolicy({readOriginal(){return {}; }},{networkId:'',account:''});
void forged;void session;
