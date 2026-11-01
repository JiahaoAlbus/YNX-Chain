import {encodeProductPairPendingOriginalQueryMessageDATA,inspectProductPairPendingOriginalQueryMessageDATA,inspectRegisteredProductPairPendingOriginalQueryN1DATA,type PendingOriginalQueryE13Input} from '../src/product-pair-pending-original-query-e13.js';
declare const input:PendingOriginalQueryE13Input,member:Uint8Array;
const message:Uint8Array=encodeProductPairPendingOriginalQueryMessageDATA(input);
const data=inspectProductPairPendingOriginalQueryMessageDATA(message,input),math=inspectRegisteredProductPairPendingOriginalQueryN1DATA(member,input);
const noMath:false=data.signatureVerified,yesMath:true=math.signatureVerified,noSource:false=math.SourceAdmission,noCurrent:false=math.current;
// @ts-expect-error original expected registered pair never comes from member itself
inspectRegisteredProductPairPendingOriginalQueryN1DATA(member);
// @ts-expect-error no implicit ambient observation or omitted Source window
const incomplete:PendingOriginalQueryE13Input={queryOriginal:new Uint8Array(),registrationOriginal:new Uint8Array(),originalPairPost:new Uint8Array(),expected:{networkId:'ab'}};
// @ts-expect-error no active session or login grant
const grant:true=math.authorized;
// @ts-expect-error E13 has no sessionBinding
const session:string=data.sessionBinding;
void [noMath,yesMath,noSource,noCurrent,incomplete,grant,session];
import {inspectRegisteredProductPairPendingOriginalQueryEnvelopeN1DATA,extractProductPairPendingOriginalQueryClaimsDATA,encodeProductPairPendingOriginalQueryProofHeaderV1,decodeProductPairPendingOriginalQueryProofHeaderV1,type PendingOriginalQueryE13EnvelopeInput} from '../src/product-pair-pending-original-query-e13.js';
declare const envelopeInput:PendingOriginalQueryE13EnvelopeInput;
const stage=inspectRegisteredProductPairPendingOriginalQueryEnvelopeN1DATA(member,envelopeInput),claims=extractProductPairPendingOriginalQueryClaimsDATA(member);
const noOriginal:false=stage.originalPostVerified;const yesUntrusted:true=claims.untrusted;const noSignature:false=claims.signatureVerified;
const header:string=encodeProductPairPendingOriginalQueryProofHeaderV1(member);const raw:Uint8Array=decodeProductPairPendingOriginalQueryProofHeaderV1(header);
// @ts-expect-error full original cannot be omitted after envelope stage
inspectRegisteredProductPairPendingOriginalQueryN1DATA(member,envelopeInput);
// @ts-expect-error never populate independent expected from certificate keys in claims
const unsafe:string=claims.pkA;
void [noOriginal,yesUntrusted,noSignature,header,raw,unsafe];
