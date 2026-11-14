package com.ynx.social.matrix;

import android.content.Context;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import kotlin.Unit;

/** Private journal-owning cold receiver. Public bookkeeping is not authority.
 * No UI factory, old command/TLS reconstruction, fresh reservation or key work. */
final class VeilOwnKeyColdRecoveryLease {
    private final Thread worker = Thread.currentThread();
    private final Context context;
    private final VeilDeviceEnrollmentPendingStore.ColdBorrow borrow;
    private String alias;
    private long generation;
    // Captured from the same persisted journal record; metadata is not authority.
    private int initializationProfile;
    private byte[] association;
    private byte[] ids;
    private boolean captureAttempted, captured, active, checking, beginAttempted;
    private boolean pathAttempted, pathActive, releaseAttempted, released, retired;
    private Throwable primary, releaseFailure;
    private int firstNativeFailure, lastStatus;
    private boolean pairReadAttempted, pairAuthenticationAttempted, pairAuthenticated;
    private int pairReadStatus;
    private boolean ownerCleanupAttempted, ownerReleaseAttempted;
    private int ownerCleanupStatus;
    private Throwable ownerCloseFailure;
    // Same actual authenticated cold custody only. No warm command or grant.
    private boolean sourceAttempted, sourceNativeEntered, sourceDispatchEntered;
    private int sourceAcceptAttempts;
    private boolean sourceAccountFactsObserved;
    private boolean sourceCancelAttempted, sourceRequestPending, sourceCancelConfirmed, sourceUnknown;
    private int sourceLastNativeStatus, sourceFirstNativeFailure;
    private Throwable sourcePrimary;
    private boolean businessUnknown;
    private Throwable businessPrimary;
    private boolean nativeFailureRetained;
    private VeilOwnKeyLocalStoreContext.Outcome prepared, pathOutcome, closeOutcome;

