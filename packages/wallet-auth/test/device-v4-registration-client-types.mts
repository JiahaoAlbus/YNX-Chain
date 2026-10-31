import{openOriginalProductDeviceV4RegistrationClient,type OriginalDeviceV4PairPacket,type OriginalDeviceV4RegistrationSelectionDATA}from'../src/original-product-device-v4-registration-client.js';
import{preparePQProductSessionApprovalV4,type PQProductSessionApprovalV4SigningPlan}from'../src/product-session-pq-v4-codec.js';
import{signPQWalletProductSessionApprovalV4,signPQWalletProductSessionApproval,type PQWalletKeyHandle}from'../src/pq-wallet-key-backup.js';
import type{PQProductSessionSigningPlan}from'../src/product-session-pq-approval.js';
declare const handle:PQWalletKeyHandle,plan:PQProductSessionApprovalV4SigningPlan,oldPlan:PQProductSessionSigningPlan,packet:OriginalDeviceV4PairPacket,selection:OriginalDeviceV4RegistrationSelectionDATA;
signPQWalletProductSessionApprovalV4(handle,plan);
const client=await openOriginalProductDeviceV4RegistrationClient();client.readOriginalRegistrationReviewDATA(selection);client.readOriginalPairRequestDATA(packet);
// @ts-expect-error No Native provider/endpoint injection.
openOriginalProductDeviceV4RegistrationClient({endpoint:'https://other.invalid'});
// @ts-expect-error DATA cannot supply a v4 original account plan.
signPQWalletProductSessionApprovalV4(handle,{});
// @ts-expect-error Old v3 plans cannot enter the v4 signer.
signPQWalletProductSessionApprovalV4(handle,oldPlan);
// @ts-expect-error V4 opaque plans cannot fall back to the old signer.
signPQWalletProductSessionApproval(handle,plan);
// @ts-expect-error Prepared packet cannot be replaced by success JSON.
client.submitPreparedPair({registered:true},{signal:new AbortController().signal});
// @ts-expect-error Native public pair must be actual bytes.
client.readOriginalRegistrationReviewDATA({...selection,publicPair:{pkA:'fake',pkB:'fake'}});
void preparePQProductSessionApprovalV4;
