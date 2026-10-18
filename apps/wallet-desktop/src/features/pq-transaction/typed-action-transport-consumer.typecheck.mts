import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {inspectPQTypedActionTransportOriginal} from './typed-action-transport-reader.mjs';
declare const snapshot:PQAuthorizationSnapshot,raw:Uint8Array;
const expected={account:'0x'+'11'.repeat(20),networkId:'22'.repeat(32),memberHash:'0x'+'33'.repeat(32),transportHash:'0x'+'44'.repeat(32)};
function compileOnly(){
 const original=inspectPQTypedActionTransportOriginal(snapshot,raw,expected);
 const retry:false=original.canRetry,permission:false=original.permissionGranted;
 const witnesses:boolean=original.classicWitnessValidationRequired,body:Uint8Array=original.body;
 // @ts-expect-error raw JSON is not an original SDK-branded snapshot
 inspectPQTypedActionTransportOriginal({},raw,expected);
 // @ts-expect-error original transport identity must include both hashes
 inspectPQTypedActionTransportOriginal(snapshot,raw,{account:expected.account,networkId:expected.networkId,memberHash:expected.memberHash});
 // @ts-expect-error a public observer cannot grant permission
 const grant:true=original.permissionGranted;
 return {retry,permission,witnesses,body,grant};
}
void compileOnly;
