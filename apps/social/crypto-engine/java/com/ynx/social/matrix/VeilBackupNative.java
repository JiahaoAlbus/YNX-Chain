package com.ynx.social.matrix;

import java.util.Arrays;
import java.util.Objects;
import org.signal.libsignal.protocol.IdentityKey;

/** Dormant package-private codec. The native owner loads its admitted library.
 * No Expo export, password String, library downloader, restore effect or grant.
 * Caller must obtain context/pin/observer from the independent native authority.
 */
final class VeilBackupNative {
  private VeilBackupNative() {}
  private static native String sodiumVersion();
  private static native byte[] sealImage(byte[] image, byte[] password, byte[] context);
  private static native byte[] openImage(byte[] backup, byte[] password, byte[] context);

  static byte[] seal(VeilRecordTransaction tx, IdentityKey own, byte[] password,
      byte[] externalContext, Runnable current) {
    Objects.requireNonNull(current);
    byte[][] copies = inputs(password, externalContext);
    byte[] clear = null, sealed = null;
    try {
      current.run(); requireNative();
      try (var image = VeilSignalRecordSnapshot.capture(tx, own)) {
        clear = image.bytesForNativeSealer();
        current.run(); tx.checkLive();
        sealed = sealImage(clear, copies[0], copies[1]);
        current.run(); tx.checkLive();
        return sealed;
      }
    } catch (UnsatisfiedLinkError error) {
      if (sealed != null) Arrays.fill(sealed, (byte) 0);
      throw unavailable();
    } catch (RuntimeException | Error error) {
      if (sealed != null) Arrays.fill(sealed, (byte) 0);
      throw error;
    } finally { wipe(clear); wipe(copies[0]); wipe(copies[1]); }
  }

  static VeilSignalRecordSnapshot openForStaging(byte[] backup, IdentityKey own,
      byte[] password, byte[] externalContext, Runnable current) {
    Objects.requireNonNull(backup); Objects.requireNonNull(own); Objects.requireNonNull(current);
    if (backup.length < 129 || backup.length > VeilSignalRecordSnapshot.MAX_BYTES + 128)
      throw new IllegalStateException("VEIL_BACKUP_IMAGE_SIZE_REJECTED");
    byte[][] copies = inputs(password, externalContext);
    byte[] input = backup.clone(), clear = null;
    VeilSignalRecordSnapshot staged = null;
    try {
      current.run(); requireNative();
      clear = openImage(input, copies[0], copies[1]);
      current.run();
      staged = VeilSignalRecordSnapshot.stageImport(clear, own, current);
      current.run();
      return staged;
    } catch (UnsatisfiedLinkError error) {
      if (staged != null) staged.close();
      throw unavailable();
    } catch (RuntimeException | Error error) {
      if (staged != null) staged.close();
      throw error;
    } finally { wipe(input); wipe(clear); wipe(copies[0]); wipe(copies[1]); }
  }
  private static byte[][] inputs(byte[] password, byte[] context) {
    Objects.requireNonNull(password); Objects.requireNonNull(context);
    if (password.length < 1 || password.length > 1024 || context.length != 32)
      throw new IllegalStateException("VEIL_BACKUP_INPUT_REJECTED");
    return new byte[][] {password.clone(), context.clone()};
  }
  private static void requireNative() {
    if (!"1.0.22".equals(sodiumVersion())) throw new IllegalStateException("VEIL_BACKUP_SODIUM_VERSION_REJECTED");
  }
  private static IllegalStateException unavailable() { return new IllegalStateException("VEIL_BACKUP_NATIVE_UNAVAILABLE"); }
  private static void wipe(byte[] bytes) { if (bytes != null) Arrays.fill(bytes, (byte) 0); }
}
