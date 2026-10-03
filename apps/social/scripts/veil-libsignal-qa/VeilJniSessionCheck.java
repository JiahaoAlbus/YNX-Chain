// Upstream test adaptations: Copyright 2023 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
// Isolated desktop JNI QA, not Android/runtime or product activation evidence.
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.signal.libsignal.protocol.*;
import org.signal.libsignal.protocol.ecc.ECKeyPair;
import org.signal.libsignal.protocol.kem.KEMKeyPair;
import org.signal.libsignal.protocol.kem.KEMKeyType;
import org.signal.libsignal.protocol.message.*;
import org.signal.libsignal.protocol.state.*;
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore;

public final class VeilJniSessionCheck {
  private static final List<String> checks = new ArrayList<>();
  private static final SignalProtocolAddress ALICE = new SignalProtocolAddress("97d7967e-583d-4f76-bae2-d35a533c22b0", 1);
  private static final SignalProtocolAddress BOB = new SignalProtocolAddress("48ccf172-2a4e-4375-bd74-bfef525e5711", 1);
  private interface CheckedAction { void run() throws Exception; }

  private static final class PinnedStore extends InMemorySignalProtocolStore {
    private SignalProtocolAddress peer;
    private IdentityKey pinned;
    PinnedStore(int registration) { super(IdentityKeyPair.generate(), registration); }
    void pin(SignalProtocolAddress address, IdentityKey identity) {
      if (peer != null) throw new IllegalStateException("SyntheticPinAlreadySet");
      peer = address;
      pinned = identity;
      super.saveIdentity(address, identity);
    }
    @Override public boolean isTrustedIdentity(SignalProtocolAddress address, IdentityKey identity, IdentityKeyStore.Direction direction) {
      return peer != null && peer.equals(address) && pinned.equals(identity);
    }
    @Override public IdentityKeyStore.IdentityChange saveIdentity(SignalProtocolAddress address, IdentityKey identity) {
      if (!isTrustedIdentity(address, identity, IdentityKeyStore.Direction.SENDING)) throw new IllegalStateException("UntrustedSyntheticIdentity");
      return super.saveIdentity(address, identity);
    }
  }

  // Mirrors the pinned upstream PQXDHBundleFactory API, with fixed fixture IDs.
  private static PreKeyBundle bundle(PinnedStore store) throws Exception {
    ECKeyPair pre = ECKeyPair.generate();
    ECKeyPair signed = ECKeyPair.generate();
    KEMKeyPair kem = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
    byte[] signedSignature = store.getIdentityKeyPair().getPrivateKey().calculateSignature(signed.getPublicKey().serialize());
    byte[] kemSignature = store.getIdentityKeyPair().getPrivateKey().calculateSignature(kem.getPublicKey().serialize());
    store.storePreKey(11, new PreKeyRecord(11, pre));
    store.storeSignedPreKey(12, new SignedPreKeyRecord(12, System.currentTimeMillis(), signed, signedSignature));
    store.storeKyberPreKey(13, new KyberPreKeyRecord(13, System.currentTimeMillis(), kem, kemSignature));
    return new PreKeyBundle(store.getLocalRegistrationId(), 1, 11, pre.getPublicKey(), 12,
        signed.getPublicKey(), signedSignature, store.getIdentityKeyPair().getPublicKey(),
        13, kem.getPublicKey(), kemSignature);
  }
  private static byte[] body(String id) { return ("YNX isolated JNI synthetic " + id).getBytes(StandardCharsets.UTF_8); }
  private static void equal(byte[] expected, byte[] actual) {
    if (!Arrays.equals(expected, actual)) throw new AssertionError("SyntheticBytesDiffer");
  }
  private static void require(boolean condition) {
    if (!condition) throw new AssertionError("SyntheticConditionFailed");
  }
  private static void check(String name, CheckedAction action) throws Exception {
    action.run();
    checks.add(name);
    System.out.println("PASS " + name);
  }
  private static void rejected(Class<? extends Exception> type, CheckedAction action) throws Exception {
    try { action.run(); }
    catch (Exception error) {
      if (type.isInstance(error)) return;
      throw error;
    }
    throw new AssertionError("SyntheticRequestNotRejected");
  }

