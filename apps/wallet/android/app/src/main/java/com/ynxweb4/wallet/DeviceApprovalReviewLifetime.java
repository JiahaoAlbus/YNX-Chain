package com.ynxweb4.wallet;

import java.util.Objects;

/** Retains the original after the dialog closes until its actor resolves it. */
final class DeviceApprovalReviewLifetime {
    private DeviceApprovalReview.Original original;

    void hold(DeviceApprovalReview.Original next) {
        if (original != null) throw new IllegalStateException("Original device review still retained");
        original = Objects.requireNonNull(next);
    }
    void dialogFinished(DeviceApprovalReview.State state) {
        if (state == DeviceApprovalReview.State.CANCELLED || state == DeviceApprovalReview.State.REJECTED
                || state == DeviceApprovalReview.State.EXPIRED) original = null;
        // CONFIRMING and UNAVAILABLE can have effects; never infer completion.
    }
    void revoke() { if (original != null) original.cancel(); }
    boolean retained() { return original != null; }
    void releaseResolved(DeviceApprovalReview.Original expected) {
        if (original == null || original != expected || !original.canReleaseResolved()) {
            throw new IllegalStateException("Original device review cleanup not confirmed");
        }
        original = null;
    }
}
