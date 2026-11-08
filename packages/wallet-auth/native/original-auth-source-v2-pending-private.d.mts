import type{FixedSourceNativeObject}from'./original-auth-source-v2-fixed-core-gates.mjs';
/** Internal fixed pending-only compile composition, never App Source or public provider. */
export function createOriginalPendingDeviceSourceV2PrivateKernel(nativeObject:FixedSourceNativeObject):Readonly<{
 sourcePolicy(policy:unknown):unknown;
 verifyEnrollment(rootOriginal:string,enrollmentOriginal:string,policy:unknown,registrations:unknown,atMs:number):unknown;
 verifyProfile(rootOriginal:string,enrollmentOriginal:string,profileOriginal:string,policy:unknown,registrations:unknown,atMs:number):unknown;
 verifyCurrent(rootOriginal:string,enrollmentOriginal:string,profileOriginal:string,currentOriginal:string,policy:unknown,registrations:unknown,nonce:string,previous:unknown,atMs:number,historical?:boolean):unknown;
}>;
