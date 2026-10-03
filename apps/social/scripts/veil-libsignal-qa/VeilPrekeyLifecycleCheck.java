package com.ynx.social.matrix;

import java.util.*;
import kotlin.Unit;
import org.signal.libsignal.protocol.IdentityKeyPair;
import org.signal.libsignal.protocol.ReusedBaseKeyException;
import org.signal.libsignal.protocol.ecc.ECKeyPair;
import org.signal.libsignal.protocol.kem.*;
import org.signal.libsignal.protocol.state.*;

/** Real SDK records, synthetic native admission and memory port; not device proof. */
public final class VeilPrekeyLifecycleCheck {
  private interface Action { void run() throws Exception; }
  private static int checks;
  private static void test(String name, Action action) throws Exception { action.run(); checks++; System.out.println("PASS " + name); }
  private static void refused(Class<? extends Exception> type, Action action) throws Exception {
    try { action.run(); } catch (Exception error) { if (type.isInstance(error)) return; throw error; }
    throw new AssertionError("SyntheticExpectedRejection");
  }
  private static final class Port implements VeilRecordTransaction {
    final Map<String, byte[]> data = new HashMap<>();
    final VeilLeaseScope scope;
    Port(VeilLeaseScope scope) { this.scope = scope; }
    public void checkLive() { scope.checkLive(); }
    private String key(VeilRecordKind kind, String id) { return kind.name() + "/" + id; }
    public byte[] read(VeilRecordKind kind, String id) { checkLive(); byte[] bytes = data.get(key(kind,id)); return bytes == null ? null : bytes.clone(); }
    public void write(VeilRecordKind kind, String id, byte[] bytes) { checkLive(); data.put(key(kind,id),bytes.clone()); }
    public void remove(VeilRecordKind kind, String id) { checkLive(); data.remove(key(kind,id)); }
    public List<String> ids(VeilRecordKind kind) { checkLive(); return data.keySet().stream().filter(key -> key.startsWith(kind.name()+"/")).map(key -> key.substring(kind.name().length()+1)).toList(); }
    byte[] snapshot() {
      // Synthetic state comparison only, retained in RAM and never logged.
      try {
        var hash = java.security.MessageDigest.getInstance("SHA-256");
        for (String key : new TreeSet<>(data.keySet())) { hash.update(key.getBytes(java.nio.charset.StandardCharsets.UTF_8)); hash.update(data.get(key)); }
        return hash.digest();
      } catch (Exception error) { throw new IllegalStateException(); }
    }
  }
  private static KyberPreKeyRecord kem(IdentityKeyPair identity, int id) {
    KEMKeyPair pair = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
    return new KyberPreKeyRecord(id,1000L,pair,identity.getPrivateKey().calculateSignature(pair.getPublicKey().serialize()));
  }
  public static void main(String[] args) {
    try {
      VeilDeviceBinding binding = new VeilDeviceBinding("qa-owner", "qa-device", "qa-fingerprint", "ynx.social.veil.v2.qa-key");
      VeilNativeAuthority authority = new VeilNativeAuthority(binding, (proof, expected, minimum) -> {
        if (!Arrays.equals(proof,new byte[]{1}) || minimum > 0) throw new IllegalStateException();
        return new VeilVerifiedDeviceGrant(expected,0L,60000L,VeilDeviceApproval.TRUSTED_DEVICE);
      }, () -> 1000L);
      VeilNativeLease lease = authority.admit(new byte[]{1});
      authority.withLease(lease, scope -> {
        try {
          Port port = new Port(scope);
          IdentityKeyPair identity = IdentityKeyPair.generate();
          VeilSignalProtocolStore store = new VeilSignalProtocolStore(port,identity.getPublicKey());
          PreKeyRecord curve = new PreKeyRecord(11,ECKeyPair.generate());
          test("same serialized curve key retry is idempotent without replacement", () -> {
            store.storePreKey(11,curve); byte[] before = port.snapshot(); store.storePreKey(11,curve);
            if (!Arrays.equals(before,port.snapshot())) throw new AssertionError();
          });
          test("different curve key under enrolled ID rejects without state mutation", () -> {
            byte[] before = port.snapshot();
            refused(IllegalStateException.class, () -> store.storePreKey(11,new PreKeyRecord(11,ECKeyPair.generate())));
            if (!Arrays.equals(before,port.snapshot())) throw new AssertionError();
          });
          test("consumed curve ID remains retired even if the original key is supplied again", () -> {
            store.removePreKey(11); byte[] before = port.snapshot();
            refused(IllegalStateException.class, () -> store.storePreKey(11,curve));
            if (store.containsPreKey(11) || !Arrays.equals(before,port.snapshot())) throw new AssertionError();
          });
          var pair = ECKeyPair.generate();
          var signed = new SignedPreKeyRecord(12,1000L,pair,identity.getPrivateKey().calculateSignature(pair.getPublicKey().serialize()));
          test("signed key replacement or reuse after retirement cannot reset a key slot", () -> {
            store.storeSignedPreKey(12,signed);
            var replacement = ECKeyPair.generate();
            refused(IllegalStateException.class, () -> store.storeSignedPreKey(12,new SignedPreKeyRecord(12,1000L,replacement,identity.getPrivateKey().calculateSignature(replacement.getPublicKey().serialize()))));
            store.removeSignedPreKey(12);
            refused(IllegalStateException.class, () -> store.storeSignedPreKey(12,signed));
          });
          KyberPreKeyRecord once = kem(identity,13);
          test("KEM enrollment requires explicit protected purpose", () -> {
            refused(IllegalStateException.class, () -> store.storeKyberPreKey(13,once));
            port.write(VeilRecordKind.KEM_PREKEY_MODE,"13",new byte[]{0}); store.storeKyberPreKey(13,once);
          });
          test("KEM purpose cannot silently change after enrollment", () -> {
            port.write(VeilRecordKind.KEM_PREKEY_MODE,"13",new byte[]{1});
            refused(IllegalStateException.class, () -> store.loadKyberPreKey(13));
            port.write(VeilRecordKind.KEM_PREKEY_MODE,"13",new byte[]{0});
          });
          test("one-time KEM consumption retires ID and blocks re-enrollment", () -> {
            store.markKyberPreKeyUsed(13,12,ECKeyPair.generate().getPublicKey());
            refused(IllegalStateException.class, () -> store.storeKyberPreKey(13,once));
            if (store.containsKyberPreKey(13)) throw new AssertionError();
          });
          test("last-resort tuple reuse rejects while independent base and retained key remain valid", () -> {
            port.write(VeilRecordKind.KEM_PREKEY_MODE,"14",new byte[]{1});
            store.storeKyberPreKey(14,kem(identity,14));
            var base = ECKeyPair.generate().getPublicKey(); store.markKyberPreKeyUsed(14,22,base);
            byte[] before = port.snapshot();
            refused(ReusedBaseKeyException.class, () -> store.markKyberPreKeyUsed(14,22,base));
            if (!Arrays.equals(before,port.snapshot())) throw new AssertionError();
            store.markKyberPreKeyUsed(14,22,ECKeyPair.generate().getPublicKey());
            if (!store.containsKyberPreKey(14)) throw new AssertionError();
          });
          scope.commit(() -> Unit.INSTANCE);
          return Unit.INSTANCE;
        } catch (Exception error) { throw new IllegalStateException("SyntheticLifecycleFailure",error); }
      });
      System.out.println("PASS " + checks + " SDK-backed lifecycle checks; synthetic proof/memory port only");
    } catch (Throwable error) {
      System.err.println("FAIL " + error.getClass().getSimpleName()); System.exit(1);
    }
  }
}
