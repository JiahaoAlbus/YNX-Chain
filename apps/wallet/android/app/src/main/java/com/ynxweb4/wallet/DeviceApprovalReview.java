package com.ynxweb4.wallet;

import java.util.Objects;

/** One in-process review of an already authenticated, original DEVICE request. */
final class DeviceApprovalReview {
    enum State { OPEN, CONFIRMING, REJECTED, CANCELLED, EXPIRED, UNAVAILABLE }

    /** Supplied by the protected original actor, never parsed from an Intent or renderer. */
    interface Original {
        String peer();
        String account();
        String network();
        String requestDigest();
        long expiresAtMillis();
        // Must recheck original peer, request, account, policy and lock state.
        boolean current();
        // Enters the same original protected operation. This is not a signing grant.
        void confirmOnce();
        // Records the decision against the same original request.
        void reject();
        default void cancel() { }
    }

    private final Original original;
    private final String peer, account, network, digest;
    private final long expiresAt;
    private State state = State.OPEN;

    DeviceApprovalReview(Original original) {
        this.original = Objects.requireNonNull(original);
        peer = label(original.peer()); account = label(original.account());
        network = label(original.network()); digest = label(original.requestDigest());
        expiresAt = original.expiresAtMillis();
        if (expiresAt <= 0) throw new IllegalArgumentException("Invalid review expiry");
    }

    String peer() { return peer; }
    String account() { return account; }
    String network() { return network; }
    String requestDigest() { return digest; }
    long expiresAtMillis() { return expiresAt; }
    synchronized State state() { return state; }

    synchronized State confirm(long nowMillis) {
        if (state != State.OPEN) return state;
        if (nowMillis >= expiresAt) return expire(nowMillis);
        try {
            if (!sameOriginal() || !original.current() || !sameOriginal()) return state = State.UNAVAILABLE;
            // Reserve before crossing the protected boundary: an exception or
            // lost response never permits a second confirmation or signature.
            state = State.CONFIRMING;
            original.confirmOnce();
        } catch (RuntimeException error) {
            state = State.UNAVAILABLE;
        }
        return state;
    }

    synchronized State reject(long nowMillis) {
        if (state != State.OPEN) return state;
        if (nowMillis >= expiresAt) return expire(nowMillis);
        try {
            if (!sameOriginal() || !original.current() || !sameOriginal()) return state = State.UNAVAILABLE;
            state = State.REJECTED;
            original.reject();
        } catch (RuntimeException error) {
            state = State.UNAVAILABLE;
        }
        return state;
    }

    synchronized State cancel() {
        if (state == State.OPEN) {
            state = State.CANCELLED;
            try { original.cancel(); } catch (RuntimeException error) { state = State.UNAVAILABLE; }
        }
        return state;
    }

    synchronized State expire(long nowMillis) {
        if (state == State.OPEN && nowMillis >= expiresAt) {
            state = State.EXPIRED;
            try { original.cancel(); } catch (RuntimeException error) { state = State.UNAVAILABLE; }
        }
        return state;
    }

    private boolean sameOriginal() {
        return peer.equals(original.peer()) && account.equals(original.account())
            && network.equals(original.network()) && digest.equals(original.requestDigest())
            && expiresAt == original.expiresAtMillis();
    }

    private static String label(String value) {
        if (value == null || value.trim().isEmpty() || value.length() > 1024) {
            throw new IllegalArgumentException("Invalid original review field");
        }
        return value;
    }
}
