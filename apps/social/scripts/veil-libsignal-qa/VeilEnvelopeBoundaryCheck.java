package com.ynx.social.matrix;

import java.util.Arrays;
import java.util.UUID;
import org.signal.libsignal.protocol.IdentityKeyPair;

/** Codec-only boundary checks. No trust admission, device, or storage proof. */
public final class VeilEnvelopeBoundaryCheck {
  private static int checks;

  private static void require(boolean value, String label) {
    if (!value) throw new AssertionError(label);
    checks++;
  }

  private static void reject(Runnable action, String label) {
    try {
      action.run();
    } catch (IllegalStateException expected) {
      require(expected.getMessage() != null && expected.getMessage().startsWith("VEIL_"), label);
      return;
    }
    throw new AssertionError("accepted " + label);
  }

  private static VeilApplicationContext context(String route, String sender, int device) {
    return new VeilApplicationContext(route,
        new VeilApplicationContext.Device(sender, device,
            IdentityKeyPair.generate().getPublicKey().serialize(), -1L),
        new VeilApplicationContext.Device("bob", 2,
            IdentityKeyPair.generate().getPublicKey().serialize(), Long.MIN_VALUE), -1L);
  }

  public static void main(String[] args) {
    UUID id = UUID.fromString("12345678-1234-4234-9234-123456789abc");
    VeilApplicationContext original = context("trusted-route", "alice", 1);
    byte[] wire = VeilAuthenticatedEnvelope.encode(original, true, id, new byte[] {1, 2, 3});
    for (int length = 0; length < wire.length; length++) {
      byte[] truncated = Arrays.copyOf(wire, length);
      reject(() -> VeilAuthenticatedEnvelope.decode(truncated), "truncated prefix " + length);
    }
    System.out.println("PASS every incomplete byte prefix refuses");
    for (int extra = 1; extra <= 64; extra++) {
      byte[] extended = Arrays.copyOf(wire, wire.length + extra);
      reject(() -> VeilAuthenticatedEnvelope.decode(extended), "trailing bytes " + extra);
    }
    System.out.println("PASS all tested trailing lengths refuse");
    for (int control = 0; control <= 127; control++) {
      if (control > 31 && control != 127) continue;
      String bad = "prefix" + (char) control + "suffix";
      reject(() -> context(bad, "alice", 1), "route control");
      reject(() -> context("route", bad, 1), "name control");
    }
    reject(() -> context("", "alice", 1), "empty route");
    reject(() -> context("route", "", 1), "empty name");
    reject(() -> context("route", "alice", 0), "device zero");
    reject(() -> context("route", "alice", 128), "device above 127");
    reject(() -> context("x".repeat(513), "alice", 1), "route 513 bytes");
    reject(() -> context("route", "x".repeat(257), 1), "name 257 bytes");
    reject(() -> context("\u00e9".repeat(257), "alice", 1), "route UTF8 byte limit");
    reject(() -> context("route", "\u00e9".repeat(129), 1), "name UTF8 byte limit");
    reject(() -> context("route\ud800", "alice", 1), "unpaired surrogate");
    VeilApplicationContext largest = context("\u00e9".repeat(256), "\u00e9".repeat(128), 127);
    byte[] maximum = VeilAuthenticatedEnvelope.encode(largest, true, id, new byte[65536]);
    try (VeilAuthenticatedEnvelope.Decoded decoded = VeilAuthenticatedEnvelope.decode(maximum)) {
      decoded.match(largest, true);
      require(decoded.content().length == 65536, "maximum content");
    }
    reject(() -> VeilAuthenticatedEnvelope.encode(original, true, id, new byte[0]), "empty content");
    reject(() -> VeilAuthenticatedEnvelope.encode(original, true, id, new byte[65537]), "oversized content");
    reject(() -> VeilAuthenticatedEnvelope.decode(new byte[68 * 1024 + 1]), "oversized envelope");
    System.out.println("PASS byte caps, control characters, surrogate and device limits");

    int accepted = 0;
    int refused = 0;
    for (int index = 0; index < wire.length; index++) {
      for (int mask : new int[] {1, 16, 128, 255}) {
        byte[] changed = wire.clone();
        changed[index] ^= (byte) mask;
        try (VeilAuthenticatedEnvelope.Decoded decoded = VeilAuthenticatedEnvelope.decode(changed)) {
          byte[] encoded = VeilAuthenticatedEnvelope.encode(decoded.wire, true, decoded.messageId, decoded.content());
          require(Arrays.equals(changed, encoded), "accepted mutation must reencode exactly");
          accepted++;
        } catch (IllegalStateException expected) {
          require(expected.getMessage() != null && expected.getMessage().startsWith("VEIL_"), "typed mutation refusal");
          refused++;
        }
      }
    }
    require(accepted > 0 && refused > 0, "mutation set exercises both canonical acceptance and refusal");
    System.out.println("PASS structured single-byte mutations canonical=" + accepted + " refused=" + refused);
    System.out.println("PASS codec-only boundary assertions=" + checks + "; no provider/OS/activation proof");
  }
}
