import type {OriginalAuthSourceV2Service,OriginalAuthSourceV2Operations} from '@ynx-chain/wallet-auth/auth-source-verification';
const service:OriginalAuthSourceV2Service='ide-publication-approval-authority-v1';
const operations:OriginalAuthSourceV2Operations=['approval.capture','approval.current','approval.revoke'];
// @ts-expect-error Existing purposes cannot mix publication and control operations.
const mixed:OriginalAuthSourceV2Operations=['approval.capture','RecheckProjectControl'];
void service;void operations;void mixed;