    VeilOwnKeyColdRecoveryLease(Context actualContext, VeilDeviceEnrollmentPendingStore.ColdBorrow actualBorrow) {
        if (actualContext == null || actualBorrow == null) throw new NullPointerException();
        context = actualContext; borrow = actualBorrow;
    }
    private void worker() { if (Thread.currentThread() != worker) throw new IllegalStateException("COLD_WRONG_WORKER"); }
    private void retain(Throwable t) {
        if (primary == null) primary = t;
        else if (primary != t) try { primary.addSuppressed(t); } catch (Throwable ignored) { }
    }
    private RuntimeException propagate(Throwable t) { return VeilOwnKeyColdRecoveryLease.<RuntimeException, RuntimeException>raise(t); }
    @SuppressWarnings("unchecked") private static <T extends Throwable,R> R raise(Throwable t) throws T { throw (T)t; }
    void initializeOriginal() {
        worker(); if (captureAttempted) throw new IllegalStateException("COLD_CAPTURE_ONCE");
        captureAttempted = true;
        try {
            VeilAppIsolation.requireOwnedPackage(context);
            borrow.withRecord(record -> {
                alias = record.getAlias(); generation = record.getStorageGeneration();
                initializationProfile = record.getInitializationProfile();
                association = record.association(); ids = record.getNativeIds().copyBytes();
                return Unit.INSTANCE;
            });
            VeilLocalRecoveryInput.validatePublicShape(alias, generation, association, ids);
            if (initializationProfile != 2) throw new GeneralSecurityException("COLD_INITIAL_PREKEYS_PROFILE_REQUIRED");
            VeilAppIsolation.requireOwnedPackage(context); borrow.revalidate(); captured = true;
        } catch (Throwable t) { retain(t); throw propagate(t); }
    }
    boolean isRetired() { worker(); return retired; }
    Throwable retainedPrimary() { worker(); return primary; }
    int retainedFirstNativeFailure() { worker(); return firstNativeFailure; }
    private void checkForNative() throws Throwable {
        worker();
        if (!active || !captured || released || checking) throw new GeneralSecurityException("COLD_LEASE_NOT_ACTIVE");
        checking = true;
        try { VeilAppIsolation.requireOwnedPackage(context); borrow.revalidate(); }
        finally { checking = false; }
        // A retained first cause is not permission, but must not block cleanup.
    }
    /** Same active Context/lease and original persisted profile only. Native
     * still authenticates actual C5 capture, platform and current independently. */
    private void requireInitialPrekeysForNative() throws Throwable {
        checkForNative();
        if (initializationProfile != 2) throw new GeneralSecurityException("COLD_INITIAL_PREKEYS_PROFILE_REQUIRED");
        checkForNative();
    }
    private Context contextForNative() throws Throwable { checkForNative(); return context; }
    private String aliasForNative() throws Throwable { checkForNative(); return alias; }
    private long generationForNative() throws Throwable { checkForNative(); return generation; }
    private byte[] associationForNative() throws Throwable { return publicCopy(association); }
    private byte[] originalIdsForNative() throws Throwable { return publicCopy(ids); }
    private byte[] publicCopy(byte[] original) throws Throwable {
        checkForNative(); byte[] copy = original.clone();
        try { checkForNative(); return copy; } catch (Throwable t) { Arrays.fill(copy, (byte)0); throw t; }
    }
    private VeilOwnKeyLocalStoreContext.Profile profile() throws Exception {
        String name = VeilAppIsolation.requireOwnedPackage(context);
        return "com.ynx.social".equals(name) ? VeilOwnKeyLocalStoreContext.Profile.SOCIAL_V1
            : "com.ynx.social.m1qa".equals(name) ? VeilOwnKeyLocalStoreContext.Profile.M1_QA_V1
            : VeilOwnKeyLocalStoreContext.Profile.PUBLIC_VEIL_QA_V1;
    }
    private void requireReady(VeilOwnKeyLocalStoreContext.Outcome outcome) throws Throwable {
        if (outcome.status() != VeilOwnKeyLocalStoreContext.Status.UNVERIFIED_LOCAL_READY) {
            Throwable failure = outcome.primary();
            if (failure == null) failure = new GeneralSecurityException("COLD_PLATFORM_UNRESOLVED");
            retain(failure); if (outcome.secondary() != null) retain(outcome.secondary()); throw primary;
        }
    }
    /** Native may invoke this only in its same-global, one-shot OPEN_WINDOW. */
    private int openExistingForNative() throws Throwable {
        checkForNative();
        if (pathAttempted || primary != null) throw new GeneralSecurityException("COLD_PATH_ONCE");
        pathAttempted = true;
        try {
            final VeilOwnKeyLocalStoreContext.Profile selected = profile();
            borrow.retainPlatformOutcome(() -> {
                prepared = VeilOwnKeyLocalStoreContext.prepareExisting(context, selected, alias, generation, this::checkForNative);
                return prepared;
            });
            requireReady(prepared); checkForNative();
            borrow.retainPlatformOutcome(() -> {
                pathOutcome = prepared.owner().withExistingDatabasePath(path -> {
                    checkForNative(); if (pathActive) throw new GeneralSecurityException("COLD_PATH_REENTRY");
                    pathActive = true;
                    try {
                        int value = VeilOwnKeyPrivateCommand.nativeOpenColdDatabase(this, path);
                        if (value != 180) {
                            if (!nativeFailureRetained) { firstNativeFailure = value; nativeFailureRetained = true; }
                            throw new GeneralSecurityException("COLD_NATIVE_EXISTING_OPEN_REFUSED");
                        }
                        checkForNative();
                    } finally { pathActive = false; }
                });
                return pathOutcome;
            });
            requireReady(pathOutcome); checkForNative(); return 180;
        } catch (Throwable t) { retain(t); throw primary; }
    }
    /** Only actual native releasable C-custody invokes this callback. Never a
     * public release flag. Failed close is cached; no blind OS-close retry. */
    private void releaseForNative() throws Throwable {
        checkForNative();
        if (releaseAttempted) {
            if (releaseFailure != null) throw releaseFailure;
            throw new GeneralSecurityException("COLD_RELEASE_ALREADY_ATTEMPTED");
        }
        releaseAttempted = true;
        try {
            closeOutcome = borrow.closeRetainedPlatformOwner();
            borrow.finishNativeCleanup();
            released = true;
            Arrays.fill(association, (byte)0); Arrays.fill(ids, (byte)0);
            // No active-lease postcheck after actual retirement.
        } catch (Throwable t) { retain(t); releaseFailure = primary; throw releaseFailure; }
    }
    /** Same original encrypted pair only. Journal 180..184 is not this receipt. */
    int readExistingLocalPair() {
        worker();
        try {
            requirePairLifetime();
            if (pairReadAttempted) {
                if (pairReadStatus == 0) throw new GeneralSecurityException("COLD_PAIR_READ_UNRESOLVED");
                return pairReadStatus;
            }
            requirePairABI();
            pairReadAttempted = true;
            int code = callPair(0, null);
            pairReadStatus = code;
            if (code != 61) throw pairFailure(code, "COLD_PAIR_CIPHERTEXT_READ_REFUSED");
            return code;
        } catch (Throwable t) { retain(t); throw propagate(primary); }
    }

