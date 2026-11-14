package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.UUID;

/** Prepared inside the original atomic native store transaction, never a separate writer. */
final class VeilAttachmentOutbox {
  private static final int CHUNK = 65536, MAGIC = 0x56414d32, META_BYTES = 144;
  private static String prefix(UUID id) { VeilAuthenticatedEnvelope.validateId(id); return "attachment-v2:" + id + ":"; }
  private static byte[] digest(byte[] value) {
    try { return MessageDigest.getInstance("SHA-256").digest(value); }
    catch (NoSuchAlgorithmException failure) { throw new IllegalStateException(failure); }
  }
  private static void require(boolean value) { if (!value) throw new IllegalStateException("VEIL_ATTACHMENT_RECORD_MISMATCH"); }
  private static void wipe(byte[] value) { if (value != null) Arrays.fill(value, (byte)0); }

  static byte[] prepare(VeilRecordTransaction tx, UUID id, byte[] aad, byte[] plaintext) {
    tx.checkLive(); String prefix = prefix(id);
    if (aad == null || aad.length < 1 || aad.length > 4096 || plaintext == null ||
        plaintext.length < 1 || plaintext.length > VeilAttachmentNative.MAX_BYTES)
      throw new IllegalArgumentException("VEIL_ATTACHMENT_INPUT_REJECTED");
    byte[] context = aad.clone(), clear = plaintext.clone(), key = null, wire = null, meta = null;
    byte[] contextHash = null, bodyHash = null;
    try {
      contextHash = digest(context); bodyHash = digest(clear);
      meta = tx.read(VeilRecordKind.OUTBOX, prefix + "meta");
      if (meta != null) {
        wire = original(tx, prefix, meta, contextHash, bodyHash);
        tx.checkLive(); return wire;
      }
      byte[] orphanKey = tx.read(VeilRecordKind.OUTBOX, prefix + "key");
      byte[] orphanChunk = tx.read(VeilRecordKind.OUTBOX, prefix + "0");
      try { require(orphanKey == null && orphanChunk == null); }
      finally { wipe(orphanKey); wipe(orphanChunk); }
      key = VeilAttachmentNative.key(tx);
      wire = VeilAttachmentNative.seal(tx, key, context, clear);
      int chunks = (wire.length + CHUNK - 1) / CHUNK;
      meta = ByteBuffer.allocate(META_BYTES).putInt(MAGIC).putInt(clear.length).putInt(wire.length).putInt(chunks)
        .put(contextHash).put(bodyHash).put(digest(wire)).put(digest(key)).array();
      tx.write(VeilRecordKind.OUTBOX, prefix + "key", key);
      for (int i = 0; i < chunks; i++) {
        byte[] part = Arrays.copyOfRange(wire, i * CHUNK, Math.min(wire.length, (i + 1) * CHUNK));
        try { tx.write(VeilRecordKind.OUTBOX, prefix + i, part); } finally { wipe(part); }
      }
      tx.write(VeilRecordKind.OUTBOX, prefix + "meta", meta);
      tx.checkLive(); return wire;
    } catch (Throwable failure) { wipe(wire); throw failure; }
    finally { wipe(context); wipe(clear); wipe(key); wipe(meta); wipe(contextHash); wipe(bodyHash); }
  }

  /** Secret descriptor goes directly into the native libsignal plaintext, NEVER JS or Matrix plaintext. */
  static byte[] signalDescriptor(VeilRecordTransaction tx, UUID id, byte[] aad) {
    tx.checkLive(); String prefix = prefix(id);
    if (aad == null || aad.length < 1 || aad.length > 4096) throw new IllegalArgumentException("VEIL_ATTACHMENT_INPUT_REJECTED");
    byte[] meta = tx.read(VeilRecordKind.OUTBOX, prefix + "meta"), key = null, wire = null, descriptor = null;
    byte[] context = digest(aad.clone());
    try {
      require(meta != null);
      wire = original(tx, prefix, meta, context, null);
      key = tx.read(VeilRecordKind.OUTBOX, prefix + "key");
      require(key != null && key.length == 32);
      descriptor = ByteBuffer.allocate(4 + 16 + META_BYTES + 32).putInt(0x56414432)
        .putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits()).put(meta).put(key).array();
      tx.checkLive(); return descriptor;
    } catch (Throwable failure) { wipe(descriptor); throw failure; }
    finally { wipe(meta); wipe(key); wipe(wire); wipe(context); }
  }

  private static byte[] original(VeilRecordTransaction tx, String prefix, byte[] meta, byte[] context, byte[] body) {
    require(meta.length == META_BYTES);
    ByteBuffer input = ByteBuffer.wrap(meta);
    require(input.getInt() == MAGIC);
    int clearSize = input.getInt(), wireSize = input.getInt(), chunks = input.getInt();
    require(clearSize > 0 && clearSize <= VeilAttachmentNative.MAX_BYTES && wireSize > 0 && wireSize <= VeilAttachmentNative.MAX_WIRE);
    require(wireSize == 35 + clearSize + ((clearSize + CHUNK - 1) / CHUNK) * 21 && chunks == (wireSize + CHUNK - 1) / CHUNK);
    byte[] expectedContext = new byte[32], expectedBody = new byte[32], expectedWire = new byte[32], expectedKey = new byte[32];
    input.get(expectedContext).get(expectedBody).get(expectedWire).get(expectedKey);
    require(MessageDigest.isEqual(context, expectedContext) && (body == null || MessageDigest.isEqual(body, expectedBody)));
    byte[] key = tx.read(VeilRecordKind.OUTBOX, prefix + "key"), wire = new byte[wireSize];
    try {
      require(key != null && key.length == 32 && MessageDigest.isEqual(digest(key), expectedKey));
      for (int i = 0; i < chunks; i++) {
        byte[] part = tx.read(VeilRecordKind.OUTBOX, prefix + i);
        try {
          int count = Math.min(CHUNK, wireSize - i * CHUNK);
          require(part != null && part.length == count);
          System.arraycopy(part, 0, wire, i * CHUNK, count);
        } finally { wipe(part); }
      }
      require(MessageDigest.isEqual(digest(wire), expectedWire));
      tx.checkLive(); return wire;
    } catch (Throwable failure) { wipe(wire); throw failure; }
    finally { wipe(key); }
  }
}
