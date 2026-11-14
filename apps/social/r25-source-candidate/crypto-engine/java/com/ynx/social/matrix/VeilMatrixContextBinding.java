package com.ynx.social.matrix;

import java.util.Arrays;
import java.util.UUID;
import java.nio.ByteBuffer;
import java.security.MessageDigest;

/** Protected equality binding, NOT a trust producer or cryptographic proof.
 * Native pipeline computes expected only from independently admitted context. */
final class VeilMatrixContextBinding {
  static void require(VeilRecordTransaction tx, UUID operation, byte[] expected,
      long nativeGeneration, VeilMatrixJournal.Scope routing, boolean preparing) {
    VeilAuthenticatedEnvelope.validateId(operation);
    if (expected == null || expected.length != 32) throw VeilAuthenticatedEnvelope.fail("VEIL_ENVELOPE_INVALID");
    // Unsigned64 bit pattern; zero is not an independently admitted generation.
    // This numeric field is DATA, not a producer proof. Never use process epoch.
    if (nativeGeneration == 0 || routing == null) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    byte[] snapshot = binding(expected, nativeGeneration, routing);
    byte[] saved = null;
    try {
      tx.checkLive();
      String key = "matrix-v2-context:" + operation;
      saved = tx.read(VeilRecordKind.OUTBOX, key);
      if (saved == null) {
        if (!preparing) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
        // Only a genuinely fresh operation may establish the binding. An old
        // cipher/journal without it must not be adopted into today's generation.
        requireAbsent(tx, "matrix-v2:" + operation);
        requireAbsent(tx, "signal:" + operation);
        tx.checkLive(); tx.write(VeilRecordKind.OUTBOX, key, snapshot);
      } else {
        // Includes legacy32-byte fingerprints: retain exact old bytes, no rewrite.
        if (saved.length != 76 || ByteBuffer.wrap(saved).getInt() != 0x564d5833
            || ByteBuffer.wrap(saved).getLong(4) == 0) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
        if (!Arrays.equals(saved, snapshot)) throw VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
        requirePresent(tx, "signal:" + operation);
        requirePresent(tx, "matrix-v2:" + operation);
      }
      tx.checkLive();
    } finally {
      Arrays.fill(snapshot, (byte) 0);
      if (saved != null) Arrays.fill(saved, (byte) 0);
    }
  }
  private static void requireAbsent(VeilRecordTransaction tx, String key) {
    tx.checkLive(); byte[] value = tx.read(VeilRecordKind.OUTBOX, key);
    if (value != null) {
      Arrays.fill(value, (byte) 0);
      throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
    }
  }
  private static void requirePresent(VeilRecordTransaction tx, String key) {
    tx.checkLive(); byte[] value = tx.read(VeilRecordKind.OUTBOX, key);
    if (value == null) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
    Arrays.fill(value, (byte) 0);
  }
  private static byte[] binding(byte[] context, long generation, VeilMatrixJournal.Scope routing) {
    try {
      MessageDigest sha = MessageDigest.getInstance("SHA-256");
      // Equality digest over immutable reviewed routing fields, NOT a KDF/AAD
      // or a replacement for native authenticated routing/generation authority.
      for (String field : new String[] {routing.homeserver, routing.self, routing.peer, routing.room}) {
        byte[] bytes = VeilAuthenticatedEnvelope.text(field, 2048);
        sha.update(ByteBuffer.allocate(4).putInt(bytes.length).array()); sha.update(bytes);
        Arrays.fill(bytes, (byte) 0);
      }
      return ByteBuffer.allocate(76).putInt(0x564d5833).putLong(generation).put(context).put(sha.digest()).array();
    } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }
}
