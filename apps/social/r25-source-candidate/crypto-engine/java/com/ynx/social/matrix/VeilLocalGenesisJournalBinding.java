package com.ynx.social.matrix;

import java.util.Arrays;

/** Original-worker durable public correlation, NOT device authorization.
 * The normal owner installs once after SUBMITTED persistence and before native
 * genesis. There is deliberately no reset, replacement or public restore API.
 */
final class VeilLocalGenesisJournalBinding {
    interface Journal {
        /** Must synchronously persist a copy through the original coordinator.
         * Return only after durable success; throw on refusal or uncertainty.
         */
        void persistOriginalNativeIds(byte[] operationAndIncarnation) throws Throwable;
    }

    private static final ThreadLocal<VeilLocalGenesisJournalBinding> ORIGINAL = new ThreadLocal<>();
    private final Thread worker = Thread.currentThread();
    private final VeilLocalGenesisInput input;
    private final Journal journal;
    private boolean attempted;
    private boolean admissionClosed;
    private byte[] retainedNativeIds;
    private Throwable primary;

    private VeilLocalGenesisJournalBinding(VeilLocalGenesisInput input, Journal journal) {
        this.input = input;
        this.journal = journal;
    }

    static VeilLocalGenesisJournalBinding install(VeilLocalGenesisInput original, Journal journal) {
        if (original == null || journal == null || ORIGINAL.get() != null) {
            throw new IllegalStateException("LOCAL_NATIVE_BINDING_ORIGINAL_REQUIRED");
        }
        VeilLocalGenesisJournalBinding binding = new VeilLocalGenesisJournalBinding(original, journal);
        ORIGINAL.set(binding);
        return binding;
    }

    void closeAdmission() {
        if (Thread.currentThread() != worker) throw new IllegalStateException("LOCAL_NATIVE_BINDING_WORKER");
        admissionClosed = true;
        // Retain input, original IDs and primary failure for the original owner.
    }

    /** JNI callback signature:
     * (Lcom/ynx/social/matrix/VeilLocalGenesisInput;[B)I
     * Exactly 1 acknowledges durable public-ID binding only. JNI exception or
     * any other result forbids key effects; no acknowledgement is device trust.
     */
    @SuppressWarnings("unused")
    private static int persistOriginalNativeIds(VeilLocalGenesisInput original, byte[] nativeIds) throws Throwable {
        VeilLocalGenesisJournalBinding binding = ORIGINAL.get();
        if (binding == null || binding.worker != Thread.currentThread()) {
            throw new IllegalStateException("LOCAL_NATIVE_BINDING_WORKER");
        }
        if (binding.primary != null) throw binding.primary;
        if (binding.admissionClosed || binding.input != original || binding.attempted) {
            throw new IllegalStateException("LOCAL_NATIVE_BINDING_REFUSED");
        }
        binding.attempted = true; // Allocation/callback failure cannot cause a second attempt.
        byte[] copy = null;
        try {
            if (nativeIds == null || nativeIds.length != 32) {
                throw new IllegalArgumentException("LOCAL_NATIVE_BINDING_IDS");
            }
            binding.retainedNativeIds = nativeIds.clone();
            copy = binding.retainedNativeIds.clone();
            binding.journal.persistOriginalNativeIds(copy);
            return 1;
        } catch (Throwable failure) {
            binding.primary = failure;
            throw failure;
        } finally {
            if (copy != null) Arrays.fill(copy, (byte) 0);
        }
    }
}
