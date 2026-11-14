package com.ynxweb4.wallet;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Application;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import java.util.Objects;

/** Display only a projection supplied by the same verified in-process actor. */
final class DeviceApprovalReviewDialog {
    private final DeviceApprovalReview review;
    private final AlertDialog dialog;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable expire;
    private final Activity activity;
    private boolean listening, shown;
    private final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
        public void onActivityCreated(Activity target, Bundle state) { }
        public void onActivityStarted(Activity target) { }
        public void onActivityResumed(Activity target) { }
        public void onActivityPaused(Activity target) { if (target == activity) close(); }
        public void onActivityStopped(Activity target) { }
        public void onActivitySaveInstanceState(Activity target, Bundle state) { }
        public void onActivityDestroyed(Activity target) { if (target == activity) close(); }
    };

    DeviceApprovalReviewDialog(Activity activity, DeviceApprovalReview review) {
        this.review = Objects.requireNonNull(review);
        this.activity = Objects.requireNonNull(activity);
        expire = () -> { this.review.expire(System.currentTimeMillis()); close(); };
        if (Looper.myLooper() != Looper.getMainLooper() || activity.isFinishing()
                || activity.isDestroyed()) throw new IllegalStateException("Review activity unavailable");
        String message = "App: " + review.peer() + "\nAccount: " + review.account()
            + "\nNetwork: " + review.network() + "\nRequest: " + review.requestDigest()
            + "\nExpires: " + java.text.DateFormat.getDateTimeInstance().format(
                new java.util.Date(review.expiresAtMillis()));
        dialog = new AlertDialog.Builder(activity).setTitle("Review device request")
            .setMessage(message)
            .setPositiveButton("Confirm", (ignored, which) -> review.confirm(System.currentTimeMillis()))
            .setNegativeButton("Reject", (ignored, which) -> review.reject(System.currentTimeMillis()))
            .setOnCancelListener(ignored -> review.cancel())
            .setOnDismissListener(ignored -> { stopListening(); review.cancel(); })
            .create();
    }

    void show() {
        if (shown || review.state() != DeviceApprovalReview.State.OPEN) {
            throw new IllegalStateException("Original review is no longer available");
        }
        shown = true;
        long remaining = review.expiresAtMillis() - System.currentTimeMillis();
        if (remaining <= 0) { review.expire(System.currentTimeMillis()); return; }
        if (dialog.getWindow() != null) dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        activity.getApplication().registerActivityLifecycleCallbacks(lifecycle);
        listening = true;
        try { dialog.show(); } catch (RuntimeException error) { stopListening(); review.cancel(); throw error; }
        handler.postDelayed(expire, remaining);
    }

    // The original actor calls this on lock, account change, or activity loss.
    void close() {
        stopListening();
        review.cancel();
        dialog.dismiss();
    }

    private void stopListening() {
        handler.removeCallbacks(expire);
        if (listening) {
            listening = false;
            activity.getApplication().unregisterActivityLifecycleCallbacks(lifecycle);
        }
    }
}
