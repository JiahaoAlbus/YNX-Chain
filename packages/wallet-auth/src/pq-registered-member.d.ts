import type {PQAuthorizationSnapshot} from './pq-wallet-policy.js';
import type {PQPublicBinding} from './pq-wallet-contract.js';
/** Purpose and message bytes come from original Auth's confirmed request
 * contract. This module does not define a new identity or recovery protocol. */
export interface PQRegisteredDataContext {
  readonly chainId:string;readonly owner:string;
  /** Original owner Record.Revision as a canonical U64 decimal string. */
  readonly keyVersion:string;
  /** Exact snapshot's actual observed U64 height, never a JS Number. */
  readonly executionHeight:string;
}
export interface PQRegisteredDataResult extends PQRegisteredDataContext {
  readonly dataOnly:true;readonly nativeAdmission:false;
}
/** Immutable snapshot parsing is not authentication of its origin or finality.
 * Original Auth must acquire/recheck its genuine Source and permissions. */
export function verifyPQRegisteredMemberData(snapshot:PQAuthorizationSnapshot,wire:Uint8Array,expected:PQRegisteredDataContext & Readonly<{purpose:string;message:Uint8Array}>):Readonly<PQRegisteredDataResult & {purpose:string;signatureVerified:true;memberCount:number;memberIndex:number}>;
/** Full active registered pair equality; no key restoration or new authority. */
export function assertPQRegisteredRecoveryBindingData(snapshot:PQAuthorizationSnapshot,binding:PQPublicBinding,expected:PQRegisteredDataContext):Readonly<PQRegisteredDataResult>;
