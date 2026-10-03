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

/**
 * Dormant, native-only single-device send consumer. No enrollment or public bridge.
 * The protected local signal-address slot must be independently admitted alongside
 * the local public identity. A caller-supplied address is not an admission proof.
 * This class does not provide a directory, group membership, or chain verification.
 */
final class VeilSignalOutbox {
  private static final int MAX_PLAINTEXT = 64 * 1024;
  private static final int MAX_CIPHERTEXT = 2 * 1024 * 1024;
  private static final int MAGIC = 0x56534f31;
  private static final int HEADER_BYTES = 4 + 32 + 4 + 4;
  private final VeilNativeStore nativeStore;
  private final IdentityKey admittedIdentity;
  private final SignalProtocolAddress local;

  VeilSignalOutbox(VeilNativeStore store, IdentityKey identity, VeilSignalAddress local) {
    this.nativeStore = Objects.requireNonNull(store);
    this.admittedIdentity = Objects.requireNonNull(identity);
    this.local = Objects.requireNonNull(local).sdk();
  }

  /** Returns only after the native transaction, including its checkpoint, commits. */
  PendingCiphertext encrypt(UUID operation, String conversation,
      VeilSignalAddress remoteAddress, byte[] plaintext) {
    Objects.requireNonNull(operation);
    Objects.requireNonNull(conversation);
    SignalProtocolAddress remote = Objects.requireNonNull(remoteAddress).sdk();
    VeilContextEncoding.validate(conversation);
    Objects.requireNonNull(plaintext);
    if (plaintext.length == 0 || plaintext.length > MAX_PLAINTEXT) {
      throw new IllegalArgumentException("VEIL_MESSAGE_SIZE_UNSUPPORTED");
    }
    byte[] input = plaintext.clone();
    try {
      return nativeStore.transaction(tx -> {
        try {
          return encryptInTransaction(tx, admittedIdentity, local, operation,
              conversation, remote, input);
        } catch (Exception error) {
          // The error escapes the transaction callback. Never return a partial send
          // or attempt a downgrade/retry inside a mutated transaction.
          throw new IllegalStateException("VEIL_SEND_TRANSACTION_ABORTED", error);
        }
      });
    } finally {
      Arrays.fill(input, (byte) 0);
    }
  }

  /** QA-visible package boundary; production callers use encrypt(), not this port. */
  static PendingCiphertext encryptInTransaction(VeilRecordTransaction tx,
      IdentityKey admittedIdentity, SignalProtocolAddress local, UUID operation,
      String conversation, SignalProtocolAddress remote, byte[] plaintext) throws Exception {
    tx.checkLive();
    Objects.requireNonNull(admittedIdentity);
    Objects.requireNonNull(local);
    Objects.requireNonNull(remote);
    Objects.requireNonNull(operation);
    Objects.requireNonNull(conversation);
    Objects.requireNonNull(plaintext);
    if (conversation.isEmpty() || conversation.length() > 512 ||
        conversation.codePoints().anyMatch(c -> c < 32 || c == 127) ||
        local.equals(remote) || plaintext.length == 0 || plaintext.length > MAX_PLAINTEXT) {
      throw new IllegalArgumentException("VEIL_SEND_CONTEXT_UNSUPPORTED");
    }
    VeilContextEncoding.validate(conversation);
    VeilContextEncoding.validate(operation.toString());
    VeilContextEncoding.validateAddress(local);
    VeilContextEncoding.validateAddress(remote);
    requireLocalAddress(tx, local);
    // Independently enrolled own-public and remote-public pins are mandatory even
    // for retries. Do not release a saved ciphertext after a peer identity change.
    VeilSignalProtocolStore store = new VeilSignalProtocolStore(tx, admittedIdentity);
    store.getIdentityKeyPair();
    IdentityKey remoteIdentity = store.getIdentity(remote);
    if (remoteIdentity == null) {
      throw new IllegalStateException("VEIL_PEER_IDENTITY_NOT_ADMITTED");
    }
    byte[] fingerprint = requestFingerprint(local, remote, operation, conversation,
        admittedIdentity, remoteIdentity, plaintext);
    String id = "signal:" + operation;
    byte[] previous = null;
    byte[] serialized = null;
    byte[] encoded = null;
    try {
      previous = tx.read(VeilRecordKind.OUTBOX, id);
      if (previous != null) return decode(previous, fingerprint);
      tx.checkLive();
      CiphertextMessage message = new SessionCipher(store, local, remote).encrypt(plaintext);
      tx.checkLive();
      int type = message.getType();
      requireMessageType(type);
      serialized = message.serialize();
      if (serialized.length == 0 || serialized.length > MAX_CIPHERTEXT) {
        throw new IllegalStateException("VEIL_CIPHERTEXT_SIZE_UNSUPPORTED");
      }
      encoded = encode(type, fingerprint, serialized);
      // All SDK session/prekey callbacks and this write share the same native tx.
      // Outer nativeStore.transaction performs authenticated checkpoint + commit.
      tx.write(VeilRecordKind.OUTBOX, id, encoded);
      tx.checkLive();
      return new PendingCiphertext(type, serialized);
    } finally {
      Arrays.fill(fingerprint, (byte) 0);
      if (previous != null) Arrays.fill(previous, (byte) 0);
      if (serialized != null) Arrays.fill(serialized, (byte) 0);
      if (encoded != null) Arrays.fill(encoded, (byte) 0);
    }
  }

