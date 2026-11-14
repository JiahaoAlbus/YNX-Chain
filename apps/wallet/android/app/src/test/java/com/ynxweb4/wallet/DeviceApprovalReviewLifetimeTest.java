package com.ynxweb4.wallet;

import junit.framework.TestCase;

public final class DeviceApprovalReviewLifetimeTest extends TestCase {
    private static final class Original implements DeviceApprovalReview.Original {
        int cancellations; boolean closed;
        public String peer() { return "peer"; }
        public String account() { return "account"; }
        public String network() { return "network"; }
        public String requestDigest() { return "digest"; }
        public long expiresAtMillis() { return 100; }
        public boolean current() { return true; }
        public void confirmOnce() { }
        public void reject() { }
        public void cancel() { cancellations++; }
        public boolean canReleaseResolved() { return closed; }
    }
    public void testConfirmedOriginalRetainedAcrossBackgroundUntilExactResolution() {
        DeviceApprovalReviewLifetime lifetime = new DeviceApprovalReviewLifetime();
        Original original = new Original(); lifetime.hold(original);
        lifetime.dialogFinished(DeviceApprovalReview.State.CONFIRMING);
        assertTrue(lifetime.retained()); lifetime.revoke(); assertEquals(1,original.cancellations);
        try { lifetime.hold(new Original()); fail(); } catch (IllegalStateException expected) { }
        try { lifetime.releaseResolved(new Original()); fail(); } catch (IllegalStateException expected) { }
        try { lifetime.releaseResolved(original); fail(); } catch (IllegalStateException expected) { }
        assertTrue(lifetime.retained()); original.closed=true;
        lifetime.releaseResolved(original); assertFalse(lifetime.retained());
    }
    public void testUnavailableNeverAssumedResolved() {
        DeviceApprovalReviewLifetime lifetime = new DeviceApprovalReviewLifetime();
        Original original = new Original(); lifetime.hold(original);
        lifetime.dialogFinished(DeviceApprovalReview.State.UNAVAILABLE);
        assertTrue(lifetime.retained()); lifetime.revoke(); assertEquals(1,original.cancellations);
    }
    public void testExplicitCancelRejectAndExpiryRelease() {
        for (DeviceApprovalReview.State state : new DeviceApprovalReview.State[]{
                DeviceApprovalReview.State.CANCELLED, DeviceApprovalReview.State.REJECTED,
                DeviceApprovalReview.State.EXPIRED}) {
            DeviceApprovalReviewLifetime lifetime = new DeviceApprovalReviewLifetime();
            lifetime.hold(new Original()); lifetime.dialogFinished(state); assertFalse(lifetime.retained());
        }
    }
}
