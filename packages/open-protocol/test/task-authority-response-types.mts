import*as codec from'../src/task-authority-response.js';
import type{TaskAuthorityRequestInputDATA,TaskAuthorityWholeResponseInputDATA,TaskAuthorityWholeExpectedDATA,TaskAuthorityResponsePayloadDATA}from'../src/task-authority-response.js';
declare const request:TaskAuthorityRequestInputDATA,outer:TaskAuthorityWholeResponseInputDATA,payload:TaskAuthorityResponsePayloadDATA,expected:TaskAuthorityWholeExpectedDATA;
const requestBytes:Uint8Array=codec.encodeTaskAuthorityRequestDATA(request),payloadBytes:Uint8Array=codec.encodeTaskAuthorityResponsePayloadDATA(payload),wholeBytes:Uint8Array=codec.encodeTaskAuthorityWholeResponseDATA(outer,expected.maxResponseBytes),d=codec.assertTaskAuthorityWholeResponseBindingDATA(wholeBytes,expected),noSig:false=d.signatureVerified,noSource:false=d.SourceAdmission,noNative:false=d.NativeAdmission;void[requestBytes,payloadBytes,noSig,noSource,noNative];
// @ts-expect-error Method is actual signed registered POST, never derived GET.
const transport:typeof payload.transport={...payload.transport,method:'GET'};void transport;
// @ts-expect-error Full registered subject is required, not a LegacyID.
codec.encodeTaskAuthorityFullRefDATA({id:'legacy'});
// @ts-expect-error Caller narrowing cannot be an approved flag.
codec.assertTaskAuthorityWholeResponseBindingDATA(wholeBytes,{approved:true});
// @ts-expect-error No DATA flag is proof of current signature authority.
const verified:true=d.signatureVerified;void verified;

// @ts-expect-error Registered operation max is required, not silently enlarged.
codec.decodeTaskAuthorityWholeResponseDATA(wholeBytes);
