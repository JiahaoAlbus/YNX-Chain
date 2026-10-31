// Test-only module redirect. No production Source installer or provider setter.
export const PUBLICFinalizationNative = {image:null};
export const loadOriginalAuthIdentityNativeImage=()=>PUBLICFinalizationNative.image;
export const PUBLICPreloadAdmission={acquire:null,current:null};
const preloadOwners=new WeakSet();
export const PUBLICOriginalPreloadOwner=methods=>{const owner=Object.freeze(methods);preloadOwners.add(owner);return owner;};
export async function acquireOriginalAuthRuntimeImageAdmissionV1(){
 if(PUBLICPreloadAdmission.acquire)return PUBLICPreloadAdmission.acquire();
 const owner=PUBLICOriginalPreloadOwner({async recheck(){},retire(){},async join(){},async close(){}});
 return Object.freeze({owner,error:null});
}
export function assertOriginalAuthRuntimeImageAdmissionOwnerV1(owner){if(!preloadOwners.has(owner))throw Object.assign(Error('PUBLIC original image owner required'),{code:'PUBLIC_IMAGE_OWNER'});return owner;}
export function assertOriginalAuthRuntimeImagePreLoadCurrentV1(){return PUBLICPreloadAdmission.current?.();}