    void requireReadOriginal() {
        worker();
        // A rejected duplicate is not a new failure of an already authenticated owner.
        if (pairAuthenticationAttempted) throw new IllegalStateException("COLD_PAIR_AUTHENTICATION_ONCE");
        try {
            requirePairLifetime();
            if (!pairReadAttempted || pairReadStatus != 61)
                throw new GeneralSecurityException("COLD_PAIR_READ_ORIGINAL_REQUIRED");
        } catch (Throwable t) { retain(t); throw propagate(primary); }
    }

    /** Called only after the normal system-authentication request was consumed. */
    byte[] authenticateExistingLocalPair() {
        worker();
        if (pairAuthenticationAttempted) throw new IllegalStateException("COLD_PAIR_AUTHENTICATION_ONCE");
        byte[] projection = null; boolean delivered = false;
        try {
            requireReadOriginal();
            requirePairABI();
            pairAuthenticationAttempted = true; // Allocation/callback failure never retries authentication.
            projection = new byte[VeilInitialRegistrationProposalData.SIZE];
            int code = callPair(1, null);
            if (code != 62) throw pairFailure(code, "COLD_PAIR_AUTHENTICATION_REFUSED");
            code = callPair(2, projection);
            if (code != 62) throw pairFailure(code, "COLD_PAIR_PUBLIC_COPY_REFUSED");
            validatePublicPair(projection);
            requirePairLifetime();
            pairAuthenticated = true; delivered = true; return projection;
        } catch (Throwable t) { retain(t); throw propagate(primary); }
        finally { if (!delivered && projection != null) Arrays.fill(projection, (byte)0); }
    }

    /** Read-only Native current check; never repeats authentication or releases custody. */
    void requireAuthenticatedPairCurrent(byte[] expected) {
        worker(); byte[] current = new byte[VeilInitialRegistrationProposalData.SIZE];
        try {
            requirePairLifetime();
            if (!pairAuthenticated || expected == null || expected.length != VeilInitialRegistrationProposalData.SIZE)
                throw new GeneralSecurityException("COLD_AUTHENTICATED_ORIGINAL_REQUIRED");
            int code = callPair(2, current);
            if (code != 62) throw pairFailure(code, "COLD_PAIR_CURRENT_REFUSED");
            validatePublicPair(current);
            if (!java.security.MessageDigest.isEqual(current, expected))
                throw new GeneralSecurityException("COLD_PAIR_ORIGINAL_CHANGED");
            requirePairLifetime();
        } catch (Throwable t) { retain(t); throw propagate(primary); }
        finally { Arrays.fill(current, (byte)0); }
    }

    /** Same authenticated cold C5 original only; DATA71 is never registration authority. */
    byte[] copyInitialCoreStorageAssociation(byte[] expected) {
        worker(); byte[] output = new byte[4116]; boolean delivered = false;
        try {
            requireAuthenticatedPairCurrent(expected);
            int code = callPair(3, output);
            if (code != 71) throw pairFailure(code, "COLD_INITIAL_STORAGE_DATA_REQUIRED");
            requireAuthenticatedPairCurrent(expected);
            delivered = true;
            return output;
        } catch (Throwable failure) { retain(failure); throw propagate(primary); }
        finally { if (!delivered) Arrays.fill(output, (byte)0); }
    }

