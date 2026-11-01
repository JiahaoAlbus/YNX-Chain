import type {OriginalProductSessionDeviceCurrentSourceV4} from '../src/product-session-device-v4.js';
/** Private startup custody reference, not Source/Root/Principal or a grant. */
declare const startupReference:unique symbol;
export type OriginalDeviceV4ServerCurrentStartup=Readonly<{[startupReference]:never}>;
/** Fixed original zero-input provider acquisition. No caller Root/provider. */
export declare function openOriginalDeviceV4ServerCurrentBeforeHost():Promise<OriginalDeviceV4ServerCurrentStartup>;
/** DATA options only; absent admission/closing yields no provider. */
export declare function originalDeviceV4ServerCurrentHostOptions(reference:OriginalDeviceV4ServerCurrentStartup):Readonly<{deviceCurrent?:OriginalProductSessionDeviceCurrentSourceV4}>;
export declare function originalDeviceV4ServerCurrentStartupStatus(reference:OriginalDeviceV4ServerCurrentStartup):Readonly<{
 configured:boolean;failurePresent:boolean;failure:unknown;closeSelected:boolean;
 closed:boolean;cleanupFailurePresent:boolean;cleanupFailure:unknown;unknown:boolean;
}>;
/** Retains same original close promise; pending join blocks close/parents. */
export declare function closeOriginalDeviceV4ServerCurrentAfterHost(reference:OriginalDeviceV4ServerCurrentStartup):Promise<void>;
/** Explicit same-original debt continuation, never new acquire or effect. */
export declare function drainOriginalDeviceV4ServerCurrentPartial(reference:OriginalDeviceV4ServerCurrentStartup):Promise<void>;
