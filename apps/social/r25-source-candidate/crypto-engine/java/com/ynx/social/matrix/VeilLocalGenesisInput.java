package com.ynx.social.matrix;

import java.security.GeneralSecurityException;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/* PRIVATE normal pre-device storage intent, never a SourceWitness/device grant.
 * The original normal producer supplies its retained local intent association;
 * this class freezes those exact PUBLIC bytes, not a new signed/authority tuple.
 * No secret, mode switch, subject claim, accepted flag or public getter exists.
 */
final class VeilLocalGenesisInput {
    private final Thread owner;
    private final String alias;
    private final long storageGeneration;
    private final byte[] originalAssociation;
    private final int authWindowSeconds;
    private final int initializationProfile;
    private VeilOwnKeyPrivateCommand submittingCommand;
    private boolean released;

    // Existing local recovery metadata only; normal NEW initialization uses
    // the explicit typed profile below, never this old two-record profile.
    VeilLocalGenesisInput(String originalAlias, long originalGeneration,
            byte[] originalAssociationBytes, int authenticatedWindowSeconds)
            throws GeneralSecurityException {
        this(originalAlias, originalGeneration, originalAssociationBytes, authenticatedWindowSeconds, 1);
    }

    static VeilLocalGenesisInput initialPrekeys(String originalAlias, long originalGeneration,
            byte[] originalAssociationBytes, int authenticatedWindowSeconds)
            throws GeneralSecurityException {
        return new VeilLocalGenesisInput(originalAlias, originalGeneration,
                originalAssociationBytes, authenticatedWindowSeconds, 2);
    }

    private VeilLocalGenesisInput(String originalAlias, long originalGeneration,
            byte[] originalAssociationBytes, int authenticatedWindowSeconds, int profile)
            throws GeneralSecurityException {
        if (originalAlias == null || !originalAlias.matches("ynx\\.social\\.ownkey\\.v1\\.[0-9a-f]{32}"))
            throw new GeneralSecurityException("LOCAL_GENESIS_ALIAS");
        if (originalGeneration < 1)
            throw new GeneralSecurityException("LOCAL_GENESIS_STORAGE_GENERATION");
        if (originalAssociationBytes == null || originalAssociationBytes.length < 1 ||
                originalAssociationBytes.length > 4096)
            throw new GeneralSecurityException("LOCAL_GENESIS_ASSOCIATION_BOUNDS");
        if (authenticatedWindowSeconds < 1 || authenticatedWindowSeconds > 120)
            throw new GeneralSecurityException("LOCAL_GENESIS_AUTH_WINDOW");
        if (profile != 1 && profile != 2)
            throw new GeneralSecurityException("LOCAL_GENESIS_PROFILE");
        if (profile == 2) validateInitialAssociation(originalAssociationBytes, originalAlias,
                originalGeneration, authenticatedWindowSeconds);
        initializationProfile = profile;
        owner = Thread.currentThread();
        alias = originalAlias;
        storageGeneration = originalGeneration;
        authWindowSeconds = authenticatedWindowSeconds;
        // Last potentially failing construction step; no later allocation/hook.
        originalAssociation = originalAssociationBytes.clone();
    }

    private void requireOwner() throws GeneralSecurityException {
        if (Thread.currentThread() != owner)
            throw new GeneralSecurityException("LOCAL_GENESIS_WRONG_WORKER");
        if (released)
            throw new GeneralSecurityException("LOCAL_GENESIS_INPUT_RELEASED");
    }

    // Existing-only reconciliation may compare the original PUBLIC metadata
    // after genesis failed, without reopening genesis admission or its effects.
    void requireRecoveryExpectations(VeilOwnKeyPrivateCommand command, String candidateAlias,
            long candidateGeneration, byte[] candidateAssociation) throws GeneralSecurityException {
        requireOwner();
        if (submittingCommand != command || command == null || !alias.equals(candidateAlias)
                || storageGeneration != candidateGeneration || !Arrays.equals(originalAssociation, candidateAssociation))
            throw new GeneralSecurityException("LOCAL_RECOVERY_GENESIS_MISMATCH");
    }

