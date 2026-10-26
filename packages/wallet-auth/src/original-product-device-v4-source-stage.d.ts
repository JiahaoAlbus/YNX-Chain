import type {OriginalProductSessionDeviceCurrentSourceV4,OriginalProductSessionDeviceCurrentV4,ProductSessionDeviceAbortContextV4,ProductSessionDeviceNativeContextV4} from './product-session-device-v4.js';
declare const originalDeviceSourceStage:unique symbol;
/** Original Native owner consumer. No device slot, HTTP producer or admission. */
export interface OriginalProductSessionDeviceSourceStageV4 extends OriginalProductSessionDeviceCurrentSourceV4 {
 readonly [originalDeviceSourceStage]:never;
 assertCurrent():undefined;
 assertCurrent(held:OriginalProductSessionDeviceCurrentV4,abortContext:ProductSessionDeviceAbortContextV4):undefined;
 readContext():ProductSessionDeviceNativeContextV4;
 retire():undefined;join():undefined;close():undefined;
 status():Readonly<{retired:boolean;closed:boolean;closeSelected:boolean;dataOnly:true;nativeAdmission:false;sourceAdmission:false}>;
}
/** Zero input fixed implementing image. Original Native errors/.partial are
 * unchanged; caller adopts and drains partial ownership before returning. */
export function acquireOriginalProductSessionDeviceV4SourceStage():OriginalProductSessionDeviceSourceStageV4;

declare const originalDeviceReadLeaseStage:unique symbol;
/** Closed projections of one actual original Native source/producer owner.
 * This type does not establish Source/profile/slot authorization or issuance. */
export interface OriginalProductSessionDeviceReadLeaseStageV4 {
 readonly [originalDeviceReadLeaseStage]:never;
 readonly device:import('./product-session-device-v4.js').ProductSessionDevicePortsV4;
 readonly deviceCurrent:OriginalProductSessionDeviceCurrentSourceV4;
 retire():undefined;join():undefined;close():undefined;
 status():Readonly<{retired:boolean;closed:boolean;closeSelected:boolean;dataOnly:true;nativeAdmission:false;sourceAdmission:false}>;
}
/** Zero caller inputs. Native operation and error/.partial objects are unchanged.
 * The original caller owns AbortController cancellation before draining this
 * lease; original proof operations must close before the parent can close. */
export function acquireOriginalProductSessionDeviceV4ReadLeaseStage():OriginalProductSessionDeviceReadLeaseStageV4;
