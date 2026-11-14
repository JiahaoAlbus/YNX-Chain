package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.UUID;

/** DATA composition only. Admission and atomic commit guards belong to the caller.
 * The returned descriptor is native Signal content, never a Matrix outer field. */
final class VeilMatrixAttachmentTransport {
  private static final int CHUNK = 65536, RAW = 196, META = 144, MAX_MEDIA = 2048;
  private static final int CONTENT_MAGIC = 0x56415432;
  private static final byte[] DOMAIN = "YNX/VEIL/attachment-aad/v2".getBytes(StandardCharsets.US_ASCII);
  private VeilMatrixAttachmentTransport() {}
  private static void require(boolean ok) {
    if (!ok) throw new IllegalStateException("VEIL_ATTACHMENT_RECORD_MISMATCH");
  }
  private static void wipe(byte[] value) { if (value != null) Arrays.fill(value, (byte) 0); }
  private static byte[] hash(byte[] value) {
    try { return MessageDigest.getInstance("SHA-256").digest(value); }
    catch (NoSuchAlgorithmException failure) { throw new IllegalStateException(failure); }
  }
  private static void matches(byte[] value, byte[] metadata, int offset) {
    byte[] actual = hash(value), expected = Arrays.copyOfRange(metadata, offset, offset + 32);
    try { require(MessageDigest.isEqual(actual, expected)); }
    finally { wipe(actual); wipe(expected); }
  }
  private static String prefix(UUID id) {
    VeilAuthenticatedEnvelope.validateId(id); return "attachment-v2:" + id + ":";
  }
  static byte[] aad(VeilApplicationContext context, UUID id, boolean outgoing) {
    VeilAuthenticatedEnvelope.validateId(id);
    byte[] canonical = VeilAuthenticatedEnvelope.contextBytes(context, outgoing);
    try {
      return ByteBuffer.allocate(4 + DOMAIN.length + 4 + canonical.length + 16)
          .putInt(DOMAIN.length).put(DOMAIN).putInt(canonical.length).put(canonical)
          .putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits()).array();
    } finally { wipe(canonical); }
  }
  private static void requireAadId(byte[] aad, UUID id) {
    VeilAuthenticatedEnvelope.validateId(id);
    require(aad != null && aad.length <= 4096 && aad.length >= 8 + DOMAIN.length + 17);
    ByteBuffer input = ByteBuffer.wrap(aad);
    require(input.getInt() == DOMAIN.length);
    for (byte expected : DOMAIN) require(input.get() == expected);
    int contextSize = input.getInt();
    require(contextSize > 0 && contextSize == input.remaining() - 16);
    input.position(input.position() + contextSize);
    require(id.getMostSignificantBits() == input.getLong() && id.getLeastSignificantBits() == input.getLong());
  }
  static byte[] prepare(VeilRecordTransaction tx, UUID id, byte[] aad, byte[] clear) {
    requireAadId(aad, id);
    return VeilAttachmentOutbox.prepare(tx, id, aad, clear);
  }
  static byte[] originalWire(VeilRecordTransaction tx, UUID id, byte[] aad) {
    byte[] raw = null, wire = null;
    try {
      tx.checkLive();
      requireAadId(aad, id);
      raw = VeilAttachmentOutbox.signalDescriptor(tx, id, aad);
      try (ReceivedDescriptor descriptor = rawDescriptor(raw, "mxc://local/original")) {
        require(id.equals(descriptor.id));
        wire = new byte[descriptor.wireSize];
        int chunks = (wire.length + CHUNK - 1) / CHUNK;
        for (int i = 0; i < chunks; i++) {
          tx.checkLive();
          byte[] part = tx.read(VeilRecordKind.OUTBOX, prefix(id) + i);
          try {
            int count = Math.min(CHUNK, wire.length - i * CHUNK);
            require(part != null && part.length == count);
            System.arraycopy(part, 0, wire, i * CHUNK, count);
          } finally { wipe(part); }
        }
        matches(aad, descriptor.metadata, 16);
        matches(wire, descriptor.metadata, 80);
        tx.checkLive(); return wire;
      }
    } catch (Throwable failure) { wipe(wire); throw failure; }
    finally { wipe(raw); }
  }
  static String originalMedia(VeilRecordTransaction tx, UUID id, byte[] aad) {
    byte[] saved = null, raw = null;
    try {
      tx.checkLive();
      requireAadId(aad, id);
      raw = VeilAttachmentOutbox.signalDescriptor(tx, id, aad);
      saved = tx.read(VeilRecordKind.OUTBOX, prefix(id) + "signal-content");
      if (saved == null) { tx.checkLive(); return null; }
      try (ReceivedDescriptor descriptor = parse(saved)) {
        require(id.equals(descriptor.id));
        byte[] expected = wrap(raw, descriptor.media);
        try { require(MessageDigest.isEqual(saved, expected)); }
        finally { wipe(expected); }
        tx.checkLive(); return descriptor.media;
      }
    } finally { wipe(saved); wipe(raw); }
  }
  static byte[] descriptor(VeilRecordTransaction tx, UUID id, byte[] aad, String media) {
    byte[] raw = null, saved = null, content = null;
    try {
      tx.checkLive();
      requireAadId(aad, id);
      raw = VeilAttachmentOutbox.signalDescriptor(tx, id, aad);
      content = wrap(raw, media);
      saved = tx.read(VeilRecordKind.OUTBOX, prefix(id) + "signal-content");
      if (saved == null) tx.write(VeilRecordKind.OUTBOX, prefix(id) + "signal-content", content);
      else require(MessageDigest.isEqual(saved, content));
      tx.checkLive(); return content;
    } catch (Throwable failure) { wipe(content); throw failure; }
    finally { wipe(raw); wipe(saved); }
  }
  private static byte[] mediaBytes(String media) {
    byte[] bytes = VeilAuthenticatedEnvelope.text(media, MAX_MEDIA);
    try {
      require(media.matches("mxc://[A-Za-z0-9.\\[\\]:-]+/[A-Za-z0-9_-]+"));
      return bytes;
    } catch (Throwable failure) { wipe(bytes); throw failure; }
  }
  private static byte[] wrap(byte[] raw, String media) {
    require(raw != null && raw.length == RAW);
    byte[] locator = mediaBytes(media);
    try {
      return ByteBuffer.allocate(8 + RAW + locator.length).putInt(CONTENT_MAGIC)
          .put(raw).putInt(locator.length).put(locator).array();
    } finally { wipe(locator); }
  }
  static ReceivedDescriptor parse(byte[] authenticatedSignalContent) {
    byte[] snapshot = null, raw = null, locator = null;
    try {
      require(authenticatedSignalContent != null && authenticatedSignalContent.length >= 8 + RAW + 1
          && authenticatedSignalContent.length <= 8 + RAW + MAX_MEDIA);
      snapshot = authenticatedSignalContent.clone();
      ByteBuffer input = ByteBuffer.wrap(snapshot);
      require(input.getInt() == CONTENT_MAGIC);
      raw = new byte[RAW]; input.get(raw);
      int size = input.getInt(); require(size > 0 && size <= MAX_MEDIA && size == input.remaining());
      locator = new byte[size]; input.get(locator);
      String media = new String(locator, StandardCharsets.UTF_8);
      byte[] canonical = mediaBytes(media);
      try { require(Arrays.equals(locator, canonical)); }
      finally { wipe(canonical); }
      return rawDescriptor(raw, media);
    } finally { wipe(snapshot); wipe(raw); wipe(locator); }
  }
  private static ReceivedDescriptor rawDescriptor(byte[] raw, String media) {
    byte[] metadata = null, key = null;
    try {
      require(raw != null && raw.length == RAW);
      ByteBuffer input = ByteBuffer.wrap(raw);
      require(input.getInt() == 0x56414432);
      UUID id = new UUID(input.getLong(), input.getLong()); VeilAuthenticatedEnvelope.validateId(id);
      metadata = new byte[META]; key = new byte[32]; input.get(metadata).get(key);
      ByteBuffer meta = ByteBuffer.wrap(metadata);
      require(meta.getInt() == 0x56414d32);
      int clearSize = meta.getInt(), wireSize = meta.getInt(), chunks = meta.getInt();
      require(clearSize > 0 && clearSize <= VeilAttachmentNative.MAX_BYTES && wireSize > 0
          && wireSize <= VeilAttachmentNative.MAX_WIRE
          && wireSize == 35 + clearSize + ((clearSize + CHUNK - 1) / CHUNK) * 21
          && chunks == (wireSize + CHUNK - 1) / CHUNK);
      matches(key, metadata, 112);
      ReceivedDescriptor result = new ReceivedDescriptor(id, media, clearSize, wireSize, metadata, key);
      metadata = null; key = null; return result;
    } finally { wipe(metadata); wipe(key); }
  }
  static final class ReceivedDescriptor implements AutoCloseable {
    final UUID id;
    final String media;
    final int wireSize;
    private final int clearSize;
    private byte[] metadata, key;
    private ReceivedDescriptor(UUID id, String media, int clearSize, int wireSize, byte[] metadata, byte[] key) {
      this.id = id; this.media = media; this.clearSize = clearSize; this.wireSize = wireSize;
      this.metadata = metadata; this.key = key;
    }
    synchronized byte[] open(VeilRecordTransaction tx, byte[] aad, byte[] wire) {
      byte[] clear = null, context = null, snapshot = null;
      try {
        require(key != null && metadata != null); tx.checkLive();
        require(aad != null && aad.length > 0 && aad.length <= 4096 && wire != null && wire.length == wireSize);
        context = aad.clone(); snapshot = wire.clone();
        requireAadId(context, id);
        matches(context, metadata, 16); matches(key, metadata, 112); matches(snapshot, metadata, 80);
        clear = VeilAttachmentNative.open(tx, key, context, snapshot);
        require(clear != null && clear.length == clearSize); matches(clear, metadata, 48);
        tx.checkLive(); return clear;
      } catch (Throwable failure) { wipe(clear); close(); throw failure; }
      finally { wipe(context); wipe(snapshot); }
    }
    @Override public synchronized void close() { wipe(key); wipe(metadata); key = null; metadata = null; }
  }
}
