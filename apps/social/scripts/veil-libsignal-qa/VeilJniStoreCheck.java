package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import kotlin.Unit;
import org.signal.libsignal.protocol.*;
import org.signal.libsignal.protocol.ecc.ECKeyPair;
import org.signal.libsignal.protocol.kem.*;
import org.signal.libsignal.protocol.message.*;
import org.signal.libsignal.protocol.state.*;

// Real JNI + actual native lease primitive, synthetic proof and in-memory port.
// NOT Android storage, approved device enrollment, relay or product evidence.
public final class VeilJniStoreCheck {
  private interface Action { void run() throws Exception; }
  private static int checks;
  private static final class Port implements VeilRecordTransaction {
    VeilLeaseScope scope;
    int privateReads;
    final Map<VeilRecordKind, Map<String, byte[]>> records = new EnumMap<>(VeilRecordKind.class);
    public void checkLive() { if (scope == null) throw new IllegalStateException("SyntheticScopeMissing"); scope.checkLive(); }
    public byte[] read(VeilRecordKind kind, String id) {
      checkLive();
      if (kind == VeilRecordKind.SOCIAL_IDENTITY && id.equals("identity")) privateReads++;
      byte[] value = records.getOrDefault(kind, Map.of()).get(id);
      return value == null ? null : value.clone();
    }
    public void write(VeilRecordKind kind, String id, byte[] value) { checkLive(); records.computeIfAbsent(kind, ignored -> new HashMap<>()).put(id, value.clone()); }
    public void remove(VeilRecordKind kind, String id) { checkLive(); records.getOrDefault(kind, new HashMap<>()).remove(id); }
    public List<String> ids(VeilRecordKind kind) { checkLive(); return new ArrayList<>(records.getOrDefault(kind, Map.of()).keySet()); }
  }
  private static final class Device {
    final IdentityKeyPair identity = IdentityKeyPair.generate();
    final Port port = new Port();
    final VeilNativeAuthority authority;
    final VeilNativeLease lease;
    final SignalProtocolAddress address;
    VeilSignalProtocolStore store;
    Device(String name, int registration) {
      address = new SignalProtocolAddress(name, 1);
      VeilDeviceBinding binding = new VeilDeviceBinding(name, "qa-device", "qa-fingerprint", "ynx.social.veil.v2.qa-" + registration);
      authority = new VeilNativeAuthority(binding, (proof, expected, minimum) -> {
        if (!Arrays.equals(proof, new byte[] {1}) || minimum > 0) throw new IllegalStateException();
        return new VeilVerifiedDeviceGrant(expected, 0L, 60000L, VeilDeviceApproval.TRUSTED_DEVICE);
      }, () -> 1000L);
      lease = authority.admit(new byte[] {1});
      within(this, () -> {
        port.write(VeilRecordKind.SOCIAL_IDENTITY, "public", identity.getPublicKey().serialize());
        byte[] bytes = identity.serialize();
        try { port.write(VeilRecordKind.SOCIAL_IDENTITY, "identity", bytes); } finally { Arrays.fill(bytes, (byte) 0); }
        port.write(VeilRecordKind.SOCIAL_IDENTITY, "registration", ByteBuffer.allocate(4).putInt(registration).array());
        store = new VeilSignalProtocolStore(port, identity.getPublicKey());
      });
    }
  }
  private static void within(Device device, Action action) {
    device.authority.withLease(device.lease, scope -> {
      device.port.scope = scope;
      try { action.run(); scope.commit(() -> Unit.INSTANCE); return Unit.INSTANCE; }
      catch (Exception error) { throw new IllegalStateException("SyntheticCallbackFailure", error); }
      finally { device.port.scope = null; }
    });
  }
  private static void test(String name, Action action) throws Exception {
    action.run(); checks++; System.out.println("PASS " + name);
  }
  private static void rejected(Class<? extends Exception> type, Action action) throws Exception {
    try { action.run(); } catch (Exception error) { if (type.isInstance(error)) return; throw error; }
    throw new AssertionError("SyntheticRejectionMissing");
  }
  private static byte[] body(String value) { return ("YNX JNI callback synthetic " + value).getBytes(StandardCharsets.UTF_8); }
  private static void equal(byte[] expected, byte[] actual) { if (!Arrays.equals(expected, actual)) throw new AssertionError("SyntheticBytesDiffer"); }
  private static PreKeyBundle bundle(Device device, int kemId, int mode) throws Exception {
    int preId = kemId == 13 ? 11 : 21;
    int signedId = kemId == 13 ? 12 : 22;
    ECKeyPair pre = ECKeyPair.generate(), signed = ECKeyPair.generate();
    KEMKeyPair kem = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
    byte[] signedSig = device.identity.getPrivateKey().calculateSignature(signed.getPublicKey().serialize());
    byte[] kemSig = device.identity.getPrivateKey().calculateSignature(kem.getPublicKey().serialize());
    device.store.storePreKey(preId, new PreKeyRecord(preId, pre));
    device.store.storeSignedPreKey(signedId, new SignedPreKeyRecord(signedId, System.currentTimeMillis(), signed, signedSig));
    device.port.write(VeilRecordKind.KEM_PREKEY_MODE, Integer.toString(kemId), new byte[] {(byte) mode});
    device.store.storeKyberPreKey(kemId, new KyberPreKeyRecord(kemId, System.currentTimeMillis(), kem, kemSig));
    return new PreKeyBundle(device.store.getLocalRegistrationId(), 1, preId, pre.getPublicKey(), signedId,
        signed.getPublicKey(), signedSig, device.identity.getPublicKey(), kemId, kem.getPublicKey(), kemSig);
  }
  public static void main(String[] args) {
    try {
      Device alice = new Device("97d7967e-583d-4f76-bae2-d35a533c22b0", 1001);
      Device bob = new Device("48ccf172-2a4e-4375-bd74-bfef525e5711", 2002);
      test("JNI adapter reads enrolled own pair and registration through live native lease", () -> within(alice, () -> {
        if (!alice.store.getIdentityKeyPair().getPublicKey().equals(alice.identity.getPublicKey()) || alice.store.getLocalRegistrationId() != 1001) throw new AssertionError();
      }));
      test("wrong own public admission rejects before private record read", () -> within(alice, () -> {
        int before = alice.port.privateReads;
        VeilSignalProtocolStore wrong = new VeilSignalProtocolStore(alice.port, bob.identity.getPublicKey());
        rejected(IllegalStateException.class, wrong::getIdentityKeyPair);
        if (alice.port.privateReads != before) throw new AssertionError();
      }));
      test("missing peer approval rejects instead of TOFU", () -> within(alice, () -> {
        if (alice.store.isTrustedIdentity(bob.address, bob.identity.getPublicKey(), IdentityKeyStore.Direction.SENDING)) throw new AssertionError();
        rejected(IllegalStateException.class, () -> alice.store.saveIdentity(bob.address, bob.identity.getPublicKey()));
      }));
      within(alice, () -> alice.port.write(VeilRecordKind.IDENTITY_PIN, bob.address.toString(), bob.identity.getPublicKey().serialize()));
      within(bob, () -> bob.port.write(VeilRecordKind.IDENTITY_PIN, alice.address.toString(), alice.identity.getPublicKey().serialize()));
      PreKeyBundle[] prepared = new PreKeyBundle[1];
      within(bob, () -> prepared[0] = bundle(bob, 13, 0));
      CiphertextMessage[] first = new CiphertextMessage[1];
      test("actual JNI builds and encrypts via serialized-record callback adapter", () -> within(alice, () -> {
        new SessionBuilder(alice.store, bob.address, alice.address).process(prepared[0]);
        first[0] = new SessionCipher(alice.store, alice.address, bob.address).encrypt(body("first"));
        alice.port.write(VeilRecordKind.OUTBOX, "first", first[0].serialize());
      }));
      test("actual JNI recipient consumes one-time curve and KEM through same port", () -> within(bob, () -> {
        equal(body("first"), new SessionCipher(bob.store, bob.address, alice.address).decrypt(new PreKeySignalMessage(first[0].serialize())));
        if (bob.store.containsPreKey(11) || bob.store.containsKyberPreKey(13)) throw new AssertionError();
      }));
      CiphertextMessage[] reply = new CiphertextMessage[1];
      test("actual JNI reply survives native serialized session reconstruction", () -> {
        within(bob, () -> reply[0] = new SessionCipher(bob.store, bob.address, alice.address).encrypt(body("reply")));
        within(alice, () -> equal(body("reply"), new SessionCipher(alice.store, alice.address, bob.address).decrypt(new SignalMessage(reply[0].serialize()))));
      });
      test("last-resort KEM remains stored but exact signed/base tuple reuse rejects", () -> within(bob, () -> {
        bundle(bob, 14, 1);
        ECPublicKeyHolder base = new ECPublicKeyHolder();
        bob.store.markKyberPreKeyUsed(14, 22, base.key);
        rejected(ReusedBaseKeyException.class, () -> bob.store.markKyberPreKeyUsed(14, 22, base.key));
        bob.store.markKyberPreKeyUsed(14, 22, ECKeyPair.generate().getPublicKey());
        if (!bob.store.containsKyberPreKey(14)) throw new AssertionError();
      }));
      test("legacy sender-key writes cannot become new paired group encryption", () -> within(alice, () -> {
        rejected(UnsupportedOperationException.class, () -> alice.store.storeSenderKey(alice.address, UUID.randomUUID(), null));
      }));
      test("retained callback store after scope exit rejects before private key access", () -> {
        int before = alice.port.privateReads;
        rejected(IllegalStateException.class, alice.store::getIdentityKeyPair);
        if (before != alice.port.privateReads) throw new AssertionError();
      });
      test("revoked native lease rejects before future JNI callback private access", () -> {
        int before = alice.port.privateReads;
        alice.authority.revoke();
        rejected(IllegalStateException.class, () -> within(alice, alice.store::getIdentityKeyPair));
        if (before != alice.port.privateReads) throw new AssertionError();
      });
      System.out.println("PASS " + checks + " actual JNI callback/lease checks; synthetic proof and memory port only");
    } catch (Throwable error) {
      System.err.println("FAIL " + error.getClass().getSimpleName());
      System.exit(1);
    }
  }
  private static final class ECPublicKeyHolder { final org.signal.libsignal.protocol.ecc.ECPublicKey key = ECKeyPair.generate().getPublicKey(); }
}