  static void requireLocalAddress(VeilRecordTransaction tx, SignalProtocolAddress local) {
    tx.checkLive();
    VeilContextEncoding.validateAddress(local);
    byte[] requested = VeilContextEncoding.encode(local.toString());
    byte[] admitted = tx.read(VeilRecordKind.SOCIAL_IDENTITY, "signal-address");
    try {
      if (admitted == null || !MessageDigest.isEqual(admitted, requested)) {
        throw new IllegalStateException("VEIL_LOCAL_ADDRESS_NOT_ADMITTED");
      }
    } finally {
      if (admitted != null) Arrays.fill(admitted, (byte) 0);
      Arrays.fill(requested, (byte) 0);
    }
  }

  // Local idempotence digest, NOT a KDF, identity proof, or cryptographic wire format.
  private static byte[] requestFingerprint(SignalProtocolAddress local,
      SignalProtocolAddress remote, UUID operation, String conversation,
      IdentityKey ownIdentity, IdentityKey remoteIdentity, byte[] plaintext)
      throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    for (String field : new String[] { "ynx.social.veil.single-device.outbox.v1",
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
    digest.update(ByteBuffer.allocate(4).putInt(plaintext.length).array());
    digest.update(plaintext);
    return digest.digest();
  }

  private static void requireMessageType(int type) {
    if (type != CiphertextMessage.WHISPER_TYPE && type != CiphertextMessage.PREKEY_TYPE) {
      throw new IllegalStateException("VEIL_MESSAGE_TYPE_UNSUPPORTED");
    }
  }

  private static byte[] encode(int type, byte[] fingerprint, byte[] serialized) {
    return ByteBuffer.allocate(HEADER_BYTES + serialized.length).putInt(MAGIC)
        .put(fingerprint).putInt(type).putInt(serialized.length).put(serialized).array();
  }

  private static PendingCiphertext decode(byte[] encoded, byte[] expectedFingerprint) {
    if (encoded.length <= HEADER_BYTES || encoded.length > HEADER_BYTES + MAX_CIPHERTEXT) {
      throw new IllegalStateException("VEIL_OUTBOX_RECOVERY_REQUIRED");
    }
    ByteBuffer buffer = ByteBuffer.wrap(encoded);
    if (buffer.getInt() != MAGIC) throw new IllegalStateException("VEIL_OUTBOX_RECOVERY_REQUIRED");
    byte[] savedFingerprint = new byte[32];
    byte[] serialized = null;
    try {
      buffer.get(savedFingerprint);
      if (!MessageDigest.isEqual(savedFingerprint, expectedFingerprint)) {
        throw new IllegalStateException("VEIL_OPERATION_REUSE_REJECTED");
      }
      int type = buffer.getInt();
      requireMessageType(type);
      int size = buffer.getInt();
      if (size <= 0 || size != buffer.remaining()) {
        throw new IllegalStateException("VEIL_OUTBOX_RECOVERY_REQUIRED");
      }
      serialized = new byte[size];
      buffer.get(serialized);
      return new PendingCiphertext(type, serialized);
    } finally {
      Arrays.fill(savedFingerprint, (byte) 0);
      if (serialized != null) Arrays.fill(serialized, (byte) 0);
    }
  }

  static final class PendingCiphertext {
    final int type;
    private final byte[] serialized;
    PendingCiphertext(int type, byte[] serialized) {
      this.type = type;
      this.serialized = serialized.clone();
    }
    byte[] serialize() { return serialized.clone(); }
  }
}
