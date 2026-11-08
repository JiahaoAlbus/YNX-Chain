import{PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PENDING_OPERATIONS,type OriginalPendingDeviceScope8DATA}from'../../native/original-product-device-v4-pending-scope-data-core.mjs';
import{createOriginalPendingDeviceSourceV2PrivateKernel}from'../../native/original-auth-source-v2-pending-private.mjs';
import type{FixedSourceNativeObject}from'../../native/original-auth-source-v2-fixed-core-gates.mjs';
const purpose:'product-session-device-pending-source-v4'=PRODUCT_DEVICE_V4_PENDING_PURPOSE;
const ops:readonly['device.registration-pop','device.challenge-completion']=PRODUCT_DEVICE_V4_PENDING_OPERATIONS;
declare const scope:OriginalPendingDeviceScope8DATA;
if(scope.operation==='registration-pop'){const empty:null=scope.challengeOriginal;void empty;}
if(scope.operation==='challenge-completion'){const original:string=scope.challengeOriginal;void original;}
// @ts-expect-error DATA scope is not the fixed private native math object.
createOriginalPendingDeviceSourceV2PrivateKernel(scope);
declare const native:FixedSourceNativeObject;
createOriginalPendingDeviceSourceV2PrivateKernel(native);
void purpose;void ops;
import pendingFactory from'../../native/original-device-pending-source-v2-private-factory.mjs';
const collect=pendingFactory(native),result=collect('canonical opaque Native capture');
const kindCandidate:4=result.typedProjection.kind;
const pairA:ArrayBuffer=result.typedProjection.value.pkA;
const noSource:false=result.SourceAdmission;
// @ts-expect-error Pending Source data cannot become original creation kind1.
const notCreation:1=result.typedProjection.kind;
// @ts-expect-error Scope.expected device generation is not implicit Source generation numeric data.
const noNumber:number=result.typedProjection.value.sourceGeneration;
void kindCandidate;void pairA;void noSource;
// @ts-expect-error Original expected16 callback cannot be null.
const callbackNull:typeof scope.expected={...scope.expected,callback:null};
// @ts-expect-error Original expected16 origin cannot be null.
const originNull:typeof scope.expected={...scope.expected,origin:null};
const noComparison:null=result.typedProjection.accountComparisonDATA;
void noComparison;
