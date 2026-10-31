import*as v5 from'../src/product-session-proof-v5.js';
import type{ProductSessionHTTPProofV4Unsigned}from'../src/product-session-proof-v4.js';
declare const unsigned:v5.ProductSessionHTTPProofV5Unsigned,expected:v5.ProductSessionHTTPProofV5Expected,member:Uint8Array,old:ProductSessionHTTPProofV4Unsigned;
const body=v5.createProductSessionHTTPBodyV5DATA(new Uint8Array([1]),'multipart/form-data; boundary=PUBLIC'),noSource:false=body.SourceAdmission;
const data=v5.assertProductSessionHTTPBodyV5DATA(new Uint8Array([1]),body.contentType,unsigned),wire:Uint8Array=v5.encodeProductSessionHTTPProofV5Message(unsigned,expected.networkId),header:string=v5.encodeProductSessionProofHeaderV5(unsigned,member),parsed=v5.decodeProductSessionProofHeaderV5(header),inspection=v5.inspectProductSessionHTTPProofV5Data(member,expected),headerInspection=v5.inspectProductSessionHTTPProofHeaderV5Data(header,expected),name:'x-ynx-product-session-proof-v5'=v5.PRODUCT_SESSION_PROOF_HEADER_V5,version:'5'=parsed.version,verified:true=inspection.signatureVerified,authorized:false=headerInspection.authorized;void[data,wire,version,verified,authorized,noSource,name];
// @ts-expect-error V4 cannot be promoted to V5.
v5.encodeProductSessionHTTPProofV5Message(old,expected.networkId);
// @ts-expect-error V5 only explicitly bound POST route.
const badMethod:v5.ProductSessionHTTPProofV5Unsigned={...unsigned,method:'GET'};void badMethod;
// @ts-expect-error Byte builder must have actual bytes, not self-reported hashes.
v5.createProductSessionHTTPBodyV5DATA({bodyDigest:'00'},body.contentType);
// @ts-expect-error Independent pair/network/request must all be present.
v5.inspectProductSessionHTTPProofV5Data(member,{unsigned});
// @ts-expect-error Math result is never current Source authority.
const current:true=inspection.current;void current;