    private void requirePairABI() throws Throwable {
        if (VeilOwnKeyPrivateCommand.nativeColdInitialPrekeysAbiVersion() != 1)
            throw new LinkageError("COLD_INITIAL_PREKEYS_ABI_REQUIRED");
    }
    private void requirePairLifetime() throws Throwable {
        worker();
        if (active || !captured || !beginAttempted || released || retired || ownerCleanupAttempted)
            throw new GeneralSecurityException("COLD_PAIR_ORIGINAL_LIFETIME");
        if (initializationProfile != 2) throw new GeneralSecurityException("COLD_INITIAL_PREKEYS_PROFILE_REQUIRED");
        if (primary != null) throw primary;
        if (nativeFailureRetained) throw new GeneralSecurityException("COLD_FIRST_NATIVE_FAILURE_RETAINED");
        VeilAppIsolation.requireOwnedPackage(context); borrow.revalidate();
        VeilAppIsolation.requireOwnedPackage(context);
    }
    private GeneralSecurityException pairFailure(int code, String label) {
        if (!nativeFailureRetained) { firstNativeFailure = code; nativeFailureRetained = true; }
        return new GeneralSecurityException(label);
    }
    private void validatePublicPair(byte[] projection) throws GeneralSecurityException {
        if (initializationProfile != 2 || ids == null || ids.length != 32)
            throw new GeneralSecurityException("COLD_INITIAL_PREKEYS_ORIGINAL_REQUIRED");
        // PUBLIC DATA parser only. Native actual C5/platform authentication is
        // mandatory before copy62 and again for every current readback.
        VeilInitialRegistrationProposalData data = VeilInitialRegistrationProposalData.decode(projection);
        byte[] actual = data.originalIds();
        try {
            if (!java.security.MessageDigest.isEqual(actual, ids))
                throw new GeneralSecurityException("COLD_PAIR_OPERATION_OR_INCARNATION");
        } finally { Arrays.fill(actual, (byte)0); }
    }
    private int callPair(int operation, byte[] output) throws Throwable {
        requirePairLifetime(); active = true;
        try {
            return borrow.withCleanup(() -> {
                try {
                    checkForNative(); int code;
                    if (operation == 0) code = VeilOwnKeyPrivateCommand.nativeReadColdExistingPair(context, this);
                    else if (operation == 1) code = VeilOwnKeyPrivateCommand.nativeAuthenticateColdInitialPrekeys(context, this);
                    else if (operation == 2) code = VeilOwnKeyPrivateCommand.nativeCopyColdInitialRegistrationProposal(context, this, output);
                    else if (operation == 3) code = VeilOwnKeyPrivateCommand.nativeCopyColdInitialCoreStorageAssociation(context, this, output);
                    else throw new AssertionError();
                    checkForNative(); return code;
                } catch (Throwable t) { retain(t); throw propagate(t); }
            });
        } finally { active = false; }
    }

    /** Internal capability probe only. Never a NativeReady or authority setter. */
    boolean supportsColdSourceCurrent() throws Throwable {
        requirePairLifetime();
        if (!pairAuthenticated) return false;
        try { return VeilOwnKeyPrivateCommand.nativeColdSourceCurrentAbiVersion() == 1; }
        catch (UnsatisfiedLinkError missing) { return false; }
    }

