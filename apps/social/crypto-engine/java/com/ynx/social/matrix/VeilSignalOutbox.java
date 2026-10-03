package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.SessionCipher;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.message.CiphertextMessage;

/** Dormant native-only A-envelope consumer; production authority is unavailable. */
final class VeilSignalOutbox {
  private static final int MAGIC = 0x564f4232, HEADER = 92;
  private final VeilNativeStore nativeStore;
  private final IdentityKey identity;
  private final SignalProtocolAddress local;
  private final VeilContextAuthority authority;
  VeilSignalOutbox(VeilNativeStore store, IdentityKey identity, VeilSignalAddress local) {
    this(store, identity, local, VeilContextAuthority.unavailable());
  }
  VeilSignalOutbox(VeilNativeStore store, IdentityKey identity, VeilSignalAddress local, VeilContextAuthority authority) {
    nativeStore = Objects.requireNonNull(store); this.identity = Objects.requireNonNull(identity);
    this.local = Objects.requireNonNull(local).sdk(); this.authority = Objects.requireNonNull(authority);
  }
  PendingCiphertext encrypt(UUID operation, String handle, VeilSignalAddress peer, byte[] content) {
    validateInput(operation, handle, local, Objects.requireNonNull(peer).sdk(), content);
    byte[] input = content.clone(); SignalProtocolAddress remote = peer.sdk();
    try {
      return nativeStore.transaction(tx -> {
        try { return encryptInTransaction(tx, authority, identity, local, operation, handle, remote, input); }
        catch (Exception error) { throw new IllegalStateException("VEIL_SEND_TRANSACTION_ABORTED", error); }
      });
    } finally { Arrays.fill(input, (byte) 0); }
  }
  // Historical prototype entry is fail-closed, never a metadata-derived context.
  static PendingCiphertext encryptInTransaction(VeilRecordTransaction tx, IdentityKey own,
      SignalProtocolAddress local, UUID operation, String handle, SignalProtocolAddress peer, byte[] content) throws Exception {
    return encryptInTransaction(tx, VeilContextAuthority.unavailable(), own, local, operation, handle, peer, content);
  }
  static void validateInput(UUID operation, String handle, SignalProtocolAddress local,
      SignalProtocolAddress peer, byte[] content) {
    Objects.requireNonNull(operation); Objects.requireNonNull(local); Objects.requireNonNull(peer);
    VeilAuthenticatedEnvelope.text(handle, 4096);
    VeilAuthenticatedEnvelope.text(local.getName(), 256); VeilAuthenticatedEnvelope.text(peer.getName(), 256);
    if (local.equals(peer)) throw VeilAuthenticatedEnvelope.fail("VEIL_ENVELOPE_INVALID");
    VeilAuthenticatedEnvelope.validateContent(content);
  }
  static PendingCiphertext encryptInTransaction(VeilRecordTransaction tx, VeilContextAuthority authority,
      IdentityKey own, SignalProtocolAddress local, UUID operation, String handle,
      SignalProtocolAddress peer, byte[] supplied) throws Exception {
    tx.checkLive(); validateInput(operation, handle, local, peer, supplied);
    byte[] content = supplied.clone(), request = null, envelope = null, serialized = null, saved = null, encoded = null, envelopeDigest = null;
    try {
      VeilContextAuthority.Grant grant = authority.resolve(tx, handle, own, local, peer);
      request = VeilAuthenticatedEnvelope.digest(VeilAuthenticatedEnvelope.contextBytes(grant.context, true),
          VeilAuthenticatedEnvelope.id(operation), content);
      saved = tx.read(VeilRecordKind.OUTBOX, "signal:" + operation);
      if (saved != null) { PendingCiphertext result = decode(saved, request); grant.recheck.run(); tx.checkLive(); return result; }
      UUID messageId = UUID.randomUUID();
      envelope = VeilAuthenticatedEnvelope.encode(grant.context, true, messageId, content);
      grant.recheck.run(); tx.checkLive();
      VeilSignalProtocolStore store = new VeilSignalProtocolStore(tx, own);
      CiphertextMessage message = new SessionCipher(store, local, peer).encrypt(envelope);
      tx.checkLive(); int type = message.getType(); requireType(type); serialized = message.serialize();
      if (serialized.length == 0 || serialized.length > VeilAuthenticatedEnvelope.MAX_CIPHER)
        throw VeilAuthenticatedEnvelope.fail("VEIL_ENVELOPE_INVALID");
      envelopeDigest = VeilAuthenticatedEnvelope.digest(envelope);
      encoded = ByteBuffer.allocate(HEADER + serialized.length).putInt(MAGIC)
          .put(VeilAuthenticatedEnvelope.id(messageId)).put(request).put(envelopeDigest)
          .putInt(type).putInt(serialized.length).put(serialized).array();
      tx.write(VeilRecordKind.OUTBOX, "signal:" + operation, encoded);
      grant.recheck.run(); tx.checkLive(); return new PendingCiphertext(type, messageId, serialized);
    } finally {
      Arrays.fill(content, (byte) 0);
      for (byte[] bytes : new byte[][] { request, envelope, serialized, saved, encoded, envelopeDigest }) if (bytes != null) Arrays.fill(bytes, (byte) 0);
    }
  }
  static void requireType(int type) {
    if (type != CiphertextMessage.PREKEY_TYPE && type != CiphertextMessage.WHISPER_TYPE)
      throw VeilAuthenticatedEnvelope.fail("VEIL_ENVELOPE_INVALID");
  }
  private static PendingCiphertext decode(byte[] encoded, byte[] request) {
    if (encoded.length <= HEADER || encoded.length > HEADER + VeilAuthenticatedEnvelope.MAX_CIPHER)
      throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
    ByteBuffer buffer = ByteBuffer.wrap(encoded);
    if (buffer.getInt() != MAGIC) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
    UUID messageId = new UUID(buffer.getLong(), buffer.getLong()); VeilAuthenticatedEnvelope.validateId(messageId);
    byte[] fingerprint = new byte[32]; buffer.get(fingerprint);
    if (!Arrays.equals(fingerprint, request)) throw VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_MESSAGE_REUSE");
    buffer.position(buffer.position() + 32); int type = buffer.getInt(); requireType(type);
    int size = buffer.getInt();
    if (size <= 0 || size != buffer.remaining()) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
    byte[] ciphertext = new byte[size];
    try { buffer.get(ciphertext); return new PendingCiphertext(type, messageId, ciphertext); }
    finally { Arrays.fill(ciphertext, (byte) 0); }
  }
  static void requireLocalAddress(VeilRecordTransaction tx, SignalProtocolAddress local) {
    tx.checkLive(); byte[] expected = VeilContextEncoding.encode(local.toString());
    byte[] admitted = tx.read(VeilRecordKind.SOCIAL_IDENTITY, "signal-address");
    try {
      if (admitted == null || !Arrays.equals(admitted, expected)) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    } finally { Arrays.fill(expected, (byte) 0); if (admitted != null) Arrays.fill(admitted, (byte) 0); }
  }
  static final class PendingCiphertext {
    final int type; final UUID senderMessageId; private final byte[] serialized;
    PendingCiphertext(int type, UUID id, byte[] serialized) { this.type = type; senderMessageId = id; this.serialized = serialized.clone(); }
    byte[] serialize() { return serialized.clone(); }
  }
}
