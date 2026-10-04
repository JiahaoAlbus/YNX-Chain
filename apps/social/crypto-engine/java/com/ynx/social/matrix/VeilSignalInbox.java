package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.SessionCipher;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.message.CiphertextMessage;
import org.signal.libsignal.protocol.message.PreKeySignalMessage;
import org.signal.libsignal.protocol.message.SignalMessage;

/** Dormant authenticated receive/replay consumer; no production trust implementation. */
final class VeilSignalInbox {
  private static final int REPLAY_MAGIC = 0x56525032, REPLAY_SIZE = 100;
  private final VeilNativeStore nativeStore;
  private final IdentityKey identity;
  private final SignalProtocolAddress local;
  private final VeilContextAuthority authority;
  VeilSignalInbox(VeilNativeStore store, IdentityKey identity, VeilSignalAddress local) {
    this(store, identity, local, VeilContextAuthority.unavailable());
  }
  VeilSignalInbox(VeilNativeStore store, IdentityKey identity, VeilSignalAddress local, VeilContextAuthority authority) {
    nativeStore = Objects.requireNonNull(store); this.identity = Objects.requireNonNull(identity);
    this.local = Objects.requireNonNull(local).sdk(); this.authority = Objects.requireNonNull(authority);
  }
  ReceivedMessage decrypt(UUID operation, String handle, VeilSignalAddress peer, int type, byte[] ciphertext) {
    validateInput(operation, handle, local, Objects.requireNonNull(peer).sdk(), type, ciphertext);
    byte[] input = ciphertext.clone(); SignalProtocolAddress remote = peer.sdk();
    ReceivedMessage[] pending = new ReceivedMessage[1];
    try {
      ReceivedMessage result = nativeStore.transaction(tx -> {
        try { pending[0] = decryptInTransaction(tx, authority, identity, local, operation, handle, remote, type, input); return pending[0]; }
        catch (Exception error) { throw new IllegalStateException("VEIL_RECEIVE_TRANSACTION_ABORTED", error); }
      });
      pending[0] = null; return result;
    } finally { if (pending[0] != null) pending[0].close(); Arrays.fill(input, (byte) 0); }
  }
  static ReceivedMessage decryptInTransaction(VeilRecordTransaction tx, IdentityKey own,
      SignalProtocolAddress local, UUID operation, String handle, SignalProtocolAddress peer,
      int type, byte[] ciphertext) throws Exception {
    return decryptInTransaction(tx, VeilContextAuthority.unavailable(), own, local, operation, handle, peer, type, ciphertext);
  }
  private static void validateInput(UUID operation, String handle, SignalProtocolAddress local,
      SignalProtocolAddress peer, int type, byte[] ciphertext) {
    Objects.requireNonNull(operation); Objects.requireNonNull(local); Objects.requireNonNull(peer);
    VeilSignalOutbox.requireType(type); VeilAuthenticatedEnvelope.text(handle, 4096);
    VeilAuthenticatedEnvelope.text(local.getName(), 256); VeilAuthenticatedEnvelope.text(peer.getName(), 256);
    if (local.equals(peer) || ciphertext == null || ciphertext.length == 0 || ciphertext.length > VeilAuthenticatedEnvelope.MAX_CIPHER)
      throw VeilAuthenticatedEnvelope.fail("VEIL_ENVELOPE_INVALID");
  }
  static ReceivedMessage decryptInTransaction(VeilRecordTransaction tx, VeilContextAuthority authority,
      IdentityKey own, SignalProtocolAddress local, UUID operation, String handle,
      SignalProtocolAddress peer, int type, byte[] supplied) throws Exception {
    tx.checkLive(); validateInput(operation, handle, local, peer, type, supplied);
    byte[] ciphertext = supplied.clone(), envelope = null;
    try {
      VeilContextAuthority.Grant grant = authority.resolve(tx, handle, own, local, peer);
      if (recordExists(tx, VeilRecordKind.INBOX_RECEIPT, "signal:" + operation) ||
          recordExists(tx, VeilRecordKind.INBOX_MESSAGE, "signal:" + operation))
        throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
      byte[] cipherDigest = VeilAuthenticatedEnvelope.digest(ByteBuffer.allocate(4).putInt(type).array(), ciphertext);
      String operationKey = "v2-op:" + operation;
      String cipherKey = "v2-cipher:" + VeilAuthenticatedEnvelope.hex(VeilAuthenticatedEnvelope.digest(
          VeilAuthenticatedEnvelope.contextBytes(grant.context, false), cipherDigest));
      String byOperation = pointer(tx.read(VeilRecordKind.INBOX_RECEIPT, operationKey));
      String byCipher = pointer(tx.read(VeilRecordKind.INBOX_RECEIPT, cipherKey));
      if (byOperation != null && byCipher != null && !byOperation.equals(byCipher))
        throw VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_MESSAGE_REUSE");
      String known = byOperation != null ? byOperation : byCipher;
      if (known != null) {
        ReceivedMessage result = retained(tx, grant.context, known, cipherDigest);
        try { alias(tx, operationKey, known); grant.recheck.run(); tx.checkLive(); return result; }
        catch (Exception | Error error) { result.close(); throw error; }
      }
      grant.recheck.run(); tx.checkLive();
      SessionCipher cipher = new SessionCipher(new VeilSignalProtocolStore(tx, own), local, peer);
      envelope = type == CiphertextMessage.PREKEY_TYPE ? cipher.decrypt(new PreKeySignalMessage(ciphertext))
          : cipher.decrypt(new SignalMessage(ciphertext));
      tx.checkLive();
      try (VeilAuthenticatedEnvelope.Decoded decoded = VeilAuthenticatedEnvelope.decode(envelope)) {
        decoded.match(grant.context, false);
        String replay = replayKey(grant.context, decoded.messageId);
        byte[] existing = tx.read(VeilRecordKind.AUTHENTICATED_REPLAY, replay);
        byte[] existingMessage = tx.read(VeilRecordKind.INBOX_MESSAGE, replay);
        boolean alreadyPresent = existing != null || existingMessage != null;
        if (existing != null) Arrays.fill(existing, (byte) 0);
        if (existingMessage != null) Arrays.fill(existingMessage, (byte) 0);
        if (alreadyPresent) {
          // A different cipher for the same authenticated message never gets a new row.
          ReceivedMessage result = retained(tx, grant.context, replay, cipherDigest);
          try { alias(tx, operationKey, replay); alias(tx, cipherKey, replay); grant.recheck.run(); return result; }
          catch (Exception | Error error) { result.close(); throw error; }
        }
        byte[] frameDigest = VeilAuthenticatedEnvelope.digest(envelope);
        byte[] record = ByteBuffer.allocate(REPLAY_SIZE).putInt(REPLAY_MAGIC)
            .put(VeilAuthenticatedEnvelope.id(operation)).put(cipherDigest).put(frameDigest)
            .put(VeilAuthenticatedEnvelope.id(decoded.messageId)).array();
        tx.write(VeilRecordKind.INBOX_MESSAGE, replay, envelope);
        tx.write(VeilRecordKind.AUTHENTICATED_REPLAY, replay, record);
        alias(tx, operationKey, replay); alias(tx, cipherKey, replay);
        grant.recheck.run(); tx.checkLive();
        byte[] content = decoded.content();
        try { return new ReceivedMessage(decoded.messageId, operation, content); }
        finally { Arrays.fill(content, (byte) 0); }
      }
    } finally { Arrays.fill(ciphertext, (byte) 0); if (envelope != null) Arrays.fill(envelope, (byte) 0); }
  }
  private static boolean recordExists(VeilRecordTransaction tx, VeilRecordKind kind, String key) {
    byte[] bytes = tx.read(kind, key);
    try { tx.checkLive(); return bytes != null; }
    finally { if (bytes != null) Arrays.fill(bytes, (byte) 0); }
  }
  private static String replayKey(VeilApplicationContext context, UUID id) {
    VeilApplicationContext.Device sender = context.peer;
    return "v2-msg:" + VeilAuthenticatedEnvelope.hex(VeilAuthenticatedEnvelope.digest(
        VeilContextEncoding.encode(sender.name), ByteBuffer.allocate(4).putInt(sender.device).array(),
        sender.identity(), VeilContextEncoding.encode(context.route), ByteBuffer.allocate(8).putLong(context.epoch).array(),
        VeilAuthenticatedEnvelope.id(id)));
  }
  private static String pointer(byte[] bytes) {
    if (bytes == null) return null;
    try {
      String result = new String(bytes, StandardCharsets.US_ASCII);
      if (bytes.length != 71 || !result.matches("v2-msg:[a-f0-9]{64}"))
        throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
      return result;
    } finally { Arrays.fill(bytes, (byte) 0); }
  }
  private static void alias(VeilRecordTransaction tx, String key, String replay) {
    String original = pointer(tx.read(VeilRecordKind.INBOX_RECEIPT, key));
    if (original != null && !original.equals(replay)) throw VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_MESSAGE_REUSE");
    if (original == null) tx.write(VeilRecordKind.INBOX_RECEIPT, key, replay.getBytes(StandardCharsets.US_ASCII));
  }
  private static ReceivedMessage retained(VeilRecordTransaction tx, VeilApplicationContext context,
      String key, byte[] cipherDigest) {
    byte[] record = tx.read(VeilRecordKind.AUTHENTICATED_REPLAY, key);
    byte[] envelope = tx.read(VeilRecordKind.INBOX_MESSAGE, key);
    try {
      if (record == null || record.length != REPLAY_SIZE || envelope == null)
        throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
      ByteBuffer buffer = ByteBuffer.wrap(record);
      if (buffer.getInt() != REPLAY_MAGIC) throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
      UUID original = new UUID(buffer.getLong(), buffer.getLong());
      byte[] savedCipher = new byte[32], savedEnvelope = new byte[32]; buffer.get(savedCipher).get(savedEnvelope);
      UUID id = new UUID(buffer.getLong(), buffer.getLong());
      if (!Arrays.equals(savedCipher, cipherDigest)) throw VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_MESSAGE_REUSE");
      if (!Arrays.equals(savedEnvelope, VeilAuthenticatedEnvelope.digest(envelope)))
        throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
      try (VeilAuthenticatedEnvelope.Decoded decoded = VeilAuthenticatedEnvelope.decode(envelope)) {
        decoded.match(context, false);
        if (!decoded.messageId.equals(id) || !replayKey(context, id).equals(key))
          throw VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED");
        byte[] content = decoded.content();
        try { return new ReceivedMessage(id, original, content); }
        finally { Arrays.fill(content, (byte) 0); }
      }
    } finally { if (record != null) Arrays.fill(record, (byte) 0); if (envelope != null) Arrays.fill(envelope, (byte) 0); }
  }
  static final class ReceivedMessage implements AutoCloseable {
    final UUID senderMessageId, originalOperation;
    private byte[] content;
    ReceivedMessage(UUID id, UUID original, byte[] content) { senderMessageId = id; originalOperation = original; this.content = content.clone(); }
    synchronized byte[] bytes() { if (content == null) throw new IllegalStateException("VEIL_MESSAGE_CLOSED"); return content.clone(); }
    public synchronized void close() { if (content != null) { Arrays.fill(content, (byte) 0); content = null; } }
  }
}