    private static void validateColdSourceRequest(byte[] scope, byte[] head, byte[] catalog,
            byte[] issuer, byte[] target, byte[] nonceOut) throws GeneralSecurityException {
        if (scope == null || scope.length < 1 || scope.length > 4096 ||
                issuer == null || issuer.length < 1 || issuer.length > 65536 ||
                target == null || target.length < 1 || target.length > 65536 ||
                nonceOut == null || nonceOut.length != 32)
            throw new GeneralSecurityException("COLD_SOURCE_REQUEST_SHAPE");
        if (nonceOut == scope || nonceOut == head || nonceOut == catalog || nonceOut == issuer || nonceOut == target)
            throw new GeneralSecurityException("COLD_SOURCE_OUTPUT_ALIASES_INPUT");
        for (byte[] hash : new byte[][] { head, catalog }) {
            if (hash == null || hash.length != 64) throw new GeneralSecurityException("COLD_SOURCE_HASH_SHAPE");
            for (byte value : hash) if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f')))
                throw new GeneralSecurityException("COLD_SOURCE_HASH_SHAPE");
        }
        try {
            java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                .decode(java.nio.ByteBuffer.wrap(scope));
        } catch (java.nio.charset.CharacterCodingException malformed) {
            throw new GeneralSecurityException("COLD_SOURCE_SCOPE_UTF8", malformed);
        }
    }
    private void requireColdSourcePair() throws Throwable {
        requirePairLifetime();
        if (!pairAuthenticated) throw new GeneralSecurityException("COLD_SOURCE_AUTHENTICATED_PAIR_REQUIRED");
    }
    private Throwable retainSourceFailure(Throwable failure) {
        if (sourcePrimary == null) sourcePrimary = failure;
        else if (sourcePrimary != failure) try { sourcePrimary.addSuppressed(failure); } catch (Throwable ignored) { }
        return sourcePrimary;
    }
    private void rememberSourceStatus(int code, int expected) {
        sourceLastNativeStatus = code;
        if (code != expected && sourceFirstNativeFailure == 0) sourceFirstNativeFailure = code;
        if (code == 16) sourceUnknown = true;
    }
    /** Internal same-owner JNI window. It supplies no key, Source or device authority. */
    @FunctionalInterface interface BusinessCall<T> {
        T run(Context originalContext, VeilOwnKeyColdRecoveryLease originalLease) throws Throwable;
    }
    <T> T withAuthenticatedBusiness(BusinessCall<T> call) throws Throwable {
        return callBusiness(false, call);
    }
    /** Disposal of the same retained signature attempt may outlive its request budget. */
    <T> T withBusinessCleanup(BusinessCall<T> call) throws Throwable {
        return callBusiness(true, call);
    }
    private <T> T callBusiness(boolean cleanup, BusinessCall<T> call) throws Throwable {
        worker();
        if (call == null) throw new NullPointerException();
        if (cleanup) {
            if (active || !captured || !pairAuthenticated || released || retired || ownerCleanupAttempted)
                throw new GeneralSecurityException("COLD_BUSINESS_CLEANUP_ORIGINAL_REQUIRED");
            VeilAppIsolation.requireOwnedPackage(context); borrow.revalidate();
        } else {
            requireColdSourcePair();
            if (businessPrimary != null) throw businessPrimary;
            if (businessUnknown) throw new GeneralSecurityException("COLD_BUSINESS_UNKNOWN_RETAINED");
        }
        // Validation rejection precedes the effect fence and does not replace any success.
        final boolean[] entered = { false };
        active = true;
        try {
            return borrow.withCleanup(() -> {
                try {
                    checkForNative();
                    entered[0] = true;
                    T value = call.run(context, this);
                    checkForNative();
                    return value;
                } catch (Throwable failure) { throw propagate(failure); }
            });
        } catch (Throwable failure) {
            if (entered[0]) {
                businessUnknown = true;
                if (businessPrimary == null) businessPrimary = failure;
                else if (businessPrimary != failure) try { businessPrimary.addSuppressed(failure); } catch (Throwable ignored) { }
            }
            throw failure;
        } finally { active = false; }
    }

