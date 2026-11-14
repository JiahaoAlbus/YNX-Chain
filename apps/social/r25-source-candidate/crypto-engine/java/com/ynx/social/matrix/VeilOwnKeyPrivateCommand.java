package com.ynx.social.matrix;

import android.content.Context;
import android.os.Build;
import android.os.Process;
import android.os.UserManager;
import android.system.Os;
import java.security.GeneralSecurityException;

/* NEW private ABI carrier, NOT old ABI2 replacement or an Expo/UI factory.
 * Normal CryptoEngine worker retains this same instance; it uses the SAME
 * already-open native TLS/controller. No loader, actor, authority, raw pointer,
 * selector, secret, signature, callback or existing-identity grant API exists.
 */
final class VeilOwnKeyPrivateCommand {
    // Exact OZSoVn ABI1, independent cold custody; no old-command restoration.
    static native int nativeCopyInitialCoreStorageAssociation(Context context,
            VeilLocalGenesisInput input, byte[] output);

    // Public DATA readback only; does not change admission or the original failure.
    byte[] copyInitialCoreStorageAssociation(VeilLocalRecoveryInput recovery) throws Throwable {
        requireOwner();
        if (ORIGINAL.get() != this || admissionClosed || originalInput == null ||
                recovery == null || recovery != originalRecoveryInput)
            throw new GeneralSecurityException("INITIAL_STORAGE_ORIGINAL_REQUIRED");
        recovery.revalidateOriginal(this);
        byte[] output = new byte[4116];
        try {
            int code = nativeCopyInitialCoreStorageAssociation(retainedAppContext, originalInput, output);
            if (code != 71) throw new GeneralSecurityException("INITIAL_STORAGE_DATA_REQUIRED:" + code);
            recovery.revalidateOriginal(this);
            return output;
        } catch (Throwable failure) {
            java.util.Arrays.fill(output, (byte) 0);
            throw failure;
        }
    }

