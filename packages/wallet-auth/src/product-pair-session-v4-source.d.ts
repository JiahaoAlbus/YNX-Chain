import type{OriginalProductSessionDeviceCurrentSourceV4}from'./product-session-device-v4.js';
declare const serverCurrentOwner:unique symbol;
export interface OriginalProductSessionDeviceV4ServerCurrentOwner {
 readonly[serverCurrentOwner]:never;readonly deviceCurrent:OriginalProductSessionDeviceCurrentSourceV4;
 retire():void;join():Promise<void>;close():Promise<void>;drainPartial():Promise<void>;status():Readonly<{retired:boolean;pending:number;held:number;unknown:boolean;firstCausePresent:boolean;firstCause:unknown}>;
}
export interface OriginalProductPairSessionV4PartialOwner {retire():void;join():void|Promise<void>;close():void|Promise<void>;drainPartial?():Promise<void>}
export interface OriginalProductPairSessionV4IssuerOwner extends OriginalProductPairSessionV4PartialOwner {pair(original:string):Promise<unknown>;complete(original:string):Promise<unknown>;challenge(original:string):Promise<unknown>;revoke(original:string):Promise<unknown>;cancel(original:string):Promise<unknown>;active(original:string):Promise<unknown>;recover(original:string):Promise<unknown>}
export function acquireOriginalProductSessionDeviceV4ServerCurrent():Promise<Readonly<{owner:OriginalProductSessionDeviceV4ServerCurrentOwner|OriginalProductPairSessionV4PartialOwner;deviceCurrent:OriginalProductSessionDeviceCurrentSourceV4|null;error:unknown}>>;
export function assertOriginalProductSessionDeviceV4ServerCurrentOwner(owner:unknown):OriginalProductSessionDeviceV4ServerCurrentOwner;
/** First adopt any non-null owner; only an own error:null plus exact private owner/provider is success. */
export function assertOriginalProductSessionDeviceV4ServerCurrentResult(outcome:unknown):OriginalProductSessionDeviceV4ServerCurrentOwner;
/** Existing original issuer callee retained unchanged; no caller configuration. */
export function acquireOriginalProductPairSessionV4Issuer():Promise<Readonly<{owner:OriginalProductPairSessionV4IssuerOwner|OriginalProductPairSessionV4PartialOwner;error:unknown}>>;
export function assertOriginalProductPairIssuerOwnerV4(owner:unknown):OriginalProductPairSessionV4IssuerOwner;
