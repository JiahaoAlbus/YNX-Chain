package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.SessionCipher;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.message.CiphertextMessage;
import org.signal.libsignal.protocol.message.PreKeySignalMessage;
import org.signal.libsignal.protocol.message.SignalMessage;

/** Dormant native-only receive consumer; no enrollment, migration, or public bridge. */
final class VeilSignalInbox {
  private static final int MAX_PLAINTEXT = 64 * 1024;
  private static final int MAX_CIPHERTEXT = 2 * 1024 * 1024;
  private static final int MAGIC = 0x56534931;
  private final VeilNativeStore nativeStore;
  private final IdentityKey admittedIdentity;
  private final SignalProtocolAddress local;

  VeilSignalInbox(VeilNativeStore store, IdentityKey identity, VeilSignalAddress local) {
    nativeStore = Objects.requireNonNull(store);
    admittedIdentity = Objects.requireNonNull(identity);
    this.local = Objects.requireNonNull(local).sdk();
  }

  /** Plaintext becomes available to the caller only after native commit returns. */
  ReceivedMessage decrypt(UUID operation, String conversation, VeilSignalAddress remoteAddress,
      int type, byte[] ciphertext) {
    Objects.requireNonNull(ciphertext);
    Objects.requireNonNull(operation);
    Objects.requireNonNull(conversation);
    SignalProtocolAddress remote = Objects.requireNonNull(remoteAddress).sdk();
    VeilContextEncoding.validate(conversation);
    requireCiphertext(type, ciphertext.length);
    byte[] input = ciphertext.clone();
    try {
      return nativeStore.transaction(tx -> {
        try {
          return decryptInTransaction(tx, admittedIdentity, local, operation,
              conversation, remote, type, input);
        } catch (Exception error) {
          throw new IllegalStateException("VEIL_RECEIVE_TRANSACTION_ABORTED", error);
        }
      });
    } finally {
      Arrays.fill(input, (byte) 0);
    }
  }

  static ReceivedMessage decryptInTransaction(VeilRecordTransaction tx,
      IdentityKey admittedIdentity, SignalProtocolAddress local, UUID operation,
      String conversation, SignalProtocolAddress remote, int type, byte[] ciphertext)
      throws Exception {
    tx.checkLive();
    Objects.requireNonNull(admittedIdentity);
    Objects.requireNonNull(local);
    Objects.requireNonNull(remote);
    Objects.requireNonNull(operation);
    Objects.requireNonNull(conversation);
    Objects.requireNonNull(ciphertext);
    requireCiphertext(type, ciphertext.length);
    if (conversation.isEmpty() || conversation.length() > 512 ||
        conversation.codePoints().anyMatch(c -> c < 32 || c == 127) || local.equals(remote)) {
      throw new IllegalArgumentException("VEIL_RECEIVE_CONTEXT_UNSUPPORTED");
    }
    VeilContextEncoding.validate(conversation);
    VeilContextEncoding.validate(operation.toString());
    VeilContextEncoding.validateAddress(local);
    VeilContextEncoding.validateAddress(remote);
    VeilSignalOutbox.requireLocalAddress(tx, local);
    VeilSignalProtocolStore store = new VeilSignalProtocolStore(tx, admittedIdentity);
    store.getIdentityKeyPair();
    IdentityKey remoteIdentity = store.getIdentity(remote);
    if (remoteIdentity == null) throw new IllegalStateException("VEIL_PEER_IDENTITY_NOT_ADMITTED");
    byte[] fingerprint = fingerprint(local, remote, admittedIdentity, remoteIdentity,
        operation, conversation, type, ciphertext);
    String id = "signal:" + operation;
    byte[] receipt = null;
    byte[] saved = null;
    byte[] plaintext = null;
    byte[] encoded = null;
    try {
      receipt = tx.read(VeilRecordKind.INBOX_RECEIPT, id);
      saved = tx.read(VeilRecordKind.INBOX_MESSAGE, id);
      if (receipt != null || saved != null) {
        if (receipt == null || saved == null || receipt.length != 32) {
          throw new IllegalStateException("VEIL_INBOX_RECOVERY_REQUIRED");
        }
        if (!MessageDigest.isEqual(receipt, fingerprint)) {
          throw new IllegalStateException("VEIL_RECEIVE_OPERATION_REUSE_REJECTED");
        }
        return decode(saved);
      }
      tx.checkLive();
      SessionCipher cipher = new SessionCipher(store, local, remote);
      plaintext = type == CiphertextMessage.PREKEY_TYPE
          ? cipher.decrypt(new PreKeySignalMessage(ciphertext))
          : cipher.decrypt(new SignalMessage(ciphertext));
      tx.checkLive();
      if (plaintext.length == 0 || plaintext.length > MAX_PLAINTEXT) {
        throw new IllegalStateException("VEIL_MESSAGE_SIZE_UNSUPPORTED");
      }
      encoded = ByteBuffer.allocate(8 + plaintext.length).putInt(MAGIC)
          .putInt(plaintext.length).put(plaintext).array();
      // Native writes seal plaintext with the existing per-device Keystore key.
      // SDK state/prekey consumption, retained message, and receipt share one tx.
      tx.write(VeilRecordKind.INBOX_MESSAGE, id, encoded);
      tx.write(VeilRecordKind.INBOX_RECEIPT, id, fingerprint);
      tx.checkLive();
      return new ReceivedMessage(plaintext);
    } finally {
      Arrays.fill(fingerprint, (byte) 0);
      if (receipt != null) Arrays.fill(receipt, (byte) 0);
      if (saved != null) Arrays.fill(saved, (byte) 0);
      if (plaintext != null) Arrays.fill(plaintext, (byte) 0);
      if (encoded != null) Arrays.fill(encoded, (byte) 0);
    }
  }

