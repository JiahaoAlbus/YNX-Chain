package com.ynx.social.matrix;

import java.security.GeneralSecurityException;

/** Private immutable public expectations for existing-only lookup. Not a
 * restored Original, authority, authentication receipt or fresh-key request. */
final class VeilLocalRecoveryInput {
    private final Thread owner = Thread.currentThread();
    private final String alias;
    private final long storageGeneration;
    private final byte[] originalAssociation;
    private final byte[] originalOperationAndIncarnation;
    private final int protectorMode = 3;
    private final int authWindowSeconds = 0;
    private final VeilOwnKeyPrivateCommand originalCommand;
    private final VeilOwnKeyLocalStoreContext.SubmittedCheck originalRecordCheck;
    private boolean submitted;

    VeilLocalRecoveryInput(String originalAlias, long generation, byte[] association,
            byte[] nativeIds, VeilOwnKeyPrivateCommand command,
            VeilOwnKeyLocalStoreContext.SubmittedCheck recordCheck) throws GeneralSecurityException {
        validatePublicShape(originalAlias, generation, association, nativeIds);
        if (command == null || recordCheck == null)
            throw new GeneralSecurityException("LOCAL_RECOVERY_ORIGINAL_GUARD_REQUIRED");
        alias = originalAlias;
        storageGeneration = generation;
        originalCommand = command;
        originalRecordCheck = recordCheck;
        originalAssociation = association.clone();
        originalOperationAndIncarnation = nativeIds.clone();
    }

    static void validatePublicShape(String alias, long generation, byte[] association, byte[] ids)
            throws GeneralSecurityException {
        if (alias == null || !alias.matches("ynx\\.social\\.ownkey\\.v1\\.[0-9a-f]{32}"))
            throw new GeneralSecurityException("LOCAL_RECOVERY_ALIAS");
        if (generation < 1) throw new GeneralSecurityException("LOCAL_RECOVERY_GENERATION");
        if (association == null || association.length < 1 || association.length > 4096)
            throw new GeneralSecurityException("LOCAL_RECOVERY_ASSOCIATION");
        if (ids == null || ids.length != 32)
            throw new GeneralSecurityException("LOCAL_RECOVERY_NATIVE_IDS");
    }

    void revalidateOriginal(VeilOwnKeyPrivateCommand command) throws Throwable {
        if (Thread.currentThread() != owner || command != originalCommand)
            throw new GeneralSecurityException("LOCAL_RECOVERY_ORIGINAL_OR_WORKER");
        originalRecordCheck.revalidate();
        originalCommand.requireRecoveryExpectations(alias, storageGeneration, originalAssociation);
    }

    void claimForSubmission(VeilOwnKeyPrivateCommand command) throws Throwable {
        revalidateOriginal(command);
        if (submitted) throw new GeneralSecurityException("LOCAL_RECOVERY_ALREADY_SUBMITTED");
        submitted = true;
    }

    // Exact JNI pre/postcheck, private and never callable from JS.
    String aliasForRecoveryCommand(VeilOwnKeyPrivateCommand command) throws Throwable {
        revalidateOriginal(command);
        requireSubmitted();
        return alias;
    }

    long generationForRecoveryCommand(VeilOwnKeyPrivateCommand command) throws Throwable {
        revalidateOriginal(command);
        requireSubmitted();
        return storageGeneration;
    }

    private void requireSubmitted() throws Throwable {
        revalidateOriginal(originalCommand);
        if (!submitted) throw new GeneralSecurityException("LOCAL_RECOVERY_NOT_SUBMITTED");
        originalCommand.requireExistingRecoveryActive(this);
    }
}
