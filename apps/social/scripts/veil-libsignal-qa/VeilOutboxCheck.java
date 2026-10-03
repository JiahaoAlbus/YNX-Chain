package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.signal.libsignal.protocol.IdentityKeyPair;
import org.signal.libsignal.protocol.SessionBuilder;
import org.signal.libsignal.protocol.SessionCipher;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.ecc.ECKeyPair;
import org.signal.libsignal.protocol.kem.KEMKeyPair;
import org.signal.libsignal.protocol.kem.KEMKeyType;
import org.signal.libsignal.protocol.message.CiphertextMessage;
import org.signal.libsignal.protocol.message.PreKeySignalMessage;
import org.signal.libsignal.protocol.message.SignalMessage;
import org.signal.libsignal.protocol.state.KyberPreKeyRecord;
import org.signal.libsignal.protocol.state.PreKeyBundle;
import org.signal.libsignal.protocol.state.PreKeyRecord;
import org.signal.libsignal.protocol.state.SignedPreKeyRecord;
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore;
import org.signal.libsignal.protocol.util.KeyHelper;

/** Real SDK cipher; controlled atomic-memory transaction, not Android persistence. */
public final class VeilOutboxCheck {
  interface Action<T> { T run() throws Exception; }
  static final class Port implements VeilRecordTransaction {
    Map<String, byte[]> rows = new LinkedHashMap<>();
    boolean live = true;
    boolean failOutbox;
    VeilRecordKind failKind;
    static String key(VeilRecordKind kind, String id) { return kind.name() + "/" + id; }
    public void checkLive() { if (!live) throw new IllegalStateException("expired"); }
    public byte[] read(VeilRecordKind kind, String id) {
      checkLive(); byte[] value = rows.get(key(kind, id));
      return value == null ? null : value.clone();
    }
    public void write(VeilRecordKind kind, String id, byte[] value) {
      checkLive();
      if (failOutbox && kind == VeilRecordKind.OUTBOX) throw new IllegalStateException("fault-outbox");
      if (kind == failKind) throw new IllegalStateException("fault-" + kind.name());
      rows.put(key(kind, id), value.clone());
    }
    public void remove(VeilRecordKind kind, String id) { checkLive(); rows.remove(key(kind, id)); }
    public List<String> ids(VeilRecordKind kind) {
      checkLive(); List<String> result = new ArrayList<>(); String prefix = kind.name() + "/";
      for (String key : rows.keySet()) if (key.startsWith(prefix)) result.add(key.substring(prefix.length()));
      return result;
    }
    <T> T atomic(Action<T> action) throws Exception {
      Map<String, byte[]> before = snapshot();
      try { return action.run(); } catch (Exception error) { rows = before; throw error; }
    }
    Map<String, byte[]> snapshot() {
      Map<String, byte[]> result = new LinkedHashMap<>();
      rows.forEach((key, value) -> result.put(key, value.clone())); return result;
    }
  }

  private static void require(boolean condition, String name) {
    if (!condition) throw new AssertionError(name); System.out.println("PASS " + name);
  }
  private static void rejects(Action<?> action, String expected) throws Exception {
    try { action.run(); } catch (IllegalStateException error) {
      if (!expected.equals(error.getMessage())) throw error; return;
    }
    throw new AssertionError("expected " + expected);
  }
  private static boolean same(Map<String, byte[]> left, Map<String, byte[]> right) {
    if (!left.keySet().equals(right.keySet())) return false;
    for (String key : left.keySet()) if (!Arrays.equals(left.get(key), right.get(key))) return false;
    return true;
  }
  private static byte[] decrypt(SessionCipher cipher, VeilSignalOutbox.PendingCiphertext pending) throws Exception {
    return pending.type == CiphertextMessage.PREKEY_TYPE
        ? cipher.decrypt(new PreKeySignalMessage(pending.serialize()))
        : cipher.decrypt(new SignalMessage(pending.serialize()));
  }

