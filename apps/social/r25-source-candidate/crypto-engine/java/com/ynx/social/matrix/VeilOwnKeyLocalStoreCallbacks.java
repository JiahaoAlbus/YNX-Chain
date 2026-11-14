package com.ynx.social.matrix;

import java.security.GeneralSecurityException;

/* Private synchronous adapter only. Code 44 denotes local reservation coherence,
 * not a grant or evidence of a C ticket. Native checks C2/non-null ticket after
 * the sidecar postcheck, before RNG/seal. No native LOCAL borrow across Java. */
final class VeilOwnKeyLocalStoreCallbacks implements
        VeilOwnKeyLocalStoreContext.SubmittedCheck, VeilOwnKeyLocalStoreContext.PathUse {
    private static final int STORE_CALLBACK_ABI = 1;
    private static final int LOCAL_RESERVED_COHERENT = 44;
    private final VeilOwnKeyPrivateCommand command;
    private final VeilLocalGenesisInput input;
    private boolean pathActive;
    private boolean pathAttempted;

    VeilOwnKeyLocalStoreCallbacks(VeilOwnKeyPrivateCommand original,
            VeilLocalGenesisInput originalInput) throws GeneralSecurityException {
        original.requireNativeAdmission(originalInput);
        command = original;
        input = originalInput;
        if (nativeStoreCallbackAbiVersion() != STORE_CALLBACK_ABI)
            throw new LinkageError("LOCAL_STORE_CALLBACK_ABI_MISMATCH");
    }

    public void revalidate() throws Throwable {
        command.requireNativeAdmission(input);
        int status = nativeRevalidate();
        if (status != LOCAL_RESERVED_COHERENT) {
            command.retainStoreCallbackFailure(status);
            throw new GeneralSecurityException("LOCAL_STORE_NATIVE_REVALIDATION_RETAINED");
        }
        command.requireNativeAdmission(input);
    }

    public void use(String databasePath) throws Throwable {
        command.requireNativeAdmission(input);
        if (pathAttempted || pathActive)
            throw new GeneralSecurityException("LOCAL_STORE_PATH_ONCE_OR_REENTRY");
        pathAttempted = true;
        pathActive = true;
        try {
            revalidate();
            command.beforeNativeStoreReservation();
            int status = nativeReserveDatabase(databasePath);
            command.afterNativeStoreReservation();
            if (status != LOCAL_RESERVED_COHERENT) {
                command.retainStoreCallbackFailure(status);
                throw new GeneralSecurityException("LOCAL_STORE_NATIVE_RESERVE_RETAINED");
            }
            revalidate();
        } catch (Throwable failure) {
            command.retainStoreCallbackPrimary(failure);
            throw failure;
        } finally { pathActive = false; }
        // No path retention/export, RNG, signature, or acceptance here.
    }

    private static native int nativeStoreCallbackAbiVersion();
    private native int nativeRevalidate();
    private native int nativeReserveDatabase(String databasePath);
}
