import{captureOriginalWalletProductSourceV2}from'../native/original-auth-source-v2-dispatch.mjs';
import{decodeWPRRegistrationCaptureOriginalDATA,encodeWPRRegistrationCaptureOriginalDATA,type WPRSourceInputDATA,type WPRIndependentExpectedContextDATA}from'../native/original-wallet-product-registration-capture.mjs';
declare const input:WPRSourceInputDATA,expected:WPRIndependentExpectedContextDATA;
const capture=await captureOriginalWalletProductSourceV2(input);const bytes=encodeWPRRegistrationCaptureOriginalDATA(capture);const views=decodeWPRRegistrationCaptureOriginalDATA(bytes,input,expected,capture.currentRaw);const noGrant:false=views.nativeAdmission;void noGrant;
// @ts-expect-error readonly capture is immutable DATA
capture.registrationCapture.nonce='other';
// @ts-expect-error cannot reparse without independent original expected input/context/currentOriginal
const shortcut=decodeWPRRegistrationCaptureOriginalDATA(bytes);void shortcut;
// @ts-expect-error WPR source DATA cannot claim Native admission
const native:true=views.nativeAdmission;void native;
