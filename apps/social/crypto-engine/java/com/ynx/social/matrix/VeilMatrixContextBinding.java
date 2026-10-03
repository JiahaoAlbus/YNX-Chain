package com.ynx.social.matrix;

import java.util.Arrays;
import java.util.UUID;

/** Protected equality binding, NOT a trust producer or cryptographic proof.
 * Native pipeline computes expected only from independently admitted context. */
final class VeilMatrixContextBinding {
  static void require(VeilRecordTransaction tx, UUID operation, byte[] expected, boolean preparing) {
    VeilAuthenticatedEnvelope.validateId(operation);
    if (expected == null || expected.length != 32) throw VeilAuthenticatedEnvelope.fail("VEIL_ENVELOPE_INVALID");
    byte[] snapshot = expected.clone();
    byte[] saved = null;
    try {
      tx.checkLive();
      String key = "matrix-v2-context:" + operation;
      saved = tx.read(VeilRecordKind.OUTBOX, key);
      if (saved == null) {
        if (!preparing) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
        byte[] journal = tx.read(VeilRecordKind.OUTBOX, "matrix-v2:" + operation);
        if (journal != null) {
          Arrays.fill(journal, (byte) 0);
          throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
        }
        tx.checkLive(); tx.write(VeilRecordKind.OUTBOX, key, snapshot);
      } else {
        if (saved.length != 32) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
        if (!Arrays.equals(saved, snapshot)) throw VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
      }
      tx.checkLive();
    } finally {
      Arrays.fill(snapshot, (byte) 0);
      if (saved != null) Arrays.fill(saved, (byte) 0);
    }
  }
}
