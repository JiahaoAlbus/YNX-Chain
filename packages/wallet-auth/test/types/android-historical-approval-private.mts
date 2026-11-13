import type { OriginalPendingCollectorWithCreationIdentityDATA } from '../../native/original-device-pending-source-v2-private-factory.mjs';

declare const collect: OriginalPendingCollectorWithCreationIdentityDATA;
declare const original: string;
const view = collect.inspectOriginalProductSessionV4ApprovalDATA(original);
const requestDigest: string = view.requestDigest;
const approvalDigest: string = view.approvalDigest;
const verified: true = view.signatureVerified;
const current: false = view.current;
void [requestDigest, approvalDigest, verified, current];

// @ts-expect-error Only one primitive canonical original is accepted.
collect.inspectOriginalProductSessionV4ApprovalDATA({ original });
// @ts-expect-error A policyRef is outside the historical DATA ABI.
collect.inspectOriginalProductSessionV4ApprovalDATA(original, null);
