package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;

/* Strict PUBLIC FD2 DATA only, not permission, a commit witness or a signing
 * capability. Actual JNI/custody must verify C5/current before exporting it. */
final class VeilInitialRegistrationProposalData {
    static final int SIZE = 2737;
    private static final byte[] MAGIC = "YNXFDP02".getBytes(StandardCharsets.US_ASCII);
    private final byte[] original;
    private final byte[] proposalDigest;
    private VeilInitialRegistrationProposalData(byte[] owned) throws GeneralSecurityException {
        original = owned;
        proposalDigest = MessageDigest.getInstance("SHA-256").digest(owned);
    }
    static VeilInitialRegistrationProposalData decode(byte[] input) throws GeneralSecurityException {
        if (input == null || input.length != SIZE) throw new GeneralSecurityException("FD2_EXACT_SIZE");
        byte[] owned = input.clone();
        if (!Arrays.equals(Arrays.copyOfRange(owned, 0, 8), MAGIC))
            throw new GeneralSecurityException("FD2_MAGIC");
        if (!nonzero(owned,8,24) || !nonzero(owned,24,40))
            throw new GeneralSecurityException("FD2_ORIGINAL_IDS");
        ByteBuffer fields = ByteBuffer.wrap(owned).order(ByteOrder.BIG_ENDIAN);
        int registration = fields.getInt(40), device = fields.getInt(44);
        if (registration < 1 || registration > 16380 || device < 1 || device > 127)
            throw new GeneralSecurityException("FD2_SIGNAL_PARAMETER_BOUNDS");
        if (owned[48] != 5 || !nonzero(owned,81,2673)
                || !Arrays.equals(Arrays.copyOfRange(owned,8,40), Arrays.copyOfRange(owned,2673,2705))
                || !nonzero(owned,2705,2737))
            throw new GeneralSecurityException("FD2_PUBLIC_BINDING");
        return new VeilInitialRegistrationProposalData(owned);
    }
    private static boolean nonzero(byte[] input, int start, int end) {
        int combined = 0;
        for (int i = start; i < end; i++) combined |= input[i];
        return combined != 0;
    }
    byte[] encodedCopy() { return original.clone(); }
    byte[] originalIds() { return Arrays.copyOfRange(original,8,40); }
    byte[] registrationBytes() { return Arrays.copyOfRange(original,40,44); }
    byte[] deviceBytes() { return Arrays.copyOfRange(original,44,48); }
    byte[] publicPair() { return Arrays.copyOfRange(original,48,2705); }
    byte[] bundleDigest() { return Arrays.copyOfRange(original,2705,2737); }
    // Deliberately not named requestDigest: qualified Source original.request
    // digest belongs to its existing independent native owner, not this codec.
    byte[] proposalDigest() { return proposalDigest.clone(); }
    @Override public String toString() { return "InitialRegistrationProposalData[untrusted-public-data]"; }
}
