package com.ynx.social.matrix;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/** Native streaming primitive, not an SDK download or admission producer.
 * Owns/closes the input on all exits. Upstream must be genuinely streaming and
 * bounded too; wrapping an already buffered SDK byte[] does NOT qualify.
 * Recheck must validate current independent native admission/Matrix handle. */
final class VeilBoundedCipherRead {
  private static final int MAXIMUM = 2 * 1024 * 1024;
  private static final int CHUNK = 8192;

  static byte[] readExact(InputStream input, int expected, Runnable recheck) throws IOException {
    if (input == null) throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_STREAM_UNAVAILABLE");
    byte[] candidate = null;
    try {
      try (InputStream owned = input) {
        if (recheck == null) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
        recheck.run();
        if (expected < 1 || expected > MAXIMUM) throw VeilAuthenticatedEnvelope.fail("VEIL_ENVELOPE_INVALID");
        candidate = new byte[expected];
        int offset = 0;
        while (offset < expected) {
          recheck.run();
          int available = Math.min(CHUNK, expected - offset);
          int received = owned.read(candidate, offset, available);
          recheck.run();
          if (received < 0) throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_SIZE_MISMATCH");
          if (received == 0 || received > available) throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_STREAM_NO_PROGRESS");
          offset += received;
        }
        // Exactly one overflow probe; never drain the attacker-controlled tail.
        recheck.run();
        int extra = owned.read();
        recheck.run();
        if (extra != -1) throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_SIZE_MISMATCH");
      }
      // Stream closure can fail. Do not publish candidate until it succeeds.
      recheck.run();
      return candidate;
    } catch (IOException | RuntimeException | Error failure) {
      if (candidate != null) Arrays.fill(candidate, (byte) 0);
      throw failure;
    }
  }
}
