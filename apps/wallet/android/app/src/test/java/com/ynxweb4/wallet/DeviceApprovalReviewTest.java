package com.ynxweb4.wallet;

import junit.framework.TestCase;

public final class DeviceApprovalReviewTest extends TestCase {
    private static final class Original implements DeviceApprovalReview.Original {
        boolean current = true, failConfirm, failReject;
        String account = "account A";
        int confirmations, rejections;
        public String peer() { return "verified app"; }
        public String account() { return account; }
        public String network() { return "network A"; }
        public String requestDigest() { return "original digest"; }
        public long expiresAtMillis() { return 200; }
        public boolean current() { return current; }
        public void confirmOnce() { confirmations++; if (failConfirm) throw new IllegalStateException(); }
        public void reject() { rejections++; if (failReject) throw new IllegalStateException(); }
    }

    public void testConfirmOnceAndUnknownNeverRetry() {
        Original original = new Original(); original.failConfirm = true;
        DeviceApprovalReview review = new DeviceApprovalReview(original);
        assertEquals(DeviceApprovalReview.State.UNAVAILABLE, review.confirm(100));
        assertEquals(DeviceApprovalReview.State.UNAVAILABLE, review.confirm(101));
        assertEquals(1, original.confirmations);
        assertEquals(0, original.rejections);
    }
    public void testCurrentIsRequiredAtDecision() {
        Original original = new Original();
        DeviceApprovalReview review = new DeviceApprovalReview(original);
        original.current = false;
        assertEquals(DeviceApprovalReview.State.UNAVAILABLE, review.confirm(100));
        assertEquals(0, original.confirmations);
    }
    public void testChangedAccountCannotConfirm() {
        Original original = new Original();
        DeviceApprovalReview review = new DeviceApprovalReview(original);
        original.account = "account B";
        assertEquals(DeviceApprovalReview.State.UNAVAILABLE, review.confirm(100));
        assertEquals(0, original.confirmations);
    }
    public void testExpiryCancelAndRejectDoNotConfirm() {
        Original original = new Original();
        DeviceApprovalReview expired = new DeviceApprovalReview(original);
        assertEquals(DeviceApprovalReview.State.EXPIRED, expired.confirm(200));
        DeviceApprovalReview cancelled = new DeviceApprovalReview(original);
        assertEquals(DeviceApprovalReview.State.CANCELLED, cancelled.cancel());
        assertEquals(DeviceApprovalReview.State.CANCELLED, cancelled.confirm(100));
        DeviceApprovalReview rejected = new DeviceApprovalReview(original);
        assertEquals(DeviceApprovalReview.State.REJECTED, rejected.reject(100));
        assertEquals(DeviceApprovalReview.State.REJECTED, rejected.confirm(100));
        assertEquals(0, original.confirmations);
        assertEquals(1, original.rejections);
    }
    public void testRejectionFailureDoesNotPretendSuccessOrRetry() {
        Original original = new Original(); original.failReject = true;
        DeviceApprovalReview review = new DeviceApprovalReview(original);
        assertEquals(DeviceApprovalReview.State.UNAVAILABLE, review.reject(100));
        assertEquals(DeviceApprovalReview.State.UNAVAILABLE, review.reject(100));
        assertEquals(1, original.rejections);
    }
}
