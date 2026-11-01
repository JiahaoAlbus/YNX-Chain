import{openOriginalProductDeviceV4RegistrationClient}from'../src/original-product-device-v4-registration-client.js';
import type{OriginalDeviceV4RegistrationClient,OriginalDeviceV4CompletionSelectionDATA,OriginalDeviceV4CompletionPacket,OriginalDeviceV4PairPacket,OriginalDeviceV4RegistrationAbortContext}from'../src/original-product-device-v4-registration-client.js';
import type{ProductSessionAccountPolicyObservation}from'../src/product-session-account-policy.js';
declare const client:OriginalDeviceV4RegistrationClient,selection:OriginalDeviceV4CompletionSelectionDATA,context:OriginalDeviceV4RegistrationAbortContext,policy:ProductSessionAccountPolicyObservation,completion:OriginalDeviceV4CompletionPacket,pair:OriginalDeviceV4PairPacket;
client.readOriginalCompletionReviewDATA(selection);const prepared=client.prepareOriginalCompletionSubmission({approvalOriginal:'original',policyRef:policy,abortContext:context});void prepared;
const data=client.readOriginalCompletionRequestDATA(completion);const member:Uint8Array=data.memberOriginal;const result=await client.submitPreparedCompletion(completion,context);const noRegistration:false=result.registered;const binding:string=result.session.sessionBinding;const retained:Uint8Array|null=client.readStatusDATA().originalMember;void member;void noRegistration;void binding;void retained;
// @ts-expect-error Pair packet cannot enter challenge-completion HTTP.
client.submitPreparedCompletion(pair,context);
// @ts-expect-error Completion packet cannot be consumed as old pair registration.
client.submitPreparedPair(completion,context);
// @ts-expect-error Original Native challenge review cannot be self-filled by approval flag.
client.readOriginalCompletionReviewDATA({...selection,approved:true});
// @ts-expect-error No caller endpoint/provider or key factory.
openOriginalProductDeviceV4RegistrationClient({endpoint:'https://other.invalid'});
// @ts-expect-error No successful session/registered DTO can replace opaque packet.
client.submitPreparedCompletion({registered:true},context);
// @ts-expect-error Independent original challenge bytes are mandatory.
client.readOriginalCompletionReviewDATA({identityBinding:selection.identityBinding,generation:selection.generation,publicPair:selection.publicPair});