  private static void requireCiphertext(int type, int length) {
    if (type != CiphertextMessage.WHISPER_TYPE && type != CiphertextMessage.PREKEY_TYPE) {
      throw new IllegalArgumentException("VEIL_MESSAGE_TYPE_UNSUPPORTED");
    }
    if (length == 0 || length > MAX_CIPHERTEXT) {
      throw new IllegalArgumentException("VEIL_CIPHERTEXT_SIZE_UNSUPPORTED");
    }
  }

  // Local receipt digest; it is not authentication or a substitute for SDK crypto.
  private static byte[] fingerprint(SignalProtocolAddress local, SignalProtocolAddress remote,
      IdentityKey ownIdentity, IdentityKey remoteIdentity, UUID operation, String conversation,
      int type, byte[] ciphertext) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    for (String field : new String[] { "ynx.social.veil.single-device.inbox.v1",
        local.toString(), remote.toString(), operation.toString(), conversation }) {
      byte[] bytes = VeilContextEncoding.encode(field);
      digest.update(ByteBuffer.allocate(4).putInt(bytes.length).array());
      digest.update(bytes);
    }
    for (IdentityKey identity : new IdentityKey[] { ownIdentity, remoteIdentity }) {
      byte[] bytes = identity.serialize();
      digest.update(ByteBuffer.allocate(4).putInt(bytes.length).array());
      digest.update(bytes);
      Arrays.fill(bytes, (byte) 0);
    }
    digest.update(ByteBuffer.allocate(8).putInt(type).putInt(ciphertext.length).array());
    digest.update(ciphertext);
    return digest.digest();
  }

  private static ReceivedMessage decode(byte[] saved) {
    if (saved.length <= 8 || saved.length > 8 + MAX_PLAINTEXT) {
      throw new IllegalStateException("VEIL_INBOX_RECOVERY_REQUIRED");
    }
    ByteBuffer buffer = ByteBuffer.wrap(saved);
    if (buffer.getInt() != MAGIC || buffer.getInt() != buffer.remaining()) {
      throw new IllegalStateException("VEIL_INBOX_RECOVERY_REQUIRED");
    }
    byte[] plaintext = new byte[buffer.remaining()];
    try {
      buffer.get(plaintext);
      return new ReceivedMessage(plaintext);
    } finally {
      Arrays.fill(plaintext, (byte) 0);
    }
  }

  static final class ReceivedMessage implements AutoCloseable {
    private byte[] plaintext;
    ReceivedMessage(byte[] plaintext) { this.plaintext = plaintext.clone(); }
    synchronized byte[] bytes() {
      if (plaintext == null) throw new IllegalStateException("VEIL_MESSAGE_CLOSED");
      return plaintext.clone();
    }
    public synchronized void close() {
      if (plaintext != null) { Arrays.fill(plaintext, (byte) 0); plaintext = null; }
    }
  }
}
