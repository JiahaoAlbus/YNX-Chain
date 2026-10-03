package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
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
import org.signal.libsignal.protocol.state.KyberPreKeyRecord;
import org.signal.libsignal.protocol.state.PreKeyBundle;
import org.signal.libsignal.protocol.state.PreKeyRecord;
import org.signal.libsignal.protocol.state.SignedPreKeyRecord;
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore;
import org.signal.libsignal.protocol.util.KeyHelper;

/** Actual SDK receive, controlled atomic-memory store, synthetic device admission. */
public final class VeilInboxCheck {
  private static void require(boolean condition, String name) {
    if (!condition) throw new AssertionError(name); System.out.println("PASS " + name);
  }
  private static void rejects(VeilOutboxCheck.Action<?> action, String expected) throws Exception {
    try { action.run(); } catch (IllegalStateException | IllegalArgumentException error) {
      if (!expected.equals(error.getMessage())) throw error; return;
    }
    throw new AssertionError("expected " + expected);
  }
  private static boolean same(Map<String, byte[]> left, Map<String, byte[]> right) {
    if (!left.keySet().equals(right.keySet())) return false;
    for (String key : left.keySet()) if (!Arrays.equals(left.get(key), right.get(key))) return false;
    return true;
  }

  public static void main(String[] args) throws Exception {
    VeilOutboxCheck.Port port = new VeilOutboxCheck.Port();
    SignalProtocolAddress local = new SignalProtocolAddress("recipient.public", 2);
    SignalProtocolAddress remote = new SignalProtocolAddress("sender.public", 1);
    IdentityKeyPair recipient = IdentityKeyPair.generate();
    IdentityKeyPair sender = IdentityKeyPair.generate();
    int registration = KeyHelper.generateRegistrationId(false);
    int senderRegistration = KeyHelper.generateRegistrationId(false);
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "public", recipient.getPublicKey().serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "identity", recipient.serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "registration", ByteBuffer.allocate(4).putInt(registration).array());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "signal-address", local.toString().getBytes(StandardCharsets.UTF_8));
    port.write(VeilRecordKind.IDENTITY_PIN, remote.toString(), sender.getPublicKey().serialize());
    VeilSignalProtocolStore receiver = new VeilSignalProtocolStore(port, recipient.getPublicKey());
    ECKeyPair pre = ECKeyPair.generate();
    ECKeyPair signed = ECKeyPair.generate();
    KEMKeyPair kem = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
    byte[] signedSignature = recipient.getPrivateKey().calculateSignature(signed.getPublicKey().serialize());
    byte[] kemSignature = recipient.getPrivateKey().calculateSignature(kem.getPublicKey().serialize());
    receiver.storePreKey(11, new PreKeyRecord(11, pre));
    receiver.storeSignedPreKey(12, new SignedPreKeyRecord(12, 0L, signed, signedSignature));
    port.write(VeilRecordKind.KEM_PREKEY_MODE, "13", new byte[] { 0 });
    receiver.storeKyberPreKey(13, new KyberPreKeyRecord(13, 0L, kem, kemSignature));
    InMemorySignalProtocolStore senderStore = new InMemorySignalProtocolStore(sender, senderRegistration);
    senderStore.saveIdentity(local, recipient.getPublicKey());
    PreKeyBundle bundle = new PreKeyBundle(registration, 2, 11, pre.getPublicKey(),
        12, signed.getPublicKey(), signedSignature, recipient.getPublicKey(),
        13, kem.getPublicKey(), kemSignature);
    new SessionBuilder(senderStore, local, remote).process(bundle);
    byte[] expected = "public native inbox QA message".getBytes(StandardCharsets.UTF_8);
    CiphertextMessage message = new SessionCipher(senderStore, remote, local).encrypt(expected);
    int type = message.getType();
    byte[] ciphertext = message.serialize();
    byte[] originalCiphertext = ciphertext.clone();
    UUID operation = UUID.fromString("33333333-3333-4333-8333-333333333333");
    String room = "!controlled-native-inbox:example.test";
    Map<String, byte[]> before = port.snapshot();
    port.failKind = VeilRecordKind.INBOX_RECEIPT;
    rejects(() -> port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room, remote, type, ciphertext)), "fault-INBOX_RECEIPT");
    require(same(before, port.rows), "receipt write failure rolls back SDK/prekey/message changes in atomic memory");
    port.failKind = null;
    VeilSignalInbox.ReceivedMessage received = port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room, remote, type, ciphertext));
    require(Arrays.equals(expected, received.bytes()), "real SDK prekey receive recovers after injected receipt failure");
    require(!receiver.containsPreKey(11) && !receiver.containsKyberPreKey(13),
        "successful receive consumes actual one-time curve and KEM slots");
    Map<String, byte[]> committed = port.snapshot();
    try (VeilSignalInbox.ReceivedMessage retry = port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room, remote, type, ciphertext))) {
      require(Arrays.equals(expected, retry.bytes()) && same(committed, port.rows),
          "same receive retry reads retained message without re-decrypt or session changes");
    }
    rejects(() -> port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room + "-other", remote, type, ciphertext)),
        "VEIL_RECEIVE_OPERATION_REUSE_REJECTED");
    require(same(committed, port.rows), "same receive operation cannot move ciphertext to another conversation");
    byte[] altered = ciphertext.clone(); altered[altered.length - 1] ^= 1;
    rejects(() -> port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room, remote, type, altered)),
        "VEIL_RECEIVE_OPERATION_REUSE_REJECTED");
    require(same(committed, port.rows), "same receive operation rejects altered ciphertext before SDK state changes");
    String id = "signal:" + operation;
    byte[] retained = port.read(VeilRecordKind.INBOX_MESSAGE, id);
    port.remove(VeilRecordKind.INBOX_MESSAGE, id);
    Map<String, byte[]> torn = port.snapshot();
    rejects(() -> port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room, remote, type, ciphertext)), "VEIL_INBOX_RECOVERY_REQUIRED");
    require(same(torn, port.rows), "orphan receipt requires recovery rather than replay decryption or auto-reset");
    port.write(VeilRecordKind.INBOX_MESSAGE, id, retained);
    port.remove(VeilRecordKind.IDENTITY_PIN, remote.toString());
    Map<String, byte[]> untrusted = port.snapshot();
    rejects(() -> port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room, remote, type, ciphertext)), "VEIL_PEER_IDENTITY_NOT_ADMITTED");
    require(same(untrusted, port.rows), "missing peer pin prevents saved plaintext release");
    rejects(() -> port.atomic(() -> VeilSignalInbox.decryptInTransaction(port,
        recipient.getPublicKey(), local, operation, room, remote, CiphertextMessage.SENDERKEY_TYPE, ciphertext)),
        "VEIL_MESSAGE_TYPE_UNSUPPORTED");
    require(same(untrusted, port.rows), "legacy sender-key type is refused without fallback or mutation");
    received.close();
    rejects(() -> received.bytes(), "VEIL_MESSAGE_CLOSED");
    require(Arrays.equals(originalCiphertext, ciphertext), "closed native message refuses access and caller ciphertext stays unchanged");
    System.out.println("PASS 10 actual SDK inbox checks; synthetic admission/atomic-memory port; no Android, node, or fresh SPQR proof");
  }
}
