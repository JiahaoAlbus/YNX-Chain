import type {PQAuthorizationSnapshot} from './pq-wallet-policy.js';
import type {PQNativeAction} from './pq-native-action.js';
import type {PQActionTransportInput} from './pq-action-transport.js';
/** Existing full Member math/current snapshot binding; no Source/user grant,
 * classic-original signature/history validation, dispatch or network writes. */
export function preparePQNativeActionTransportData(snapshot:PQAuthorizationSnapshot,input:PQActionTransportInput):Readonly<{
  action:PQNativeAction;
  body:Uint8Array;
  chainId:string;
  owner:string;
  keyVersion:string;
  executionHeight:string;
  purpose:string;
  memberCount:number;
  memberIndex:number;
  signatureVerified:true;
  dataOnly:true;
  nativeAdmission:false;
  classicWitnessValidationRequired:boolean;
}>;