    private boolean sourceHoldsParent() {
        return businessUnknown || sourceUnknown || (sourceRequestPending && !sourceCancelConfirmed);
    }
    /** First submission only. Rejection of a duplicate never touches the prior
     * caller nonce, pair, retained success or original first failure. */
    int beginSourceCurrent(byte[] scope, byte[] head, byte[] catalog,
            byte[] issuer, byte[] target, byte[] nonceOut) throws Throwable {
        worker();
        if (sourcePrimary != null) throw sourcePrimary;
        if (sourceAttempted || sourceCancelAttempted) throw new GeneralSecurityException("COLD_SOURCE_CURRENT_ONCE");
        validateColdSourceRequest(scope, head, catalog, issuer, target, nonceOut);
        requireColdSourcePair();
        if (!supportsColdSourceCurrent()) throw new LinkageError("COLD_SOURCE_CURRENT_MATCHING_API_REQUIRED");
        sourceAttempted = true; // Retain before allocation/entropy/foreign call; no reselection.
        byte[][] owned = null; byte[] localNonce = null; boolean delivered = false;
        try {
            owned = new byte[5][];
            byte[][] inputs = { scope, head, catalog, issuer, target };
            for (int i = 0; i < owned.length; i++) owned[i] = inputs[i].clone();
            localNonce = new byte[32];
            Arrays.fill(nonceOut, (byte)0);
            int status = callColdSource(0, owned, localNonce);
            if (status == 71) {
                System.arraycopy(localNonce, 0, nonceOut, 0, 32);
                delivered = true;
            }
            return status; // 71 is only an original request/nonce, never Source approval.
        } catch (Throwable failure) { throw retainSourceFailure(failure); }
        finally {
            if (owned != null) for (byte[] bytes : owned) if (bytes != null) Arrays.fill(bytes, (byte)0);
            if (localNonce != null) Arrays.fill(localNonce, (byte)0);
            if (!delivered) Arrays.fill(nonceOut, (byte)0);
        }
    }
    /** Transport phase only. Neither 204 nor this allowance admits Source/device authority. */
    static boolean acceptsSourceResponseAt(int attempts, boolean originalAccountFactsObserved) {
        return attempts == 0 || (attempts == 1 && originalAccountFactsObserved);
    }
    void retainOriginalAccountFactsUnadmitted(int nativeStatus) throws Throwable {
        worker(); requireColdSourcePair();
        if (nativeStatus != 204 || !sourceRequestPending || sourceCancelAttempted || sourceUnknown ||
                sourceLastNativeStatus != 72 || sourceAcceptAttempts < 1 || sourceAcceptAttempts > 2)
            throw new GeneralSecurityException("COLD_ACCOUNT_ORIGINAL_FACTS_PHASE_REQUIRED");
        if (sourceAcceptAttempts == 1) sourceAccountFactsObserved = true;
        else if (!sourceAccountFactsObserved)
            throw new GeneralSecurityException("COLD_ACCOUNT_ORIGINAL_REFRESH_REQUIRED");
        // A second account/signature observation NEVER re-arms another response.
    }
    int acceptSourceCurrent(byte[] response) throws Throwable {
        worker();
        if (sourcePrimary != null) throw sourcePrimary;
        if (!sourceRequestPending || sourceCancelAttempted || sourceUnknown ||
                !acceptsSourceResponseAt(sourceAcceptAttempts, sourceAccountFactsObserved))
            throw new GeneralSecurityException("COLD_SOURCE_CURRENT_ORIGINAL_PHASE_REQUIRED");
        if (response == null || response.length < 1 || response.length > 393216)
            throw new GeneralSecurityException("COLD_SOURCE_CURRENT_RESPONSE_SHAPE");
        requireColdSourcePair();
        sourceAcceptAttempts++; // Select each original phase before allocation/foreign entry; no retry.
        byte[] owned = null;
        try {
            owned = response.clone();
            return callColdSource(1, null, owned); // 72 is retained UNADMITTED evidence only.
        } catch (Throwable failure) { throw retainSourceFailure(failure); }
        finally { if (owned != null) Arrays.fill(owned, (byte)0); }
    }
    int cancelSourceCurrent() throws Throwable {
        worker();
        if (!sourceNativeEntered || sourceCancelAttempted)
            throw new GeneralSecurityException("COLD_SOURCE_CURRENT_CANCEL_ONCE");
        requireColdSourcePair();
        sourceCancelAttempted = true;
        try {
            int status = callColdSource(2, null, null);
            if (status == 75) { sourceCancelConfirmed = true; sourceRequestPending = false; }
            return status; // Never clears UNKNOWN, rearms nonce/signing or releases another child.
        } catch (Throwable failure) { throw retainSourceFailure(failure); }
    }
    private int callColdSource(int operation, byte[][] inputs, byte[] bytes) throws Throwable {
        requireColdSourcePair(); active = true; sourceDispatchEntered = false;
        try {
            return borrow.withCleanup(() -> {
                try {
                    checkForNative(); int code;
                    sourceDispatchEntered = true; // Only an entered foreign call/postcheck can become an uncertain effect.
                    if (operation == 0) {
                        sourceNativeEntered = true; // Before actual dispatch; an escaping call remains unknown.
                        code = VeilOwnKeyPrivateCommand.nativeBeginColdSourceCurrent(context, this,
                            inputs[0], inputs[1], inputs[2], inputs[3], inputs[4], bytes);
                        rememberSourceStatus(code, 71);
                        if (code == 71) sourceRequestPending = true;
                    } else if (operation == 1) {
                        code = VeilOwnKeyPrivateCommand.nativeAcceptColdSourceCurrent(context, this, bytes);
                        rememberSourceStatus(code, 72);
                    } else if (operation == 2) {
                        code = VeilOwnKeyPrivateCommand.nativeCancelColdSourceCurrent(context, this);
                        rememberSourceStatus(code, 75);
                    } else throw new AssertionError();
                    checkForNative(); return code;
                } catch (Throwable failure) { throw propagate(retainSourceFailure(failure)); }
            });
        } catch (Throwable failure) {
            if (sourceDispatchEntered) sourceUnknown = true;
            throw retainSourceFailure(failure);
        } finally { sourceDispatchEntered = false; active = false; }
    }

