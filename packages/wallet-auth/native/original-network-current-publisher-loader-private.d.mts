import type{OriginalNetworkResourceCurrentPublisherReferenceV1}from'./original-network-current-publisher-reference-private.mjs';
export interface OriginalNetworkCurrentPublisherOwnerV1 {publishOnce():Promise<unknown>;querySameOriginal():Promise<unknown>;drain():Promise<unknown>;status():unknown}
export interface OriginalNetworkCurrentPublisherAcquisitionInventoryV1 {readonly publisherReference:OriginalNetworkResourceCurrentPublisherReferenceV1|null;readonly keyOwner:Readonly<{retire():void;join():void;close():void}>|null}
export type OriginalNetworkCurrentPublisherAcquisitionV1=Readonly<{errorPresent:false;error:null;owner:OriginalNetworkCurrentPublisherOwnerV1;RootAdmission:false}>|Readonly<{errorPresent:true;error:unknown;owner:OriginalNetworkCurrentPublisherAcquisitionInventoryV1|OriginalNetworkCurrentPublisherOwnerV1|null;RootAdmission:false}>;
/** Explicit errorPresent, including thrown null/undefined/false/0, discriminates all acquisition failures. Never test error truthiness. */
export function acquireOriginalNetworkResourceCurrentPublisherNormalV1():Promise<OriginalNetworkCurrentPublisherAcquisitionV1>;
