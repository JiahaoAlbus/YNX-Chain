package com.ynx.social.matrix;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.ecc.ECPublicKey;
import org.signal.libsignal.protocol.message.CiphertextMessage;

/** Public-only boundary probe. Does not create private keys, sessions, or approvals. */
public final class VeilContextEncodingCheck {
  private interface Action { void run() throws Exception; }
  private static final class Port implements VeilRecordTransaction {
    int reads;
    public void checkLive() {}
    public byte[] read(VeilRecordKind kind, String id) { reads++; return null; }
    public void write(VeilRecordKind kind, String id, byte[] bytes) { throw new AssertionError("write"); }
    public void remove(VeilRecordKind kind, String id) { throw new AssertionError("remove"); }
    public List<String> ids(VeilRecordKind kind) { throw new AssertionError("ids"); }
  }
  private static void rejects(Action action) throws Exception {
    try { action.run(); } catch (IllegalArgumentException error) {
      if (!"VEIL_CONTEXT_UTF8_INVALID".equals(error.getMessage())) throw error;
      return;
    }
    throw new AssertionError("invalid UTF16 accepted");
  }
  private static void require(boolean condition, String name) {
    if (!condition) throw new AssertionError(name); System.out.println("PASS " + name);
  }
  public static void main(String[] args) throws Exception {
    byte[] publicBytes = new byte[33]; publicBytes[0] = 5; publicBytes[1] = 9;
    IdentityKey own = new IdentityKey(new ECPublicKey(publicBytes));
    publicBytes[1] = 10;
    IdentityKey peer = new IdentityKey(new ECPublicKey(publicBytes));
    SignalProtocolAddress local = new SignalProtocolAddress("sender.public", 1);
    SignalProtocolAddress remote = new SignalProtocolAddress("receiver.public", 2);
    UUID operation = UUID.fromString("44444444-4444-4444-8444-444444444444");
    Method fingerprint = VeilSignalOutbox.class.getDeclaredMethod("requestFingerprint",
        SignalProtocolAddress.class, SignalProtocolAddress.class, UUID.class, String.class,
        IdentityKey.class, IdentityKey.class, byte[].class);
    fingerprint.setAccessible(true);
    String[] invalid = { "\uD800", "\uD801", "\uDC00", "prefix\uD800", "\uD800x", "x\uDC00" };
    for (String bad : invalid) {
      Port outbox = new Port();
      rejects(() -> VeilSignalOutbox.encryptInTransaction(outbox, own, local, operation, bad, remote, new byte[] { 1 }));
      require(outbox.reads == 0, "invalid send conversation rejected before protected reads");
      Port inbox = new Port();
      rejects(() -> VeilSignalInbox.decryptInTransaction(inbox, own, local, operation, bad, remote,
          CiphertextMessage.PREKEY_TYPE, new byte[] { 1 }));
      require(inbox.reads == 0, "invalid receive conversation rejected before protected reads");
      rejects(() -> {
        try { fingerprint.invoke(null, local, remote, operation, bad, own, peer, new byte[] { 1 }); }
        catch (InvocationTargetException error) {
          if (error.getCause() instanceof IllegalArgumentException rejected) throw rejected;
          throw error;
        }
      });
    }
    String valid = "room-\u623f\u95f4-\uD83D\uDE80-\u00e9";
    require(Arrays.equals(VeilContextEncoding.encode(valid), valid.getBytes(StandardCharsets.UTF_8)),
        "legitimate Unicode and emoji retain exact UTF8 bytes");
    byte[] composed = (byte[]) fingerprint.invoke(null, local, remote, operation, "\u00e9", own, peer, new byte[] { 1 });
    byte[] decomposed = (byte[]) fingerprint.invoke(null, local, remote, operation, "e\u0301", own, peer, new byte[] { 1 });
    require(!Arrays.equals(composed, decomposed), "different legitimate strings remain distinct without normalization");
    SignalProtocolAddress unicodePeer = new SignalProtocolAddress("\u8282\u70b9.\uD83D\uDE80", 3);
    VeilContextEncoding.validateAddress(unicodePeer);
    require(Arrays.equals(VeilContextEncoding.encode(unicodePeer.toString()), unicodePeer.toString().getBytes(StandardCharsets.UTF_8)),
        "legitimate Unicode dotted SDK address remains supported");
    SignalProtocolAddress badPeer = new SignalProtocolAddress("receiver.\uD800", 3);
    require(!"receiver.\uD800".equals(badPeer.getName()),
        "actual SDK constructor already loses malformed raw name before typed consumer");
    Port badAddress = new Port();
    rejects(() -> VeilSignalAddress.of("receiver.\uD800", 3));
    require(badAddress.reads == 0, "production raw-name wrapper rejects before SDK construction or protected read");
    VeilSignalAddress validAddress = VeilSignalAddress.of("\u8282\u70b9.\uD83D\uDE80", 3);
    require(validAddress.sdk().getName().equals(unicodePeer.getName()),
        "production pre-SDK wrapper preserves valid Unicode dotted name");
    Port validContext = new Port();
    try {
      VeilSignalOutbox.encryptInTransaction(validContext, own, local, operation, valid, unicodePeer, new byte[] { 1 });
      throw new AssertionError("missing local approval accepted");
    } catch (IllegalStateException error) {
      if (!"VEIL_LOCAL_ADDRESS_NOT_ADMITTED".equals(error.getMessage())) throw error;
    }
    require(validContext.reads == 1, "valid Unicode context reaches normal missing-admission boundary");
    System.out.println("PASS strict UTF8 send/receive/address/fingerprint probes; public-only keyless controlled port");
  }
}
