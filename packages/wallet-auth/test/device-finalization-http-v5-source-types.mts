import type{OriginalAuthSourceV2Service,OriginalAuthSourceV2Operations}from'../native/original-auth-identity-source-v2-verifier.mjs';
import{acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource}from'../src/original-product-device-v4-registered-finalization.js';
const p:OriginalAuthSourceV2Service='product-session-device-registered-finalization-source-v4';const q:OriginalAuthSourceV2Service='product-session-device-http-binary-source-v5';
const a:OriginalAuthSourceV2Operations=['device.registered-finalize'];const b:OriginalAuthSourceV2Operations=['device.current','device.http-proof-v5'];void p;void q;void a;void b;
const opened=acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource();const owner=opened.owner;if(opened.error!==null)throw opened.error;if(owner){const r=owner.readOriginalReviewDATA();const no:false=r.SourceAdmission;void no;await owner.close();}
// @ts-expect-error no caller registered or key/path installer
acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource({registered:true});
// @ts-expect-error independent purposes cannot mix old/new proof actions
const forbidden:OriginalAuthSourceV2Operations=['device.current','device.http-proof','device.http-proof-v5'];
