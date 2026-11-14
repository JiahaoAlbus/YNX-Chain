package com.ynx.social.matrix;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/** Owns the original bounded stream; recheck validates independent native admission. */
final class VeilMatrixAttachmentRead {
  private VeilMatrixAttachmentRead() {}
  static byte[] readExact(InputStream input, int expected, Runnable recheck) throws IOException {
    if (input == null) throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_STREAM_UNAVAILABLE");
    byte[] candidate = null;
    try {
      try (InputStream owned = input) {
        if (recheck == null) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
        recheck.run();
        if (expected < 1 || expected > VeilAttachmentNative.MAX_WIRE)
          throw VeilAuthenticatedEnvelope.fail("VEIL_ATTACHMENT_INPUT_REJECTED");
        candidate = new byte[expected];
        int offset = 0;
        while (offset < expected) {
          recheck.run();
          int count = Math.min(8192, expected - offset);
          int received = owned.read(candidate, offset, count);
          recheck.run();
          if (received < 0) throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_SIZE_MISMATCH");
          if (received == 0 || received > count)
            throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_STREAM_NO_PROGRESS");
          offset += received;
        }
        recheck.run();
        int extra = owned.read();
        recheck.run();
        if (extra != -1) throw VeilAuthenticatedEnvelope.fail("VEIL_CIPHER_SIZE_MISMATCH");
      }
      recheck.run();
      return candidate;
    } catch (IOException | RuntimeException | Error failure) {
      if (candidate != null) Arrays.fill(candidate, (byte) 0);
      throw failure;
    }
  }
}