    /** Normal owner close: children close first; actual cleanup disposes the pair.
     * Never reconcile/discharge just to close, nor replay an uncertain cleanup. */
    boolean closeForOwner() {
        worker(); if (retired) return true;
        if (ownerCloseFailure != null) throw propagate(ownerCloseFailure);
        if (active || !captured || sourceHoldsParent()) return false;
        try {
            if (!ownerCleanupAttempted) {
                ownerCleanupAttempted = true;
                ownerCleanupStatus = cleanup();
                if (ownerCleanupStatus == 182 || ownerCleanupStatus == 183) pairAuthenticated = false;
            }
            if (ownerCleanupStatus != 182 && ownerCleanupStatus != 183) return false;
            if (ownerReleaseAttempted) return false;
            ownerReleaseAttempted = true;
            return release() == 184 && retired;
        } catch (Throwable t) { retain(t); ownerCloseFailure = primary; throw propagate(ownerCloseFailure); }
    }

    int begin() { return dispatch(0); }
    int observe() { return dispatch(1); }
    int reconcile() { return dispatch(2); }
    int discharge() { return dispatch(3); }
    int cleanup() { return dispatch(4); }
    int release() { return dispatch(5); }
    private int dispatch(int operation) {
        worker();
        if (retired && operation == 5) return 184; // original Java receipt, no JNI/effect
        if (active || released || !captured) throw new IllegalStateException("COLD_DISPATCH_LIFETIME");
        if (operation >= 2 && sourceHoldsParent()) throw new IllegalStateException("COLD_SOURCE_CHILD_PENDING_OR_UNKNOWN");
        if (operation == 0 && beginAttempted) throw new IllegalStateException("COLD_BEGIN_ONCE");
        if (operation != 0 && !beginAttempted) throw new IllegalStateException("COLD_BEGIN_REQUIRED");
        if ((operation == 0 || operation == 2 || operation == 3) && (primary != null || nativeFailureRetained))
            throw propagate(primary != null ? primary : new IllegalStateException("COLD_FIRST_NATIVE_FAILURE_RETAINED"));
        if (operation == 5 && releaseFailure != null) throw propagate(releaseFailure);
        try {
            if (VeilOwnKeyPrivateCommand.nativeColdRecoveryAbiVersion() != 1)
                throw new GeneralSecurityException("COLD_ABI_REQUIRED");
            if (operation == 0) requirePairABI();
            active = true;
            return borrow.withCleanup(() -> {
                try {
                    checkForNative();
                    if (operation == 0) { beginAttempted = true; borrow.markNativeAttempted(); }
                    int status;
                    switch (operation) {
                        case 0: status = VeilOwnKeyPrivateCommand.nativeBeginColdInitialPrekeysRecovery(context, this); break;
                        case 1: status = VeilOwnKeyPrivateCommand.nativeObserveColdRecovery(context, this); break;
                        case 2: status = VeilOwnKeyPrivateCommand.nativeReconcileColdRecovery(context, this); break;
                        case 3: status = VeilOwnKeyPrivateCommand.nativeDischargeColdRecovery(context, this); break;
                        case 4: status = VeilOwnKeyPrivateCommand.nativeCleanupColdRecovery(context, this); break;
                        case 5: status = VeilOwnKeyPrivateCommand.nativeReleaseColdRecovery(context, this); break;
                        default: throw new AssertionError();
                    }
                    lastStatus = status;
                    if (status < 180 || status > 184) { if (!nativeFailureRetained) { firstNativeFailure = status; nativeFailureRetained = true; } }
                    if (operation == 5 && status == 184 && released) retired = true;
                    else if (!released) checkForNative();
                    else throw new GeneralSecurityException("COLD_RETIREMENT_UNCONFIRMED");
                    return status;
                } catch (Throwable t) { retain(t); throw propagate(t); }
            });
        } catch (Throwable t) { retain(t); throw propagate(t); }
        finally { active = false; }
    }
}
