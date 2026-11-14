package com.ynxweb4.wallet;

import android.app.Activity;
import android.os.Looper;

/** Owns at most one dialog for the in-process original review actor. */
final class DeviceApprovalReviewCoordinator {
    private DeviceApprovalReviewDialog active;

    void open(Activity activity, DeviceApprovalReview.Original original) {
        requireMainThread();
        if (active != null) throw new IllegalStateException("A device review is already open");
        DeviceApprovalReview review = new DeviceApprovalReview(original);
        DeviceApprovalReviewDialog dialog = new DeviceApprovalReviewDialog(activity, review,
            () -> active = null);
        active = dialog;
        try { dialog.show(); } catch (RuntimeException error) { dialog.close(); throw error; }
    }

    void cancel() {
        requireMainThread();
        if (active != null) active.close();
    }

    private static void requireMainThread() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            throw new IllegalStateException("Device review requires the main thread");
        }
    }
}
