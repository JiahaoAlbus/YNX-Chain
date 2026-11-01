import{inspectPQNativePayResponseDATA,type PQNativePayResponsePacket,type PQNativePayObservationTarget}from'../src/pq-native-pay-observation.js';import type{PQAuthorizationSnapshot}from'../src/pq-wallet-policy.js';import type{PQActionTransportInput}from'../src/pq-action-transport.js';
declare const s:PQAuthorizationSnapshot;declare const i:PQActionTransportInput;declare const p:PQNativePayResponsePacket;const result=inspectPQNativePayResponseDATA(s,i,{intentId:'npi_'+'a'.repeat(48)},p);const unknown:'UNKNOWN'=result.outcome;const noPaid:false=result.paid;const noRetry:false=result.canRetry;
// @ts-expect-error caller cannot override original target owner/url
const override:PQNativePayObservationTarget={owner:'x',url:'https://caller.invalid'};
// @ts-expect-error no observer projection can become independent finality
const finality:true=result.consensusFinality;
void[unknown,noPaid,noRetry,override,finality];
