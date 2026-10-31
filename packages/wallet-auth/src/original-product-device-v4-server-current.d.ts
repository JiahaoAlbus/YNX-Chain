import type {ProductSessionDeviceCurrentExpectedV4,ProductSessionDeviceAbortContextV4,OriginalProductSessionDeviceCurrentV4,OriginalProductSessionDeviceCurrentSourceV4}from'./product-session-device-v4.js';
/** PUBLIC lifecycle controls only. Not an original server owner or Source selector. */
export class OriginalProductSessionDeviceV4ServerCurrentKernel implements OriginalProductSessionDeviceCurrentSourceV4 {
 constructor(registry:unknown,store:unknown,source:unknown,clock?:()=>number,elapsed?:()=>number);
 readCurrent(expected:ProductSessionDeviceCurrentExpectedV4,context:ProductSessionDeviceAbortContextV4):Promise<OriginalProductSessionDeviceCurrentV4>;
 assertCurrent(held:OriginalProductSessionDeviceCurrentV4,sameContext:ProductSessionDeviceAbortContextV4):Promise<undefined>;
 readRegistrationOriginal(held:OriginalProductSessionDeviceCurrentV4):Uint8Array;
 readSessionOriginal(held:OriginalProductSessionDeviceCurrentV4):string;
 retire():void;join():Promise<void>;close():Promise<void>;drainPartial():Promise<void>;status():Readonly<{retired:boolean;pending:number;held:number;unknown:boolean;firstCausePresent:boolean;firstCause:unknown}>;
}
