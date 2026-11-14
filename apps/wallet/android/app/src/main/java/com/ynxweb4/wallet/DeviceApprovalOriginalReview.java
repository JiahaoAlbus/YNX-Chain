package com.ynxweb4.wallet;

import java.util.Arrays;
import java.util.Objects;

/** In-process decision bound to one verified actor and its original journal row. */
final class DeviceApprovalOriginalReview implements DeviceApprovalReview.Original {
    /** Implemented by the real verified request/account actor, not an IPC DTO. */
    interface Scope {
        boolean current(); // peer, original request, selected account, revision, policy, foreground
        void confirmed(DeviceApprovalOriginalReview review); // nonblocking; schedules the same native actor
        void rejected(DeviceApprovalOriginalReview review);
        // Same original actor must establish actual physical close and no SDK debt.
        default boolean physicallyClosed() { return false; }
    }
    interface SnapshotReader { byte[][] read(String operation, byte[] binding); }
    enum Decision { UNDECIDED, APPROVED, REJECTED, REVOKED, UNKNOWN }

    private final Scope scope;
    private final SnapshotReader journal;
    private final String operation, peer, account, network, digest;
    private final byte[] binding;
    private final long expiresAt;
    private Decision decision = Decision.UNDECIDED;
    private boolean claimAcknowledged;

    DeviceApprovalOriginalReview(Scope scope, DeviceApprovalJournal journal, String operation,
            byte[] binding, String peer, String account, String network, String digest, long expiresAt) {
        this(scope, Objects.requireNonNull(journal)::readSnapshot, operation, binding,
            peer, account, network, digest, expiresAt);
    }

    // Package-private to allow controlled tests; production uses the journal constructor.
    DeviceApprovalOriginalReview(Scope scope, SnapshotReader journal, String operation,
            byte[] binding, String peer, String account, String network, String digest, long expiresAt) {
        this.scope = Objects.requireNonNull(scope); this.journal = Objects.requireNonNull(journal);
        this.operation = Objects.requireNonNull(operation); this.binding = Objects.requireNonNull(binding).clone();
        this.peer = Objects.requireNonNull(peer); this.account = Objects.requireNonNull(account);
        this.network = Objects.requireNonNull(network); this.digest = Objects.requireNonNull(digest);
        this.expiresAt = expiresAt;
        if (operation.isEmpty() || operation.length() > 128 || binding.length == 0 || binding.length > 8192
                || expiresAt <= 0) throw new IllegalArgumentException("Invalid original DEVICE review");
    }

    public String peer() { return peer; }
    public String account() { return account; }
    public String network() { return network; }
    public String requestDigest() { return digest; }
    public long expiresAtMillis() { return expiresAt; }

    public synchronized boolean current() {
        return decision == Decision.UNDECIDED && System.currentTimeMillis() < expiresAt && scope.current();
    }
    public synchronized void confirmOnce() {
        if (!current()) throw new IllegalStateException("Original DEVICE review unavailable");
        decision = Decision.APPROVED;
        try { scope.confirmed(this); }
        catch (RuntimeException error) { decision = Decision.UNKNOWN; throw error; }
    }
    public synchronized void reject() {
        if (!current()) throw new IllegalStateException("Original DEVICE review unavailable");
        decision = Decision.REJECTED;
        try { scope.rejected(this); }
        catch (RuntimeException error) { decision = Decision.UNKNOWN; throw error; }
    }

    /** Lock, background, account/peer change, or request retirement revokes this decision. */
    synchronized void revoke() { if (decision != Decision.UNKNOWN) decision = Decision.REVOKED; }
    @Override public void cancel() { revoke(); }

    @Override public synchronized boolean canReleaseResolved() {
        try { return scope.physicallyClosed(); }
        catch (RuntimeException error) { return false; }
    }

    /** Only the same native actor may call this after its own INSERTED claim ACK. */
    synchronized void acknowledgeInsertedClaim() {
        if (decision != Decision.APPROVED || claimAcknowledged || !scope.current()) {
            throw new IllegalStateException("Original DEVICE claim unavailable");
        }
        claimAcknowledged = true;
    }

    /** Read only; never claims, prompts, signs, sends, or manufactures a missing row. */
    synchronized boolean originalClaimCurrent(String operation, byte[] binding) {
        if (decision != Decision.APPROVED || !claimAcknowledged || !this.operation.equals(operation)
                || !Arrays.equals(this.binding, binding) || System.currentTimeMillis() >= expiresAt
                || !scope.current()) return false;
        try {
            byte[][] snapshot = journal.read(this.operation, this.binding.clone());
            return snapshot != null && snapshot.length == 7 && snapshot[6] != null
                && snapshot[6].length == 1 && snapshot[6][0] == 1
                && scope.current() && System.currentTimeMillis() < expiresAt;
        } catch (RuntimeException error) { return false; }
    }
}
