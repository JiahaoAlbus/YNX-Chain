package com.ynxweb4.wallet;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.Looper;
import java.lang.ref.WeakReference;

/** Owns at most one dialog for the in-process original review actor. */
final class DeviceApprovalReviewCoordinator {
    private DeviceApprovalReviewDialog active;
    private final Application app;
    private final DeviceApprovalReviewLifetime lifetime = new DeviceApprovalReviewLifetime();
    private WeakReference<Activity> activity = new WeakReference<>(null);
    private boolean listening;
    private final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
        public void onActivityCreated(Activity target, Bundle state) { }
        public void onActivityStarted(Activity target) { }
        public void onActivityResumed(Activity target) { }
        public void onActivityPaused(Activity target) { if (target == activity.get()) cancel(); }
        public void onActivityStopped(Activity target) { }
        public void onActivitySaveInstanceState(Activity target, Bundle state) { }
        public void onActivityDestroyed(Activity target) { if (target == activity.get()) cancel(); }
    };

    DeviceApprovalReviewCoordinator(Application app) { this.app = java.util.Objects.requireNonNull(app); }

    void open(Activity activity, DeviceApprovalReview.Original original) {
        requireMainThread();
        if (active != null || lifetime.retained()) throw new IllegalStateException("A device review is still retained");
        DeviceApprovalReview review = new DeviceApprovalReview(original);
        DeviceApprovalReviewDialog dialog = new DeviceApprovalReviewDialog(activity, review,
            () -> { active = null; lifetime.dialogFinished(review.state()); stopIfReleased(); });
        lifetime.hold(original);
        this.activity = new WeakReference<>(activity);
        try { app.registerActivityLifecycleCallbacks(lifecycle); listening = true; }
        catch (RuntimeException error) {
            lifetime.revoke();
            lifetime.dialogFinished(DeviceApprovalReview.State.CANCELLED);
            this.activity.clear();
            throw error;
        }
        active = dialog;
        try { dialog.show(); } catch (RuntimeException error) { dialog.close(); throw error; }
    }

    void cancel() {
        requireMainThread();
        try { lifetime.revoke(); }
        finally { if (active != null) active.close(); }
    }

    // Same original actor calls only after its operation has actually resolved.
    void releaseResolved(DeviceApprovalReview.Original original) {
        requireMainThread();
        if (active != null) throw new IllegalStateException("Device review is still visible");
        lifetime.releaseResolved(original);
        stopIfReleased();
    }

    private void stopIfReleased() {
        if (!lifetime.retained() && listening) {
            listening = false;
            app.unregisterActivityLifecycleCallbacks(lifecycle);
            activity.clear();
        }
    }

    private static void requireMainThread() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            throw new IllegalStateException("Device review requires the main thread");
        }
    }
}