  public static void main(String[] args) throws Exception {
    Port port = new Port();
    SignalProtocolAddress local = new SignalProtocolAddress("sender.public", 1);
    SignalProtocolAddress remote = new SignalProtocolAddress("receiver.public", 2);
    IdentityKeyPair sender = IdentityKeyPair.generate();
    IdentityKeyPair recipient = IdentityKeyPair.generate();
    int localRegistration = KeyHelper.generateRegistrationId(false);
    int remoteRegistration = KeyHelper.generateRegistrationId(false);
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "public", sender.getPublicKey().serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "identity", sender.serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "registration", ByteBuffer.allocate(4).putInt(localRegistration).array());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "signal-address", local.toString().getBytes(StandardCharsets.UTF_8));
    port.write(VeilRecordKind.IDENTITY_PIN, remote.toString(), recipient.getPublicKey().serialize());

    ECKeyPair pre = ECKeyPair.generate();
    ECKeyPair signed = ECKeyPair.generate();
    KEMKeyPair kem = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
    byte[] signedSignature = recipient.getPrivateKey().calculateSignature(signed.getPublicKey().serialize());
    byte[] kemSignature = recipient.getPrivateKey().calculateSignature(kem.getPublicKey().serialize());
    PreKeyBundle bundle = new PreKeyBundle(remoteRegistration, 2, 11, pre.getPublicKey(),
        12, signed.getPublicKey(), signedSignature, recipient.getPublicKey(),
        13, kem.getPublicKey(), kemSignature);
    VeilSignalProtocolStore senderStore = new VeilSignalProtocolStore(port, sender.getPublicKey());
    port.atomic(() -> { new SessionBuilder(senderStore, remote, local).process(bundle); return null; });
    InMemorySignalProtocolStore receiver = new InMemorySignalProtocolStore(recipient, remoteRegistration);
    receiver.storePreKey(11, new PreKeyRecord(11, pre));
    receiver.storeSignedPreKey(12, new SignedPreKeyRecord(12, 0L, signed, signedSignature));
    receiver.storeKyberPreKey(13, new KyberPreKeyRecord(13, 0L, kem, kemSignature));
    receiver.saveIdentity(local, sender.getPublicKey());
    SessionCipher receiverCipher = new SessionCipher(receiver, remote, local);

    UUID operation = UUID.fromString("11111111-1111-4111-8111-111111111111");
    UUID recovery = UUID.fromString("22222222-2222-4222-8222-222222222222");
    String room = "!controlled-native-room:example.test";
    byte[] plaintext = "public QA message".getBytes(StandardCharsets.UTF_8);
    byte[] original = plaintext.clone();
    VeilSignalOutbox.PendingCiphertext first = port.atomic(() ->
        VeilSignalOutbox.encryptInTransaction(port, sender.getPublicKey(), local, operation, room, remote, plaintext));
    require(first.type == CiphertextMessage.PREKEY_TYPE &&
        port.read(VeilRecordKind.OUTBOX, "signal:" + operation) != null,
        "real SDK first send stores a prekey ciphertext alongside its session");
    require(Arrays.equals(decrypt(receiverCipher, first), plaintext),
        "real SDK receiver decrypts the committed-memory outbox ciphertext");
    Map<String, byte[]> stable = port.snapshot();
    VeilSignalOutbox.PendingCiphertext retry = port.atomic(() ->
        VeilSignalOutbox.encryptInTransaction(port, sender.getPublicKey(), local, operation, room, remote, plaintext));
    require(Arrays.equals(first.serialize(), retry.serialize()) && same(stable, port.rows),
        "exact retry returns byte-identical ciphertext without advancing session");
    byte[] changed = "different QA message".getBytes(StandardCharsets.UTF_8);
    rejects(() -> port.atomic(() -> VeilSignalOutbox.encryptInTransaction(port,
        sender.getPublicKey(), local, operation, room, remote, changed)), "VEIL_OPERATION_REUSE_REJECTED");
    require(same(stable, port.rows), "changed plaintext under same operation rejects without mutation");
    rejects(() -> port.atomic(() -> VeilSignalOutbox.encryptInTransaction(port,
        sender.getPublicKey(), local, operation, room + "-other", remote, plaintext)), "VEIL_OPERATION_REUSE_REJECTED");
    require(same(stable, port.rows), "changed conversation under same operation rejects without mutation");
    IdentityKeyPair rotated = IdentityKeyPair.generate();
    port.write(VeilRecordKind.IDENTITY_PIN, remote.toString(), rotated.getPublicKey().serialize());
    Map<String, byte[]> rotatedState = port.snapshot();
    rejects(() -> port.atomic(() -> VeilSignalOutbox.encryptInTransaction(port,
        sender.getPublicKey(), local, operation, room, remote, plaintext)), "VEIL_OPERATION_REUSE_REJECTED");
    require(same(rotatedState, port.rows), "same-address peer key change cannot release old ciphertext");
    port.write(VeilRecordKind.IDENTITY_PIN, remote.toString(), recipient.getPublicKey().serialize());
    Map<String, byte[]> beforeFault = port.snapshot();
    port.failOutbox = true;
    rejects(() -> port.atomic(() -> VeilSignalOutbox.encryptInTransaction(port,
        sender.getPublicKey(), local, recovery, room, remote, changed)), "fault-outbox");
    require(same(beforeFault, port.rows), "outbox write fault rolls back SDK session in controlled atomic memory");
    port.failOutbox = false;
    VeilSignalOutbox.PendingCiphertext recovered = port.atomic(() ->
        VeilSignalOutbox.encryptInTransaction(port, sender.getPublicKey(), local, recovery, room, remote, changed));
    require(Arrays.equals(decrypt(receiverCipher, recovered), changed),
        "post-fault retry produces a decryptable message from retained session state");
    port.remove(VeilRecordKind.SOCIAL_IDENTITY, "signal-address");
    Map<String, byte[]> unboundState = port.snapshot();
    rejects(() -> port.atomic(() -> VeilSignalOutbox.encryptInTransaction(port,
        sender.getPublicKey(), local, operation, room, remote, plaintext)), "VEIL_LOCAL_ADDRESS_NOT_ADMITTED");
    require(same(unboundState, port.rows), "absent native local address admission refuses even saved retry");
    require(Arrays.equals(original, plaintext), "caller QA plaintext array remains unchanged");
    System.out.println("PASS 10 real SDK outbox checks; synthetic admission/atomic-memory port only; no Android or fresh SPQR proof");
  }
}
