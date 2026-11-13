// Node facade keeps strict original Proxy/accessor guards. The one generating
// body lives in the Node-free canonical-string core used by the private VM.
import {types} from 'node:util';
import {canonicalJSON} from './canonical.js';
import {createOriginalDeviceRegistrationPublicOriginalsCanonicalDATA} from './original-device-registration-public-originals-core.mjs';
const fail=()=>{throw Object.assign(Error('DEVICE_REGISTRATION_PUBLIC_ORIGINALS_DATA_INVALID'),{code:'DEVICE_REGISTRATION_PUBLIC_ORIGINALS_DATA_INVALID'});};
function own(v,keys){
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string')||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
export function createOriginalDeviceRegistrationPublicOriginalsDATA(input){
 const v=own(input,['creationIntentOriginal','publicPair','allocationOriginal']),pair=own(v.publicPair,['pkA','pkB']);
 if([v.creationIntentOriginal,v.allocationOriginal,pair.pkA,pair.pkB].some(x=>typeof x!=='string'))fail();
 return createOriginalDeviceRegistrationPublicOriginalsCanonicalDATA(canonicalJSON({...v,publicPair:pair}));
}
