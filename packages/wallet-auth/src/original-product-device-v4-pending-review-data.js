// Node public facade preserves zero-trap Proxy/accessor and byte guards.
import{types}from'node:util';import{WalletAuthError}from'./canonical.js';
import{inspectOriginalProductDeviceV4PendingReviewDATA as inspect,assertOriginalProductDeviceV4PendingReviewBindingDATA as bind}from'./original-product-device-v4-pending-review-core.js';
export{PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS}from'./original-product-device-v4-pending-review-core.js';
const PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS=Object.freeze(['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest']);
const SCOPE=['version','operation','pendingId','expected','registrationOriginal','requestOriginal','approvalDigest','challengeOriginal'];
const ta=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(ta,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set;

const fail=()=>{throw new WalletAuthError('PENDING_DEVICE_V4_REVIEW_DATA_INVALID','Original pending-device review DATA is invalid');};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function capture(v){if(types.isProxy(v))fail();let n,b;try{n=getLength.call(v);b=getBuffer.call(v);}catch{fail()}if(!(v instanceof Uint8Array)||!n||n>131072||b instanceof SharedArrayBuffer)fail();for(const k of ['buffer','byteLength','length',Symbol.iterator]){const d=Object.getOwnPropertyDescriptor(v,k);if(d&&!Object.hasOwn(d,'value'))fail()}const out=new Uint8Array(n);try{set.call(out,v)}catch{fail()}return out;}
export function inspectOriginalProductDeviceV4PendingReviewDATA(originalBytes){return inspect(capture(originalBytes));}
export function assertOriginalProductDeviceV4PendingReviewBindingDATA(review,expected16){if(!review||types.isProxy(review))fail();return bind(review,exact(expected16,PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS));}
