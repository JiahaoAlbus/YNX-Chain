import {encodeOpenEnvelope} from '../src/open-envelope.js';
import {encodeIdentityChallengeV1DATA,decodeIdentityChallengeV1DATA} from '../src/identity-challenge.js';
declare const challenge:Parameters<typeof encodeIdentityChallengeV1DATA>[0];
const wire:Uint8Array=encodeIdentityChallengeV1DATA(challenge);
const decoded=decodeIdentityChallengeV1DATA(wire);
const epoch:string=decoded.epoch;void epoch;
declare const ctx:Parameters<typeof encodeOpenEnvelope>[0];
encodeOpenEnvelope(ctx,'YNX-OPEN/IDENTITY-CHALLENGE/1',ctx.realm,[]).then(result=>{
  if(result.ok){const bytes:Uint8Array=result.value;void bytes;
    // @ts-expect-error Encoded DATA carries no authorization grant.
    const approved:true=result.authorized;void approved;
  }else{const code:'INVALID'|'BOUNDS'|'UNSUPPORTED'=result.code;void code;}
});
// @ts-expect-error Wire fields are exact bytes, not arbitrary JSON.
encodeOpenEnvelope(ctx,'YNX-OPEN/IDENTITY-CHALLENGE/1',ctx.realm,[{}]);
// @ts-expect-error Integer fields use canonical decimal strings.
encodeIdentityChallengeV1DATA({...challenge,epoch:1});
