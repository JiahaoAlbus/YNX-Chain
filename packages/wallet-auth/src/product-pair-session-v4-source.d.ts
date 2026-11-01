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
declare const pendingQuerySourceOwner:unique symbol;
/** Private zero-input Source selection, never issuer/GET or a public provider. */
export interface OriginalPendingPairQuerySourceOwnerV1 extends OriginalProductPairSessionV4PartialOwner {readonly[pendingQuerySourceOwner]:never;readonly serviceOrigin:string}
/** Adopt owner before error; only own error:null is success. */
export function acquireOriginalPendingPairQuerySourceV1():Promise<Readonly<{owner:OriginalPendingPairQuerySourceOwnerV1|OriginalProductPairSessionV4PartialOwner|null;error:unknown}>>;
export function assertOriginalPendingPairQuerySourceOwnerV1(owner:unknown):OriginalPendingPairQuerySourceOwnerV1;
declare const managementSourceOwner:unique symbol;
export type OriginalManagementSourcePurposeV4='product-session-registered-management-service-v4'|'product-session-completion-query-service-v4';
export interface OriginalManagementSourceOwnerV4 extends OriginalProductPairSessionV4PartialOwner {readonly[managementSourceOwner]:never;readonly purpose:OriginalManagementSourcePurposeV4;readonly operations:readonly string[]}
export function acquireOriginalRegisteredManagementSourceV4():Promise<Readonly<{owner:OriginalManagementSourceOwnerV4|OriginalProductPairSessionV4PartialOwner|null;error:unknown}>>;
export function acquireOriginalCompletionQuerySourceV4():Promise<Readonly<{owner:OriginalManagementSourceOwnerV4|OriginalProductPairSessionV4PartialOwner|null;error:unknown}>>;
export function assertOriginalProductSessionManagementSourceV4(owner:unknown,purpose:OriginalManagementSourcePurposeV4):OriginalManagementSourceOwnerV4;
