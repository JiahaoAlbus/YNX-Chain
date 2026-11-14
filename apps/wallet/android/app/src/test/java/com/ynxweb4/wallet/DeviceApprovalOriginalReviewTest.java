package com.ynxweb4.wallet;

import junit.framework.TestCase;

public final class DeviceApprovalOriginalReviewTest extends TestCase {
    private static final class Scope implements DeviceApprovalOriginalReview.Scope {
        boolean live = true, loseAck, closed, closeFailure; int revokeAtCheck;
        int confirms, rejects, checks;
        public boolean current() { if (++checks == revokeAtCheck) live=false; return live; }
        public void confirmed(DeviceApprovalOriginalReview review) { confirms++; if (loseAck) throw new IllegalStateException(); }
        public void rejected(DeviceApprovalOriginalReview review) { rejects++; }
        public boolean physicallyClosed() { if (closeFailure) throw new IllegalStateException(); return closed; }
    }
    private static final class Journal implements DeviceApprovalOriginalReview.SnapshotReader {
        int reads; byte[][] row;
        public byte[][] read(String operation, byte[] binding) {
            assertEquals("operation-A",operation); assertEquals(1,binding[0]); assertEquals(2,binding[1]);
            reads++; return row;
        }
    }
    private DeviceApprovalOriginalReview make(Scope scope, Journal journal) {
        return new DeviceApprovalOriginalReview(scope, journal, "operation-A", new byte[]{1,2},
            "peer", "account", "network", "digest", System.currentTimeMillis() + 60000);
    }
    public void testConfirmedExactClaimOnlyAndNoWrites() {
        Scope scope = new Scope(); Journal journal = new Journal();
        journal.row = new byte[][]{null,null,null,null,null,null,new byte[]{1}};
        DeviceApprovalOriginalReview review = make(scope,journal);
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        assertEquals(0,journal.reads);
        review.confirmOnce();
        assertFalse(review.current()); // UI undecided-current is not pre-sign authority.
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        review.acknowledgeInsertedClaim();
        assertFalse(review.originalClaimCurrent("operation-B",new byte[]{1,2}));
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{9}));
        assertEquals(0,journal.reads);
        assertTrue(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        assertEquals(1,journal.reads); assertEquals(1,scope.confirms);
        journal.row[1] = new byte[]{4}; // A retained Member may still be verified by the same actor.
        assertTrue(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        try { review.acknowledgeInsertedClaim(); fail(); } catch (IllegalStateException expected) { }
    }
    public void testMissingClaimAndRevocationFailClosed() {
        Scope scope = new Scope(); Journal journal = new Journal();
        DeviceApprovalOriginalReview review = make(scope,journal);
        review.confirmOnce();
        review.acknowledgeInsertedClaim();
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        journal.row = new byte[][]{null,null,null,null,null,null,new byte[]{0}};
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        journal.row[6][0]=1; scope.live=false;
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        scope.live=true; review.revoke();
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
    }
    public void testCancelledAndLostAcknowledgementNeverConfirmAgain() {
        Scope scope = new Scope(); Journal journal = new Journal();
        DeviceApprovalOriginalReview cancelled = make(scope,journal);
        cancelled.cancel();
        try { cancelled.confirmOnce(); fail(); } catch (IllegalStateException expected) { }
        assertEquals(0,scope.confirms);
        scope.loseAck=true; DeviceApprovalOriginalReview unknown=make(scope,journal);
        try { unknown.confirmOnce(); fail(); } catch (IllegalStateException expected) { }
        try { unknown.confirmOnce(); fail(); } catch (IllegalStateException expected) { }
        assertEquals(1,scope.confirms);
    }
    public void testRevocationDuringReadCannotAuthorize() {
        Scope scope = new Scope(); Journal journal = new Journal();
        journal.row = new byte[][]{null,null,null,null,null,null,new byte[]{1}};
        DeviceApprovalOriginalReview review = make(scope,journal);
        review.confirmOnce();
        review.acknowledgeInsertedClaim();
        scope.revokeAtCheck = scope.checks + 2;
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        assertEquals(1,journal.reads);
    }
    public void testPersistedClaimWithoutOriginalAckIsNotAuthorization() {
        Scope scope = new Scope(); Journal journal = new Journal();
        journal.row = new byte[][]{null,null,null,null,null,null,new byte[]{1}};
        DeviceApprovalOriginalReview review = make(scope,journal);
        review.confirmOnce();
        // A later read can observe claim=1 after a lost ACK, but cannot grant it.
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        assertEquals(0,journal.reads);
        review.revoke();
        try { review.acknowledgeInsertedClaim(); fail(); } catch (IllegalStateException expected) { }
        assertFalse(review.originalClaimCurrent("operation-A",new byte[]{1,2}));
        assertEquals(1,scope.confirms);
    }
    public void testCleanupMustBeObservedFromSameScope() {
        Scope scope = new Scope(); DeviceApprovalOriginalReview review = make(scope,new Journal());
        assertFalse(review.canReleaseResolved());
        scope.closeFailure=true; assertFalse(review.canReleaseResolved());
        scope.closeFailure=false; scope.closed=true; assertTrue(review.canReleaseResolved());
    }
}
