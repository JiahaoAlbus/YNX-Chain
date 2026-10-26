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
