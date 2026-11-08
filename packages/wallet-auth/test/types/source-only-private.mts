import factory from'../../native/original-device-source-v2-private-factory.mjs';
import type{FixedSourceNativeObject,FixedSourceStatementRequest16DATA}from'../../native/original-auth-source-v2-fixed-core-gates.mjs';
import type{DeviceSourceTypedProjectionDATA}from'../../native/original-device-source-v2-typed-projection.mjs';
declare const native:FixedSourceNativeObject;const collect=factory(native);const result=collect('private canonical capture');const f:false=result.SourceAdmission;
function use(t:DeviceSourceTypedProjectionDATA){if(t.kind===1){const d:string=t.value.deviceGeneration;const s:string=t.value.sourceGeneration;const owner:string=t.value.canonicalOwner;const n:null=t.namespace;}if(t.kind===2){const a:ArrayBuffer=t.value.pkA;const n:string=t.namespace.issuer;}if(t.kind===3){const owner:string=t.value.canonicalOwner;const s:string=t.value.sourceGeneration;
// @ts-expect-error query has no deviceGeneration
 const forbidden=t.value.deviceGeneration;}}
// @ts-expect-error no provider/callback request option
collect('{}',()=>true);
// @ts-expect-error no module name/Source setter argument
factory(native,{Root:true});
declare const r:FixedSourceStatementRequest16DATA;
// @ts-expect-error historical requires explicit sole E8 ArrayBuffer
native.verifyRegisteredSourceCurrentN1V1(r);
