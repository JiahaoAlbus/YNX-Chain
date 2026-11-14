package com.ynx.social.matrix;

import java.util.Arrays;

/** Native-package-only bridge. No JS key export, implicit library load or admission. */
final class VeilAttachmentNative {
  static final int MAX_BYTES = 25 * 1024 * 1024;
  static final int MAX_WIRE = 35 + MAX_BYTES + 400 * 21;
  private static native String sodiumVersion();
  private static native byte[] freshKey();
  private static native byte[] sealImage(byte[] key, byte[] aad, byte[] clear);
  private static native byte[] openImage(byte[] key, byte[] aad, byte[] wire);
  private static void available() {
    if (!"1.0.22".equals(sodiumVersion())) throw new IllegalStateException("VEIL_ATTACHMENT_SODIUM_VERSION_REJECTED");
  }
  static byte[] key(VeilRecordTransaction tx) {
    tx.checkLive(); available();
    byte[] key = freshKey();
    try {
      if (key == null || key.length != 32) throw new IllegalStateException("VEIL_ATTACHMENT_OUTPUT_REJECTED");
      tx.checkLive(); return key;
    } catch (Throwable failure) { if (key != null) Arrays.fill(key, (byte)0); throw failure; }
  }
  static byte[] seal(VeilRecordTransaction tx, byte[] key, byte[] aad, byte[] body) {
    return transform(tx, key, aad, body, false);
  }
  static byte[] open(VeilRecordTransaction tx, byte[] key, byte[] aad, byte[] wire) {
    return transform(tx, key, aad, wire, true);
  }
  private static byte[] transform(VeilRecordTransaction tx, byte[] key, byte[] aad, byte[] input, boolean opening) {
    tx.checkLive();
    if (key == null || key.length != 32 || aad == null || aad.length < 1 || aad.length > 4096 ||
        input == null || input.length < 1 || input.length > (opening ? MAX_WIRE : MAX_BYTES))
      throw new IllegalArgumentException("VEIL_ATTACHMENT_INPUT_REJECTED");
    byte[] secret = key.clone(), context = aad.clone(), snapshot = input.clone(), result = null;
    try {
      available(); tx.checkLive();
      result = opening ? openImage(secret, context, snapshot) : sealImage(secret, context, snapshot);
      if (result == null || result.length < 1 || result.length > (opening ? MAX_BYTES : MAX_WIRE))
        throw new IllegalStateException("VEIL_ATTACHMENT_OUTPUT_REJECTED");
      tx.checkLive(); return result;
    } catch (Throwable failure) {
      if (result != null) Arrays.fill(result, (byte)0);
      throw failure;
    } finally {
      Arrays.fill(secret, (byte)0); Arrays.fill(context, (byte)0); Arrays.fill(snapshot, (byte)0);
    }
  }
}
