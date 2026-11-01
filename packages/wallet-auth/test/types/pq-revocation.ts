import {normalizePQRevocationIntent,encodePQRevocationIntent,decodePQRevocationIntent,encodePQRevocationRequest,decodePQRevocationRequest,preparePQRevocationTransport,type PQRevocationIntentInput} from '../../src/pq-wallet-authorization.js';
import {planPQAccountRevocation,assertPQRevocationRequestPolicy,preparePQReviewedRevocationTransport,type PQAuthorizationSnapshot} from '../../src/pq-wallet-policy.js';
import {signPQWalletAccountRevocation,type PQWalletKeyHandle} from '../../src/pq-wallet-key-backup.js';
declare const input:PQRevocationIntentInput,snapshot:PQAuthorizationSnapshot,handle:PQWalletKeyHandle,member:Uint8Array;
const intent=decodePQRevocationIntent(encodePQRevocationIntent(normalizePQRevocationIntent(input)));
const proof={intent,currentPQMember:member},wire=encodePQRevocationRequest(proof);
const purpose:'ACCOUNT-REVOCATION'=decodePQRevocationRequest(wire).purpose;
const unfinal:false=preparePQRevocationTransport(wire).admissionIsFinality;
planPQAccountRevocation(snapshot,input);assertPQRevocationRequestPolicy(snapshot,wire);preparePQReviewedRevocationTransport(snapshot,proof);
const signed=signPQWalletAccountRevocation(handle,input,snapshot);const post:'POST'=signed.method;
// @ts-expect-error Revocation has no classic authorization branch.
encodePQRevocationRequest({...proof,classicSignature:member});
// @ts-expect-error Number would lose U64 precision.
normalizePQRevocationIntent({...input,executeAt:1});
void [purpose,unfinal,post];
