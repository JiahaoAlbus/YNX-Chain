import{encodeSocialDirectoryClosedAckDATA,encodeSocialDirectoryReadReleaseDATA,createSocialDirectoryReadReleaseLedgerDATA}from'../../native/social-directory-lc-v1/codec.mjs';
const b={requestOriginalSHA256:'0'.repeat(64),rootResponseOriginalSHA256:'1'.repeat(64)};encodeSocialDirectoryClosedAckDATA(b,{closed:true,errorPresent:true,errorKind:'code',errorCode:0});
// @ts-expect-error no absent nonzero error
encodeSocialDirectoryClosedAckDATA(b,{closed:true,errorPresent:false,errorKind:'none',errorCode:2});
// @ts-expect-error retained error has no actual numeric code
encodeSocialDirectoryClosedAckDATA(b,{closed:true,errorPresent:true,errorKind:'retained',errorCode:2});
// @ts-expect-error explicit closed is independent required field
encodeSocialDirectoryClosedAckDATA(b,{errorPresent:false,errorKind:'none',errorCode:0});
// @ts-expect-error raw branded object cannot replace original bytes
createSocialDirectoryReadReleaseLedgerDATA({},new Uint8Array([1]),'0'.repeat(64));
const s=createSocialDirectoryReadReleaseLedgerDATA(new Uint8Array([1]),new Uint8Array([2]),'0'.repeat(64)).statusDATA();
// @ts-expect-error notification cannot grant Source
const grant:true=s.SourceAdmission;void grant;encodeSocialDirectoryReadReleaseDATA(b);
