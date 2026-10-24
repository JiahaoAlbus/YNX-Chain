import type {OriginalAuthSourceV2Service,OriginalAuthSourceV2Operations,OriginalAuthSourceV2CurrentData} from '@ynx-chain/wallet-auth/auth-source-verification';
const service:OriginalAuthSourceV2Service='ide-project-control-authority-v1';
const operations:OriginalAuthSourceV2Operations=['CaptureProjectControl','RecheckProjectControl'];
// @ts-expect-error Capture/recheck is a fixed ordered tuple, not a general permission set.
const wrong:OriginalAuthSourceV2Operations=['RecheckProjectControl','CaptureProjectControl'];
declare const data:OriginalAuthSourceV2CurrentData;
const admission:false=data.nativeAdmission;
void service;void operations;void wrong;void admission;
