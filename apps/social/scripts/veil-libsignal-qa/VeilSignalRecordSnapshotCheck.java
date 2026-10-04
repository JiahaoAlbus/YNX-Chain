package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.signal.libsignal.protocol.*;
import org.signal.libsignal.protocol.ecc.ECKeyPair;
import org.signal.libsignal.protocol.kem.*;
import org.signal.libsignal.protocol.state.*;
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore;

/** Real SDK/JNI records and ratchet, SYNTHETIC memory port; not OS or trust evidence. */
public final class VeilSignalRecordSnapshotCheck {
  private interface Action { void run() throws Exception; }
  private static int checks;
  private static void check(String name, Action action) throws Exception { action.run(); checks++; System.out.println("PASS " + name); }
  private static void reject(Action action) throws Exception {
    try { action.run(); } catch (IllegalStateException expected) { return; }
    throw new AssertionError("Expected typed rejection");
  }
  private static void equal(byte[] a, byte[] b) { if (!Arrays.equals(a, b)) throw new AssertionError("Snapshot changed"); }
  private static final class Port implements VeilRecordTransaction {
    final Map<VeilRecordKind, Map<String, byte[]>> data = new HashMap<>();
    boolean current = true, duplicate;
    public void checkLive() { if (!current) throw new IllegalStateException("QA_STALE"); }
    public byte[] read(VeilRecordKind kind, String id) { checkLive(); byte[] b = data.getOrDefault(kind, Map.of()).get(id); return b == null ? null : b.clone(); }
    public void write(VeilRecordKind kind, String id, byte[] b) { checkLive(); data.computeIfAbsent(kind, k -> new HashMap<>()).put(id, b.clone()); }
    public void remove(VeilRecordKind kind, String id) { checkLive(); data.getOrDefault(kind, Map.of()).remove(id); }
    public List<String> ids(VeilRecordKind kind) { checkLive(); List<String> ids = data.getOrDefault(kind, Map.of()).keySet().stream().sorted().toList(); return duplicate && !ids.isEmpty() ? List.of(ids.get(0), ids.get(0)) : ids; }
  }
  public static void main(String[] args) throws Exception {
    IdentityKeyPair alice = IdentityKeyPair.generate(), bob = IdentityKeyPair.generate();
    SignalProtocolAddress a = new SignalProtocolAddress("qa-alice", 1), b = new SignalProtocolAddress("qa-bob", 1);
    InMemorySignalProtocolStore sdk = new InMemorySignalProtocolStore(alice, 1001);
    ECKeyPair pre = ECKeyPair.generate(), signed = ECKeyPair.generate();
    KEMKeyPair kem = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
    byte[] signature = bob.getPrivateKey().calculateSignature(signed.getPublicKey().serialize());
    byte[] kemSignature = bob.getPrivateKey().calculateSignature(kem.getPublicKey().serialize());
    sdk.saveIdentity(b, bob.getPublicKey());
    new SessionBuilder(sdk, b, a).process(new PreKeyBundle(1002, 1, 11, pre.getPublicKey(), 12,
        signed.getPublicKey(), signature, bob.getPublicKey(), 13, kem.getPublicKey(), kemSignature));
    byte[] pending = new SessionCipher(sdk, a, b).encrypt("synthetic native snapshot message".getBytes(StandardCharsets.UTF_8)).serialize();
    Port port = new Port();
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "public", alice.getPublicKey().serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "identity", alice.serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "registration", ByteBuffer.allocate(4).putInt(1001).array());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "signal-address", a.toString().getBytes(StandardCharsets.US_ASCII));
    port.write(VeilRecordKind.SESSION, b.toString(), sdk.loadSession(b).serialize());
    port.write(VeilRecordKind.IDENTITY_PIN, b.toString(), bob.getPublicKey().serialize());
    // Actual SDK records, generated solely for this isolated QA.
    port.write(VeilRecordKind.PREKEY, "11", new PreKeyRecord(11, pre).serialize());
    port.write(VeilRecordKind.SIGNED_PREKEY, "12", new SignedPreKeyRecord(12, 1000, signed, signature).serialize());
    port.write(VeilRecordKind.KEM_PREKEY, "13", new KyberPreKeyRecord(13, 1000, kem, kemSignature).serialize());
    for (VeilRecordKind kind : VeilRecordKind.values()) {
      if (!port.data.containsKey(kind)) port.write(kind, "qa-retained-original", new byte[]{1});
    }
    port.write(VeilRecordKind.OUTBOX, "qa-pending-ciphertext", pending);
    try (VeilSignalRecordSnapshot image = VeilSignalRecordSnapshot.capture(port, alice.getPublicKey())) {
      byte[] original = image.bytesForNativeSealer();
      try {
        check("all record kinds and evolved actual SDK session retained", () -> {
          for (VeilRecordKind kind : VeilRecordKind.values())
            if (index(original, kind.name().getBytes(StandardCharsets.US_ASCII)) < 0) throw new AssertionError("Record kind dropped");
          if (!new SessionRecord(port.read(VeilRecordKind.SESSION, b.toString())).hasSenderChain()) throw new AssertionError("No real SDK session");
          if (index(original, pending) < 0) throw new AssertionError("Pending ciphertext lost");
        });
        check("actual SDK import staging preserves complete opaque image", () -> {
          try (var staged = VeilSignalRecordSnapshot.stageImport(original, alice.getPublicKey(), port::checkLive)) { equal(original, staged.bytesForNativeSealer()); }
        });
        check("native output is an independent copy", () -> {
          byte[] changed = image.bytesForNativeSealer(); changed[0] ^= 1; equal(original, image.bytesForNativeSealer()); Arrays.fill(changed, (byte)0);
        });
        check("foreign externally supplied own pin rejects staging", () -> reject(() -> VeilSignalRecordSnapshot.stageImport(original, bob.getPublicKey(), port::checkLive)));
        check("unknown schema version rejects", () -> {
          byte[] changed = original.clone(); ByteBuffer.wrap(changed).putInt(4, 2);
          try { reject(() -> VeilSignalRecordSnapshot.stageImport(changed, alice.getPublicKey(), port::checkLive)); } finally { Arrays.fill(changed, (byte)0); }
        });
        check("truncated and trailing images reject", () -> {
          for (int n : new int[]{0, 1, 15, original.length - 1}) reject(() -> VeilSignalRecordSnapshot.stageImport(Arrays.copyOf(original,n), alice.getPublicKey(), port::checkLive));
          reject(() -> VeilSignalRecordSnapshot.stageImport(Arrays.copyOf(original,original.length+1), alice.getPublicKey(), port::checkLive));
        });
        check("late native current failure rejects staging", () -> {
          final int[] calls = {0}; reject(() -> VeilSignalRecordSnapshot.stageImport(original, alice.getPublicKey(), () -> { if (++calls[0] > 2) throw new IllegalStateException("QA_LATE"); }));
        });
        check("stale transaction cannot export", () -> { port.current=false; try { reject(() -> VeilSignalRecordSnapshot.capture(port,alice.getPublicKey())); } finally { port.current=true; } });
        check("duplicate store identifiers reject rather than overwrite", () -> { port.duplicate=true; try { reject(() -> VeilSignalRecordSnapshot.capture(port,alice.getPublicKey())); } finally { port.duplicate=false; } });
        check("SDK prekey ID substitution rejects", () -> {
          byte[] saved=port.read(VeilRecordKind.PREKEY,"11"); port.write(VeilRecordKind.PREKEY,"11",new PreKeyRecord(14,pre).serialize());
          try { reject(() -> VeilSignalRecordSnapshot.capture(port,alice.getPublicKey())); } finally { port.write(VeilRecordKind.PREKEY,"11",saved); Arrays.fill(saved,(byte)0); }
        });
        check("missing enrolled identity rejects without automatic genesis", () -> {
          byte[] saved=port.read(VeilRecordKind.SOCIAL_IDENTITY,"identity"); port.remove(VeilRecordKind.SOCIAL_IDENTITY,"identity");
          try { reject(() -> VeilSignalRecordSnapshot.capture(port,alice.getPublicKey())); } finally { port.write(VeilRecordKind.SOCIAL_IDENTITY,"identity",saved); Arrays.fill(saved,(byte)0); }
        });
        check("aggregate eight MiB cap rejects before image creation", () -> {
          port.write(VeilRecordKind.INBOX_MESSAGE,"qa-limit",new byte[VeilSignalRecordSnapshot.MAX_BYTES]);
          try { reject(() -> VeilSignalRecordSnapshot.capture(port,alice.getPublicKey())); } finally { port.remove(VeilRecordKind.INBOX_MESSAGE,"qa-limit"); }
        });
        check("successful capture never changes the original record set", () -> { try(var second=VeilSignalRecordSnapshot.capture(port,alice.getPublicKey())) { equal(original,second.bytesForNativeSealer()); } });
      } finally { Arrays.fill(original,(byte)0); Arrays.fill(pending,(byte)0); }
    }
    var closed=VeilSignalRecordSnapshot.capture(port,alice.getPublicKey()); closed.close();
    check("closed image has no readable output", () -> reject(closed::bytesForNativeSealer));
    System.out.println("PASS snapshot checks="+checks+"; actual SDK/JNI; synthetic memory/trust; no atomic restore, OS, activation or real user evidence");
  }
  private static int index(byte[] haystack, byte[] needle) {
    outer: for(int i=0;i<=haystack.length-needle.length;i++){ for(int j=0;j<needle.length;j++)if(haystack[i+j]!=needle[j])continue outer; return i; } return -1;
  }
}