  public static void main(String[] args) {
    try {
      if (args.length != 1) throw new IllegalArgumentException("ExpectedEvidenceReportPath");
      PinnedStore alice = new PinnedStore(1001);
      PinnedStore bob = new PinnedStore(2002);
      alice.pin(BOB, bob.getIdentityKeyPair().getPublicKey());
      bob.pin(ALICE, alice.getIdentityKeyPair().getPublicKey());
      check("actual JNI identity generation and native serialization roundtrip", () -> {
        byte[] serialized = alice.getIdentityKeyPair().serialize();
        try { equal(alice.getIdentityKeyPair().getPublicKey().serialize(), new IdentityKeyPair(serialized).getPublicKey().serialize()); }
        finally { Arrays.fill(serialized, (byte) 0); }
      });
      PreKeyBundle bobBundle = bundle(bob);
      check("native signed Kyber1024 prekey bundle establishes sender session", () -> {
        new SessionBuilder(alice, BOB, ALICE).process(bobBundle);
        require(alice.containsSession(BOB));
      });
      SessionCipher aliceCipher = new SessionCipher(alice, ALICE, BOB);
      SessionCipher bobCipher = new SessionCipher(bob, BOB, ALICE);
      CiphertextMessage first = aliceCipher.encrypt(body("first"));
      check("initial JNI prekey ciphertext decrypts at pinned recipient", () -> {
        require(first.getType() == CiphertextMessage.PREKEY_TYPE);
        equal(body("first"), bobCipher.decrypt(new PreKeySignalMessage(first.serialize())));
      });
      check("native one-time curve key consumed and KEM use recorded", () -> {
        require(!bob.containsPreKey(11));
        require(bob.hasKyberPreKeyBeenUsed(13));
      });
      check("JNI native reply decrypts through acknowledged session", () -> {
        CiphertextMessage reply = bobCipher.encrypt(body("reply"));
        require(reply.getType() == CiphertextMessage.WHISPER_TYPE);
        equal(body("reply"), aliceCipher.decrypt(new SignalMessage(reply.serialize())));
      });
      CiphertextMessage message = aliceCipher.encrypt(body("tamper-control"));
      byte[] before = bob.loadSession(ALICE).serialize();
      check("tampered native ciphertext rejected without committed session mutation", () -> {
        byte[] corrupted = message.serialize();
        corrupted[corrupted.length - 1] ^= 1;
        rejected(InvalidMessageException.class, () -> bobCipher.decrypt(new SignalMessage(corrupted)));
        equal(before, bob.loadSession(ALICE).serialize());
      });
      check("unaltered ciphertext still decrypts after tamper rejection", () -> {
        equal(body("tamper-control"), bobCipher.decrypt(new SignalMessage(message.serialize())));
      });
      check("JNI replay rejected without committed session mutation", () -> {
        byte[] snapshot = bob.loadSession(ALICE).serialize();
        try {
          rejected(DuplicateMessageException.class, () -> bobCipher.decrypt(new SignalMessage(message.serialize())));
          equal(snapshot, bob.loadSession(ALICE).serialize());
        } finally { Arrays.fill(snapshot, (byte) 0); }
      });
      Arrays.fill(before, (byte) 0);
      check("native skipped-key logic recovers bounded out-of-order delivery", () -> {
        List<CiphertextMessage> pending = new ArrayList<>();
        for (int i = 0; i < 3; i++) pending.add(aliceCipher.encrypt(body("order-" + i)));
        for (int i : new int[] {2, 0, 1}) equal(body("order-" + i), bobCipher.decrypt(new SignalMessage(pending.get(i).serialize())));
      });
      check("replacement peer identity rejected by pinned native store without mutation", () -> {
        PinnedStore replacement = new PinnedStore(2003);
        replacement.pin(ALICE, alice.getIdentityKeyPair().getPublicKey());
        PreKeyBundle changed = bundle(replacement);
        byte[] snapshot = alice.loadSession(BOB).serialize();
        try {
          rejected(UntrustedIdentityException.class, () -> new SessionBuilder(alice, BOB, ALICE).process(changed));
          equal(snapshot, alice.loadSession(BOB).serialize());
        } finally { Arrays.fill(snapshot, (byte) 0); }
      });
      check("eight bounded bidirectional JNI-native control exchanges", () -> {
        for (int i = 0; i < 8; i++) {
          equal(body("alice-" + i), bobCipher.decrypt(new SignalMessage(aliceCipher.encrypt(body("alice-" + i)).serialize())));
          equal(body("bob-" + i), aliceCipher.decrypt(new SignalMessage(bobCipher.encrypt(body("bob-" + i)).serialize())));
        }
      });
      String report = "{\n  \"schema\":\"ynx-social-desktop-jni-native-qa-v1\",\n"
          + "  \"package\":\"org.signal:libsignal-client:0.104.0\",\n"
          + "  \"java_runtime\":\"" + System.getProperty("java.version") + "\",\n"
          + "  \"native_jni_actual_execution\":true,\n"
          + "  \"checks\":[\"" + String.join("\",\"", checks) + "\"],\n"
          + "  \"not_proven\":[\"Android device or Keystore storage\",\"artifact build provenance to selected source commit\",\"fresh SPQR key contribution\",\"durable JNI transactions or multi-node prekeys\",\"browser support or production integration\",\"license approval, independent review, migration, activation or user acceptance\"]\n}\n";
      Files.writeString(Path.of(args[0]), report);
      System.out.println("PASS " + checks.size() + " actual native JNI checks");
    } catch (Throwable error) {
      // No arbitrary messages, stack traces, key bytes or serialized native state.
      System.err.println("FAIL " + error.getClass().getSimpleName());
      System.exit(1);
    }
  }
}
