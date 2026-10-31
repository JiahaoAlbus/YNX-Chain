import{encodeBoundGrant,decodeBoundGrant,encodeGrantEffect,decodeGrantEffect}from'@ynx-chain/open-protocol/bound-grant';
import type{BoundGrantV1,OriginalBoundGrantAuthorityCalls,OriginalProtectedGrantProof,BoundGrantIssuerApprovalV1}from'@ynx-chain/open-protocol/bound-grant';
declare const grant:BoundGrantV1,service:OriginalBoundGrantAuthorityCalls,proof:OriginalProtectedGrantProof,approval:BoundGrantIssuerApprovalV1;
const wire:Uint8Array=encodeBoundGrant(grant),roundtrip:BoundGrantV1=decodeBoundGrant(wire);
const effect:Uint8Array=encodeGrantEffect(roundtrip,roundtrip.binding),selected=decodeGrantEffect(effect);
void service.signBoundGrant(grant,approval,proof);void service.authorizeAtEffect(selected.grant,selected.step,proof,grant.rev);
// @ts-expect-error DATA consent flags are not an original protected proof.
void service.authorizeAtEffect(grant,grant.binding,{approved:true},grant.rev);
// @ts-expect-error No JSON number is a canonical decimal U64.
void encodeBoundGrant({...grant,cap:1});
// @ts-expect-error No redelegation is representable in this profile.
void encodeBoundGrant({...grant,nonDelegable:false});