    // Normal command claims once before JNI. This is lifecycle, NOT authority.
    void claimForSubmission(VeilOwnKeyPrivateCommand command) throws GeneralSecurityException {
        requireOwner();
        if (command == null || submittingCommand != null)
            throw new GeneralSecurityException("LOCAL_GENESIS_INPUT_ALREADY_SUBMITTED");
        submittingCommand = command;
    }

    // Actual JNI consumer calls this private method before reading fields/copy.
    private void requireSubmitted() throws GeneralSecurityException {
        requireOwner();
        if (submittingCommand == null)
            throw new GeneralSecurityException("LOCAL_GENESIS_INPUT_NOT_SUBMITTED");
        submittingCommand.requireNativeAdmission(this);
    }

    // JNI calls this exact private method on the actual retained input before
    // capturing fields. A profile marker is only intent, NEVER authorization.
    private void requireSubmittedInitialPrekeys() throws GeneralSecurityException {
        requireSubmitted();
        if (initializationProfile != 2)
            throw new GeneralSecurityException("LOCAL_GENESIS_INITIAL_PREKEYS_PROFILE_REQUIRED");
    }

    void requireInitialPrekeysForSubmittedCommand(VeilOwnKeyPrivateCommand command)
            throws GeneralSecurityException {
        requireSubmittedInitialPrekeys();
        if (submittingCommand != command)
            throw new GeneralSecurityException("LOCAL_GENESIS_FOREIGN_COMMAND");
    }

    private static String associationText(DataInputStream input, int maximum) throws IOException {
        int length = input.readInt();
        if (length < 1 || length > maximum || input.available() < length)
            throw new IOException("INITIAL_ASSOCIATION_BOUNDS");
        byte[] bytes = new byte[length];
        input.readFully(bytes);
        for (byte value : bytes) if (value < 33 || value > 126)
            throw new IOException("INITIAL_ASSOCIATION_ASCII");
        return new String(bytes, StandardCharsets.US_ASCII);
    }

    private static void validateInitialAssociation(byte[] bytes, String alias, long generation, int window)
            throws GeneralSecurityException {
        try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(bytes))) {
            if (!associationText(input, 128).equals("YNX/SOCIAL/LOCAL-GENESIS-INITIAL-PREKEYS-INTENT/V2")
                    || input.readInt() != 2) throw new IOException("INITIAL_ASSOCIATION_PROFILE");
            associationText(input, 128); // original local slot DATA, not a Signal device slot
            String intent = associationText(input, 32);
            if (!intent.matches("[0-9a-f]{32}") || !alias.equals("ynx.social.ownkey.v1." + intent)
                    || !associationText(input, 128).equals(alias) || input.readLong() != generation
                    || input.readInt() != window || input.available() != 0)
                throw new IOException("INITIAL_ASSOCIATION_ORIGINAL");
        } catch (IOException error) {
            throw new GeneralSecurityException("LOCAL_GENESIS_INITIAL_ASSOCIATION", error);
        }
    }

    String aliasForSubmittedCommand(VeilOwnKeyPrivateCommand command) throws GeneralSecurityException {
        requireSubmitted();
        if (submittingCommand != command)
            throw new GeneralSecurityException("LOCAL_GENESIS_FOREIGN_COMMAND");
        return alias;
    }

    long generationForSubmittedCommand(VeilOwnKeyPrivateCommand command) throws GeneralSecurityException {
        requireSubmitted();
        if (submittingCommand != command)
            throw new GeneralSecurityException("LOCAL_GENESIS_FOREIGN_COMMAND");
        return storageGeneration;
    }

    // Cancellation BEFORE JNI only. Submitted input stays held with original
    // command/native owner, including failure/UNKNOWN; no blanket dispose API.
    void cancelBeforeSubmission() throws GeneralSecurityException {
        requireOwner();
        if (submittingCommand != null)
            throw new GeneralSecurityException("LOCAL_GENESIS_SUBMITTED_INPUT_RETAINED");
        Arrays.fill(originalAssociation, (byte)0);
        released = true;
    }
}
