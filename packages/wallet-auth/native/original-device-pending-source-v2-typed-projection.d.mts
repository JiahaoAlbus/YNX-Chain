import type{OriginalPendingDeviceScope8DATA}from'./original-product-device-v4-pending-scope-data-core.mjs';
import type{SourceProjectionFalseFlags}from'./original-device-source-v2-typed-projection.mjs';
/** Independent capture kind4 confirmed by Auth/P02, not operation enum1/2. */
export interface PendingDeviceSourceTypedProjectionDATA extends SourceProjectionFalseFlags{
 readonly kind:4;
 readonly value:Readonly<{scope:OriginalPendingDeviceScope8DATA;sourceId:string;instanceId:string;/** Source profile generation, not scope.expected.generation */sourceGeneration:string;pkA:ArrayBuffer;pkB:ArrayBuffer}>;
 readonly window:Readonly<{notBeforeMs:number;expiresAtMs:number}>;
 readonly namespace:null;
 readonly accountComparisonDATA:null;
 readonly previousCanonical:string;
}
export function projectVerifiedPendingDeviceSourceCapturedDATA(projection:unknown,enrollmentBody:unknown,profileBody:unknown,currentBody:unknown,afterAtMs:number):Readonly<PendingDeviceSourceTypedProjectionDATA>;