    static native int nativeColdRecoveryAbiVersion();
    // Same retained cold inventory; explicit C5 profile2, no V1 fallback.
    static native int nativeColdInitialPrekeysAbiVersion();
    static native int nativeBeginColdInitialPrekeysRecovery(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeAuthenticateColdInitialPrekeys(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeCopyColdInitialRegistrationProposal(Context context, VeilOwnKeyColdRecoveryLease lease, byte[] output);
    static native int nativeCopyColdInitialCoreStorageAssociation(Context context, VeilOwnKeyColdRecoveryLease lease, byte[] output);

    static native int nativeColdAuthenticatedPairAbiVersion();
    static native int nativeReadColdExistingPair(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeAuthenticateColdExistingPair(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeCopyColdAuthenticatedPublicPair(Context context, VeilOwnKeyColdRecoveryLease lease, byte[] output);
    static native int nativeBeginColdRecovery(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeOpenColdDatabase(VeilOwnKeyColdRecoveryLease lease, String path);
    static native int nativeObserveColdRecovery(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeReconcileColdRecovery(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeDischargeColdRecovery(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeCleanupColdRecovery(Context context, VeilOwnKeyColdRecoveryLease lease);
    static native int nativeReleaseColdRecovery(Context context, VeilOwnKeyColdRecoveryLease lease);
    private static final int PRIVATE_ABI = 1;
    private static final int LOCAL_NOT_REQUESTED = 40;
    private static final int LOCAL_PAIR_HELD_UNVERIFIED = 41;
    private static final int ATOMIC_PAIR_JOURNAL_REQUIRED = 42;
    private static final int KNOWN_NO_EFFECT_REFUSED = 43;
    private static final int PRE_DEVICE_RESERVATION_REQUIRED = 44;
    private static final int UNKNOWN_RETAINED = 16;
    private static final int PANIC_RETAINED = 25;
    private static final ThreadLocal<VeilOwnKeyPrivateCommand> ORIGINAL = new ThreadLocal<>();

    private final Thread owner;
    private final Context retainedAppContext;
    private VeilLocalGenesisInput originalInput;
    private boolean attempted;
    private boolean admissionClosed;
    private boolean unknown;
    private boolean firstNativeFailureSet;
    private int firstNativeFailure;
    private int lastLocalStatus = LOCAL_NOT_REQUESTED;
    private Throwable primary;
    private VeilOwnKeyLocalStoreCallbacks storeCallbacks;
    private VeilOwnKeyLocalStoreContext.Outcome prepareOutcome;
    private VeilOwnKeyLocalStoreContext.Outcome pathOutcome;
    private boolean storePreparationAttempted;
    private boolean storePathAttempted;
    private final StoreProgress storeProgress = new StoreProgress();
    private VeilLocalRecoveryInput originalRecoveryInput;
    private boolean recoveryCaptureAttempted;
    private boolean recoverySubmitted;
    private boolean recoveryDispatchAttempted;
    private boolean recoveryDispatchActive;
    private boolean recoveryPreparationAttempted;
    private boolean recoveryPathAttempted;
    private boolean recoveryPathActive;
    private VeilOwnKeyLocalStoreContext.Outcome recoveryPrepareOutcome;
    private VeilOwnKeyLocalStoreContext.Outcome recoveryPathOutcome;
    private Throwable recoverySecondary;
    private boolean recoveryNativeFailureSet;
    private int recoveryFirstNativeFailure;
    private int recoveryStatus = UNKNOWN_RETAINED;
    private Throwable recoveryPrimary;
    private boolean authenticatedPairAttempted;

    void requireRecoveryExpectations(String alias, long generation, byte[] association)
            throws GeneralSecurityException {
        requireOwner();
        if (ORIGINAL.get() != this || admissionClosed || !attempted || originalInput == null)
            throw new GeneralSecurityException("LOCAL_RECOVERY_ORIGINAL_COMMAND_REQUIRED");
        // Do NOT clear primary/unknown or call the fresh admission check.
        originalInput.requireRecoveryExpectations(this, alias, generation, association);
    }

    VeilLocalRecoveryInput captureExistingRecoveryInput(String alias, long generation,
            byte[] association, byte[] ids, VeilOwnKeyLocalStoreContext.SubmittedCheck recordCheck)
            throws Throwable {
        requireRecoveryExpectations(alias, generation, association);
        if (recoveryCaptureAttempted || recordCheck == null)
            throw new GeneralSecurityException("LOCAL_RECOVERY_CAPTURE_ONCE");
        recoveryCaptureAttempted = true;
        try {
            recordCheck.revalidate();
            originalRecoveryInput = new VeilLocalRecoveryInput(alias, generation, association, ids, this, recordCheck);
            originalRecoveryInput.revalidateOriginal(this);
            return originalRecoveryInput;
        } catch (Throwable failure) {
            recoveryPrimary = failure;
            throw failure;
        }
    }

    void requireExistingRecoveryAdmission(VeilLocalRecoveryInput input) throws GeneralSecurityException {
        requireOwner();
        if (ORIGINAL.get() != this || admissionClosed || !recoverySubmitted ||
                originalRecoveryInput != input || recoveryPrimary != null)
            throw new GeneralSecurityException("LOCAL_RECOVERY_ADMISSION_REQUIRED");
    }

    // Recovery and authenticated projection have separate matching native ABIs.
    // Neither operation changes the original genesis admission or first cause.

    // Observation only: returned means Java returned, never C success, no-effect,
    // key availability or device authority. JNI dispatch may fail before C entry.
    static final class StoreProgress {
        static final int PREPARE_ENTERED = 1;
        static final int PREPARE_RETURNED = 2;
        static final int PATH_ENTERED = 4;
        static final int PATH_RETURNED = 8;
        static final int RESERVE_DISPATCHED = 16;
        static final int RESERVE_RETURNED = 32;
        private final Thread worker = Thread.currentThread();
        private int bits;

        private void requireWorker() throws GeneralSecurityException {
            if (Thread.currentThread() != worker)
                throw new GeneralSecurityException("LOCAL_STORE_PROGRESS_WRONG_WORKER");
        }

        void record(int event) throws GeneralSecurityException {
            requireWorker();
            boolean valid;
            switch (event) {
                case PREPARE_ENTERED: valid = bits == 0; break;
                case PREPARE_RETURNED: valid = bits == PREPARE_ENTERED; break;
                case PATH_ENTERED:
                    valid = bits == (PREPARE_ENTERED | PREPARE_RETURNED); break;
                case RESERVE_DISPATCHED:
                    valid = bits == (PREPARE_ENTERED | PREPARE_RETURNED | PATH_ENTERED); break;
                case RESERVE_RETURNED:
                    valid = bits == (PREPARE_ENTERED | PREPARE_RETURNED | PATH_ENTERED | RESERVE_DISPATCHED); break;
                case PATH_RETURNED:
                    valid = (bits & PATH_ENTERED) != 0 && (bits & PATH_RETURNED) == 0; break;
                default: valid = false;
            }
            if (!valid) throw new GeneralSecurityException("LOCAL_STORE_PROGRESS_SEQUENCE");
            bits |= event;
        }

        int snapshot() throws GeneralSecurityException {
            requireWorker();
            return bits;
        }
    }

    // Private JNI observation on the SAME retained command, including after
    // refusal/close. Does not call requireNativeAdmission or clear first cause.
    private int readLocalStoreProgress() throws GeneralSecurityException {
        requireOwner();
        if (ORIGINAL.get() != this)
            throw new GeneralSecurityException("LOCAL_STORE_PROGRESS_ORIGINAL_REQUIRED");
        return storeProgress.snapshot();
    }

    void beforeNativeStoreReservation() throws GeneralSecurityException {
        requireNativeAdmission(originalInput);
        storeProgress.record(StoreProgress.RESERVE_DISPATCHED);
    }

    void afterNativeStoreReservation() throws GeneralSecurityException {
        requireOwner();
        storeProgress.record(StoreProgress.RESERVE_RETURNED);
    }

    VeilOwnKeyPrivateCommand(Context actualAppContext) throws GeneralSecurityException {
        if (actualAppContext == null)
            throw new GeneralSecurityException("LOCAL_GENESIS_CONTEXT_REQUIRED");
        if (ORIGINAL.get() != null)
            throw new GeneralSecurityException("LOCAL_GENESIS_ORIGINAL_COMMAND_RETAINED");
        owner = Thread.currentThread();
        retainedAppContext = actualAppContext;
        // Metadata owner only. Real UID/CE preflight is called by JNI BEFORE
        // reservation/key RNG; no mere constructor/Context claims authority.
        ORIGINAL.set(this);
    }

    private void requireOwner() throws GeneralSecurityException {
        if (Thread.currentThread() != owner)
            throw new GeneralSecurityException("LOCAL_GENESIS_WRONG_WORKER");
    }

    // Exact method for actual JNI consumer; repeat after Context preflight
    // (which may reenter Java) and immediately before any effect.
    void requireNativeAdmission(VeilLocalGenesisInput input) throws GeneralSecurityException {
        requireOwner();
        if (!attempted || originalInput != input || admissionClosed || unknown ||
                primary != null || firstNativeFailureSet)
            throw new GeneralSecurityException("LOCAL_GENESIS_ADMISSION_CLOSED_OR_RETAINED");
    }

    // Actual JNI calls this private method on the actual Context. Checking
    // package metadata alone is NOT a UID check. User unlocked != authenticated
    // Keystore; the selected provider separately enforces its authentication.
    private static void validateActualContext(Context context) throws Exception {
        if (Build.VERSION.SDK_INT < 24 || context == null ||
                context.getApplicationContext() != context || context.isDeviceProtectedStorage())
            throw new GeneralSecurityException("LOCAL_GENESIS_ACTUAL_CONTEXT");
        VeilAppIsolation.requireOwnedPackage(context);
        int uid = Process.myUid();
        if (Os.getuid() != uid || context.getApplicationInfo().uid != uid)
            throw new GeneralSecurityException("LOCAL_GENESIS_ACTUAL_UID");
        UserManager users = context.getSystemService(UserManager.class);
        if (users == null || !users.isUserUnlocked())
            throw new GeneralSecurityException("LOCAL_GENESIS_CE_LOCKED");
    }

    int beginLocalGenesis(VeilLocalGenesisInput original) throws Exception {
        requireOwner();
        if (primary != null) VeilOwnKeyPrivateCommand.<RuntimeException>rethrow(primary);
        if (admissionClosed || attempted || unknown || firstNativeFailureSet)
            throw new GeneralSecurityException("LOCAL_GENESIS_ONCE_OR_CLOSED");
        if (original == null)
            throw new GeneralSecurityException("LOCAL_GENESIS_ORIGINAL_INPUT_REQUIRED");
        original.claimForSubmission(this);
        originalInput = original; // Retain BEFORE any native/ABI/link operation.
        attempted = true;
        try {
            original.requireInitialPrekeysForSubmittedCommand(this);
            if (nativePrivateAbiVersion() != PRIVATE_ABI || nativeInitialPrekeysAbiVersion() != 1)
                throw new LinkageError("LOCAL_GENESIS_INITIAL_PREKEYS_ABI_MISMATCH");
            requireNativeAdmission(original);
            return observe(nativeLocalGenesisInitialPrekeys(retainedAppContext, original));
        } catch (Throwable failure) {
            retainPrimary(failure);
            VeilOwnKeyPrivateCommand.<RuntimeException>rethrow(primary);
            throw new AssertionError("UNREACHABLE");
        }
    }

    int readLocalStatus() throws Exception {
        requireOwner();
        if (primary != null) VeilOwnKeyPrivateCommand.<RuntimeException>rethrow(primary);
        // firstNativeFailure is historical cause, NOT current native custody.
        // Even after a numeric refusal, query this SAME actor for later panic/
        // UNKNOWN. An exact retained Java Throwable still takes precedence above.
        try {
            if (nativePrivateAbiVersion() != PRIVATE_ABI)
                throw new LinkageError("LOCAL_GENESIS_PRIVATE_ABI_MISMATCH");
            return observe(nativeLocalStatus());
        } catch (Throwable failure) {
            retainPrimary(failure);
            VeilOwnKeyPrivateCommand.<RuntimeException>rethrow(primary);
            throw new AssertionError("UNREACHABLE");
        }
    }

    private int observe(int status) throws GeneralSecurityException {
        if (status == LOCAL_PAIR_HELD_UNVERIFIED || status == ATOMIC_PAIR_JOURNAL_REQUIRED ||
                status == PRE_DEVICE_RESERVATION_REQUIRED) {
            if (!attempted) throw new GeneralSecurityException("LOCAL_GENESIS_UNEXPECTED_HELD_OWNER");
            return retainDisposition(status); // NEVER device/source/firsttrust admission or durable receipt.
        }
        if (status == LOCAL_NOT_REQUESTED && !attempted) {
            return retainDisposition(status);
        }
        if (status == KNOWN_NO_EFFECT_REFUSED || status == UNKNOWN_RETAINED || status == PANIC_RETAINED ||
                status == 21 || status == 22 || status == 23 || status == 24 || status == 34 || status == 36) {
            if (!firstNativeFailureSet) { firstNativeFailure = status; firstNativeFailureSet = true; }
            return retainDisposition(status);
        }
        // In particular 0/root1 is NOT this private scope's success/status.
        throw new GeneralSecurityException("LOCAL_GENESIS_UNEXPECTED_NATIVE_STATUS");
    }

    private int retainDisposition(int actualStatus) {
        // No resolution/release port exists here: weaker later codes must not
        // clear custody retention or turn it into a no-effect disposition.
        if (actualStatus == PANIC_RETAINED || lastLocalStatus == PANIC_RETAINED) {
            unknown = true;
            lastLocalStatus = PANIC_RETAINED;
        } else if (actualStatus == UNKNOWN_RETAINED || unknown) {
            unknown = true;
            lastLocalStatus = UNKNOWN_RETAINED;
        } else lastLocalStatus = actualStatus;
        return lastLocalStatus;
    }

    private void retainPrimary(Throwable failure) {
        unknown = true;
        if (primary == null) primary = failure;
        // No allocation/log/suppression may replace the exact first primary.
    }

    // JNI invokes only after reserving the SAME native inventory and retaining
    // this command as a GlobalRef. Never hold a LOCAL RefCell borrow across Java.
    private VeilOwnKeyLocalStoreContext.Profile localStoreProfile() throws Exception {
        String name = VeilAppIsolation.requireOwnedPackage(retainedAppContext);
        return "com.ynx.social".equals(name) ? VeilOwnKeyLocalStoreContext.Profile.SOCIAL_V1
                : "com.ynx.social.m1qa".equals(name) ? VeilOwnKeyLocalStoreContext.Profile.M1_QA_V1 : VeilOwnKeyLocalStoreContext.Profile.PUBLIC_VEIL_QA_V1;
    }

    private VeilOwnKeyLocalStoreContext.Outcome prepareLocalStore(VeilLocalGenesisInput original)
            throws Throwable {
        requireNativeAdmission(original);
        if (storePreparationAttempted)
            throw new GeneralSecurityException("LOCAL_STORE_PREPARE_NO_RETRY");
        storePreparationAttempted = true;
        try {
            storeProgress.record(StoreProgress.PREPARE_ENTERED);
            storeCallbacks = new VeilOwnKeyLocalStoreCallbacks(this, original);
            storeCallbacks.revalidate();
            String alias = original.aliasForSubmittedCommand(this);
            long generation = original.generationForSubmittedCommand(this);
            prepareOutcome = VeilOwnKeyLocalStoreContext.prepare(retainedAppContext,
                    localStoreProfile(), alias, generation, storeCallbacks);
            storeProgress.record(StoreProgress.PREPARE_RETURNED);
            latchStoreOutcome(prepareOutcome);
            return prepareOutcome; // Return handled primary AND owner, not a pending JNI exception.
        } catch (Throwable failure) { retainPrimary(failure); throw primary; }
    }

    private VeilOwnKeyLocalStoreContext.Outcome useLocalStore(VeilLocalGenesisInput original)
            throws Throwable {
        requireNativeAdmission(original);
        if (storePathAttempted || prepareOutcome == null || storeCallbacks == null ||
                prepareOutcome.status() != VeilOwnKeyLocalStoreContext.Status.UNVERIFIED_LOCAL_READY ||
                prepareOutcome.owner() == null)
            throw new GeneralSecurityException("LOCAL_STORE_PATH_NOT_READY_OR_ONCE");
        storePathAttempted = true;
        try {
            storeProgress.record(StoreProgress.PATH_ENTERED);
            pathOutcome = prepareOutcome.owner().withDatabasePath(storeCallbacks);
            storeProgress.record(StoreProgress.PATH_RETURNED);
            latchStoreOutcome(pathOutcome);
            return pathOutcome;
        } catch (Throwable failure) { retainPrimary(failure); throw primary; }
    }

    private void latchStoreOutcome(VeilOwnKeyLocalStoreContext.Outcome outcome) {
        if (outcome == null) {
            retainPrimary(new IllegalStateException("LOCAL_STORE_OUTCOME_MISSING"));
            return;
        }
        if (outcome.primary() != null) retainPrimary(outcome.primary());
        if (outcome.status() != VeilOwnKeyLocalStoreContext.Status.UNVERIFIED_LOCAL_READY) unknown = true;
        // Independent Outcome.secondary/owner remain strongly held. No implicit close/retry.
    }

    void retainStoreCallbackFailure(int status) {
        if (!firstNativeFailureSet) { firstNativeFailure = status; firstNativeFailureSet = true; }
        unknown = true;
        retainDisposition(status); // A callback panic must remain stronger than later UNKNOWN.
    }

    void retainStoreCallbackPrimary(Throwable failure) { retainPrimary(failure); }

    void closeAdmission() throws GeneralSecurityException {
        requireOwner();
        admissionClosed = true;
        // NOT dispose or force-close: originalInput, AppContext, primary and
        // native custody remain held; only real native supplier may resolve.
        // ORIGINAL ThreadLocal is never cleared/replaced even on terminal exit.
    }

    @SuppressWarnings("unchecked")
    private static <T extends Throwable> void rethrow(Throwable failure) throws T { throw (T)failure; }

    // R59 recovery is a separate, same-original operation. It never clears the
    // first genesis failure or promotes captured ciphertext to authenticated keys.
    void requireExistingRecoveryActive(VeilLocalRecoveryInput input) throws Throwable {
        requireExistingRecoveryAdmission(input);
        if (!recoveryDispatchActive) {
            throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_NOT_ACTIVE");
        }
        input.revalidateOriginal(this);
    }

    int readExistingLocalPair(VeilLocalRecoveryInput input) throws Throwable {
        requireOwner();
        if (input == null || input != originalRecoveryInput || recoveryDispatchAttempted
                || recoverySubmitted || recoveryPrimary != null) {
            throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_ORIGINAL_REQUIRED");
        }
        input.revalidateOriginal(this);
        try {
            // An old library must refuse before claiming the retained input.
            if (nativeExistingRecoveryAbiVersion() != 1) {
                throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_ABI_REQUIRED");
            }
            input.revalidateOriginal(this);
            recoveryDispatchAttempted = true;
            input.claimForSubmission(this);
            recoverySubmitted = true;
            recoveryDispatchActive = true;
            requireExistingRecoveryActive(input);
            validateActualContext(retainedAppContext);
            int observed = nativeReadExistingLocalPair(retainedAppContext, input);
            requireExistingRecoveryActive(input);
            validateActualContext(retainedAppContext);
            if (observed == 61) {
                recoveryStatus = observed; // Ciphertext only, never a grant.
            } else if (observed == UNKNOWN_RETAINED || observed == PANIC_RETAINED
                    || observed == KNOWN_NO_EFFECT_REFUSED) {
                retainRecoveryNativeFailure(observed);
            } else {
                retainRecoveryNativeFailure(observed);
                throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_STATUS_INVALID");
            }
            return recoveryStatus;
        } catch (Throwable failure) {
            retainRecoveryFailure(failure);
            throw failure;
        } finally {
            recoveryDispatchActive = false;
        }
    }

    /** Internal public projection only: classic33 || PQ2592 || operation/incarnation32.
     * Not a Principal, device grant, signing permission or recovery completion.
     * No caller-provided output buffer can expose bytes after a rejected postcheck.
     */
    byte[] authenticateExistingLocalPair(VeilLocalRecoveryInput input) throws Throwable {
        requireOwner();
        if (recoveryPrimary != null) throw recoveryPrimary;
        if (input == null || input != originalRecoveryInput || !recoverySubmitted
                || recoveryStatus != 61 || recoveryNativeFailureSet
                || recoveryDispatchActive || authenticatedPairAttempted) {
            throw new GeneralSecurityException("LOCAL_AUTHENTICATED_PAIR_ORIGINAL_REQUIRED");
        }
        // Claim before Context/record callbacks, which may reenter Java.
        authenticatedPairAttempted = true;
        recoveryDispatchActive = true;
        byte[] projection = null;
        boolean delivered = false;
        try {
            requireExistingRecoveryActive(input);
            if (nativeAuthenticatedPairAbiVersion() != 1 || nativeInitialPrekeysAbiVersion() != 1)
                throw new LinkageError("LOCAL_INITIAL_REGISTRATION_PROPOSAL_ABI_REQUIRED");
            validateActualContext(retainedAppContext);
            requireExistingRecoveryActive(input);
            int observed = nativeAuthenticateExistingLocalPair(retainedAppContext, input);
            if (observed != 62) {
                retainRecoveryNativeFailure(observed);
                throw new GeneralSecurityException("LOCAL_AUTHENTICATED_PAIR_RELOAD_REFUSED");
            }
            validateActualContext(retainedAppContext);
            requireExistingRecoveryActive(input);
            projection = new byte[VeilInitialRegistrationProposalData.SIZE];
            observed = nativeCopyInitialRegistrationProposal(retainedAppContext, input, projection);
            if (observed != 62) {
                retainRecoveryNativeFailure(observed);
                throw new GeneralSecurityException("LOCAL_AUTHENTICATED_PAIR_PROJECTION_REFUSED");
            }
            validateActualContext(retainedAppContext);
            requireExistingRecoveryActive(input);
            VeilInitialRegistrationProposalData.decode(projection); // DATA shape only; native C5/current is still required
            recoveryStatus = 62; // Local reload only. Genesis UNKNOWN remains untouched.
            delivered = true;
            return projection;
        } catch (Throwable failure) {
            retainRecoveryFailure(failure);
            throw recoveryPrimary;
        } finally {
            if (!delivered && projection != null) java.util.Arrays.fill(projection, (byte) 0);
            recoveryDispatchActive = false;
        }
    }

    private VeilOwnKeyLocalStoreContext.Outcome prepareExistingLocalStore(
            VeilLocalRecoveryInput input) throws Throwable {
        requireExistingRecoveryActive(input);
        if (recoveryPreparationAttempted) {
            throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_PREPARE_ONCE");
        }
        recoveryPreparationAttempted = true;
        try {
            recoveryPrepareOutcome = VeilOwnKeyLocalStoreContext.prepareExisting(
                    retainedAppContext, localStoreProfile(),
                    input.aliasForRecoveryCommand(this), input.generationForRecoveryCommand(this),
                    () -> requireExistingRecoveryActive(input));
            requireRecoveryOutcome(recoveryPrepareOutcome);
            requireExistingRecoveryActive(input);
            return recoveryPrepareOutcome;
        } catch (Throwable failure) {
            retainRecoveryFailure(failure);
            throw failure;
        }
    }

    private VeilOwnKeyLocalStoreContext.Outcome useExistingLocalStore(
            VeilLocalRecoveryInput input) throws Throwable {
        requireExistingRecoveryActive(input);
        if (recoveryPathAttempted || recoveryPathActive || recoveryPrepareOutcome == null
                || recoveryPrepareOutcome.owner() == null) {
            throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_PATH_ONCE");
        }
        requireRecoveryOutcome(recoveryPrepareOutcome);
        recoveryPathAttempted = true;
        try {
            recoveryPathOutcome = recoveryPrepareOutcome.owner().withExistingDatabasePath(path -> {
                requireExistingRecoveryActive(input);
                if (recoveryPathActive) {
                    throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_PATH_REENTRY");
                }
                recoveryPathActive = true;
                try {
                    int observed = nativeOpenExistingDatabase(input, path);
                    if (observed != PRE_DEVICE_RESERVATION_REQUIRED) {
                        retainRecoveryNativeFailure(observed);
                        throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_PATH_RETAINED");
                    }
                    // 44 is only the internal path callback acknowledgment.
                    requireExistingRecoveryActive(input);
                } finally {
                    recoveryPathActive = false;
                }
            });
            requireRecoveryOutcome(recoveryPathOutcome);
            requireExistingRecoveryActive(input);
            return recoveryPathOutcome;
        } catch (Throwable failure) {
            retainRecoveryFailure(failure);
            throw failure;
        }
    }

    private void requireRecoveryOutcome(VeilOwnKeyLocalStoreContext.Outcome outcome)
            throws Throwable {
        if (outcome == null) {
            throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_OUTCOME_MISSING");
        }
        if (recoverySecondary == null && outcome.secondary() != null) {
            recoverySecondary = outcome.secondary();
        }
        if (outcome.primary() != null) {
            retainRecoveryFailure(outcome.primary());
            throw outcome.primary();
        }
        if (outcome.status() != VeilOwnKeyLocalStoreContext.Status.UNVERIFIED_LOCAL_READY
                || outcome.owner() == null) {
            throw new java.security.GeneralSecurityException("LOCAL_RECOVERY_STORE_RETAINED");
        }
    }

    private void retainRecoveryNativeFailure(int observed) {
        if (!recoveryNativeFailureSet) {
            recoveryNativeFailureSet = true;
            recoveryFirstNativeFailure = observed;
        }
        recoveryStatus = recoveryStatus == PANIC_RETAINED || observed == PANIC_RETAINED
                ? PANIC_RETAINED : UNKNOWN_RETAINED;
    }

    private void retainRecoveryFailure(Throwable failure) {
        if (recoveryPrimary == null) recoveryPrimary = failure;
        if (recoveryStatus != PANIC_RETAINED) recoveryStatus = UNKNOWN_RETAINED;
    }

    // Same authenticated recovery. No replacement actor or signing permit.
    private boolean sourceAttempted;
    private boolean sourceAccepted;
    private boolean sourceCancelAttempted;
    private Throwable sourcePrimary;
    private void enterSourceCurrent(VeilLocalRecoveryInput input) throws Throwable {
        requireOwner();
        if (input == null || input != originalRecoveryInput || !recoverySubmitted ||
                recoveryStatus != 62 || recoveryDispatchActive || recoveryPrimary != null)
            throw new GeneralSecurityException("SOURCE_CURRENT_ORIGINAL_AUTHENTICATED_PAIR_REQUIRED");
        recoveryDispatchActive = true;
        try {
            requireExistingRecoveryActive(input);
            validateActualContext(retainedAppContext);
            if (nativeSourceCurrentAbiVersion() != 1)
                throw new LinkageError("SOURCE_CURRENT_ABI_REQUIRED");
        } catch (Throwable failure) { recoveryDispatchActive = false; throw failure; }
    }
    int beginSourceCurrent(VeilLocalRecoveryInput input, byte[] scope, byte[] head,
            byte[] catalog, byte[] issuer, byte[] target, byte[] nonceOut) throws Throwable {
        requireOwner();
        if (sourcePrimary != null) throw sourcePrimary;
        if (sourceAttempted || sourceCancelAttempted)
            throw new GeneralSecurityException("SOURCE_CURRENT_ONCE");
        if (nonceOut == null || nonceOut.length != 32)
            throw new GeneralSecurityException("SOURCE_CURRENT_NONCE_BUFFER");
        sourceAttempted = true;
        boolean delivered = false;
        try {
            enterSourceCurrent(input);
            int status = nativeBeginSourceCurrent(retainedAppContext, input, scope, head, catalog, issuer, target, nonceOut);
            requireExistingRecoveryActive(input);
            validateActualContext(retainedAppContext);
            delivered = status == 71;
            return status;
        } catch (Throwable failure) {
            if (sourcePrimary == null) sourcePrimary = failure;
            throw sourcePrimary;
        } finally {
            recoveryDispatchActive = false;
            if (!delivered) java.util.Arrays.fill(nonceOut, (byte) 0);
        }
    }
    int acceptSourceCurrent(VeilLocalRecoveryInput input, byte[] response) throws Throwable {
        requireOwner();
        if (sourcePrimary != null) throw sourcePrimary;
        if (!sourceAttempted || sourceAccepted || sourceCancelAttempted)
            throw new GeneralSecurityException("SOURCE_CURRENT_ACCEPT_ONCE");
        sourceAccepted = true;
        try {
            enterSourceCurrent(input);
            int status = nativeAcceptSourceCurrent(retainedAppContext, input, response);
            requireExistingRecoveryActive(input);
            validateActualContext(retainedAppContext);
            return status; // 72 remains UNADMITTED; genesis UNKNOWN unchanged
        } catch (Throwable failure) {
            if (sourcePrimary == null) sourcePrimary = failure;
            throw sourcePrimary;
        } finally { recoveryDispatchActive = false; }
    }
    int cancelSourceCurrent(VeilLocalRecoveryInput input) throws Throwable {
        requireOwner();
        if (!sourceAttempted || sourceCancelAttempted)
            throw new GeneralSecurityException("SOURCE_CURRENT_CANCEL_ONCE");
        sourceCancelAttempted = true;
        try {
            enterSourceCurrent(input);
            int status = nativeCancelSourceCurrent(retainedAppContext, input);
            requireExistingRecoveryActive(input);
            return status; // 75 is not release or NotApplied
        } catch (Throwable failure) {
            if (sourcePrimary == null) sourcePrimary = failure;
            throw sourcePrimary;
        } finally { recoveryDispatchActive = false; }
    }
    // Future cold Source API: exact Auth frozen contract. Not current100 exports.
    // Matching real Native implementation/library is required before any caller use.
    static native int nativeColdSourceCurrentAbiVersion();
    static native int nativeBeginColdSourceCurrent(Context originalContext,
            VeilOwnKeyColdRecoveryLease originalLease, byte[] scope, byte[] head,
            byte[] catalog, byte[] issuerMessage, byte[] targetMessage, byte[] nonceOut);
    static native int nativeAcceptColdSourceCurrent(Context originalContext,
            VeilOwnKeyColdRecoveryLease originalLease, byte[] originalResponse);
    static native int nativeCancelColdSourceCurrent(Context originalContext,
            VeilOwnKeyColdRecoveryLease originalLease);

    private static native int nativeSourceCurrentAbiVersion();
    private static native int nativeBeginSourceCurrent(Context originalContext,
            VeilLocalRecoveryInput originalInput, byte[] scope, byte[] head,
            byte[] catalog, byte[] issuerMessage, byte[] targetMessage, byte[] nonceOut);
    private static native int nativeAcceptSourceCurrent(Context originalContext,
            VeilLocalRecoveryInput originalInput, byte[] originalResponse);
    private static native int nativeCancelSourceCurrent(Context originalContext,
            VeilLocalRecoveryInput originalInput);

    private static native int nativeExistingRecoveryAbiVersion();
    private static native int nativeAuthenticatedPairAbiVersion();
    private static native int nativeAuthenticateExistingLocalPair(
            android.content.Context context, VeilLocalRecoveryInput input);
    private static native int nativeCopyAuthenticatedPublicPair(
            android.content.Context context, VeilLocalRecoveryInput input, byte[] publicProjection);
    private static native int nativeCopyInitialRegistrationProposal(
            android.content.Context context, VeilLocalRecoveryInput input, byte[] publicProjection);
    private static native int nativeReadExistingLocalPair(
            android.content.Context context, VeilLocalRecoveryInput input);
    private native int nativeOpenExistingDatabase(VeilLocalRecoveryInput input, String path);

    private static native int nativePrivateAbiVersion();
    private static native int nativeLocalGenesis(Context actualContext, VeilLocalGenesisInput originalInput);
    // Separate entry point: old binaries cannot silently run the two-record initializer.
    private static native int nativeInitialPrekeysAbiVersion();
    private static native int nativeLocalGenesisInitialPrekeys(Context actualContext, VeilLocalGenesisInput originalInput);
    private static native int nativeLocalStatus();
}
