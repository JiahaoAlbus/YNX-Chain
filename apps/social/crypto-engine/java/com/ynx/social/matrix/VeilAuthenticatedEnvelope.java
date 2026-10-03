package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;

/** Exact A contract 448a674a...: application bytes INSIDE official SessionCipher. */
final class VeilAuthenticatedEnvelope {
  static final int MAX_CONTENT = 65536, MAX_ENVELOPE = 68 * 1024, MAX_CIPHER = 2 * 1024 * 1024;
  private static final byte[] MAGIC = { 0x59, 0x4e, 0x58, 0x56, 0x45, 0x49, 0x4c, 0 };
  private static final byte[] SUITE = VeilApplicationContext.SUITE.getBytes(StandardCharsets.US_ASCII);
  private VeilAuthenticatedEnvelope() {}
  static IllegalStateException fail(String code) { return new IllegalStateException(code); }
  static byte[] text(String value, int maximum) {
    byte[] result;
    try { result = VeilContextEncoding.encode(value); }
    catch (RuntimeException error) { throw fail("VEIL_ENVELOPE_INVALID"); }
    if (result.length < 1 || result.length > maximum || value.codePoints().anyMatch(c -> c < 32 || c == 127))
      throw fail("VEIL_ENVELOPE_INVALID");
    return result;
  }
  static void validateDevice(VeilApplicationContext.Device value) {
    text(value.name, 256);
    if (value.device < 1 || value.device > 127 || value.identity().length != 33 || value.generation == 0)
      throw fail("VEIL_ENVELOPE_INVALID");
  }
  static void validateContext(VeilApplicationContext context) {
    text(context.route, 512); validateDevice(context.local); validateDevice(context.peer);
    if (context.epoch == 0 || (context.local.name.equals(context.peer.name) && context.local.device == context.peer.device))
      throw fail("VEIL_ENVELOPE_INVALID");
  }
  static void validateId(UUID id) {
    if (id == null || id.version() != 4 || id.variant() != 2) throw fail("VEIL_ENVELOPE_INVALID");
  }
  static void validateContent(byte[] content) {
    if (content == null || content.length < 1 || content.length > MAX_CONTENT) throw fail("VEIL_ENVELOPE_INVALID");
  }
  static byte[] contextBytes(VeilApplicationContext context, boolean outbound) {
    validateContext(context);
    byte[] route = text(context.route, 512);
    VeilApplicationContext.Device sender = outbound ? context.local : context.peer;
    VeilApplicationContext.Device recipient = outbound ? context.peer : context.local;
    byte[] senderName = text(sender.name, 256), recipientName = text(recipient.name, 256);
    int length = Math.addExact(8 + 2 + 2 + SUITE.length + 1 + 2 + route.length + 8,
        Math.addExact(2 + senderName.length + 4 + 33 + 8, 2 + recipientName.length + 4 + 33 + 8));
    ByteBuffer buffer = ByteBuffer.allocate(length).order(ByteOrder.BIG_ENDIAN);
    buffer.put(MAGIC).putShort((short) 2).putShort((short) SUITE.length).put(SUITE).put((byte) 1);
    buffer.putShort((short) route.length).put(route);
    device(buffer, sender, senderName); device(buffer, recipient, recipientName);
    return buffer.putLong(context.epoch).array();
  }
  private static void device(ByteBuffer buffer, VeilApplicationContext.Device value, byte[] name) {
    buffer.putShort((short) name.length).put(name).putInt(value.device).put(value.identity()).putLong(value.generation);
  }
  static byte[] encode(VeilApplicationContext context, boolean outbound, UUID messageId, byte[] content) {
    validateId(messageId); validateContent(content);
    byte[] header = contextBytes(context, outbound);
    int size = Math.addExact(header.length, Math.addExact(20, content.length));
    if (size > MAX_ENVELOPE) throw fail("VEIL_ENVELOPE_INVALID");
    return ByteBuffer.allocate(size).put(header).putLong(messageId.getMostSignificantBits())
        .putLong(messageId.getLeastSignificantBits()).putInt(content.length).put(content).array();
  }
  static final class Decoded implements AutoCloseable {
    final VeilApplicationContext wire;
    final UUID messageId;
    private byte[] content;
    Decoded(VeilApplicationContext wire, UUID id, byte[] content) {
      this.wire = wire; this.messageId = id; this.content = content;
    }
    byte[] content() { if (content == null) throw fail("VEIL_NATIVE_RECOVERY_REQUIRED"); return content.clone(); }
    void match(VeilApplicationContext expected, boolean outbound) {
      if (!wire.route.equals(expected.route) || wire.epoch != expected.epoch ||
          !wire.local.same(outbound ? expected.local : expected.peer) ||
          !wire.peer.same(outbound ? expected.peer : expected.local)) throw fail("VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
    }
    public void close() { if (content != null) { Arrays.fill(content, (byte) 0); content = null; } }
  }
  static Decoded decode(byte[] encoded) {
    if (encoded == null || encoded.length > MAX_ENVELOPE || encoded.length < 8 + 2 + 2 + 1 + 2 + 20)
      throw fail("VEIL_ENVELOPE_INVALID");
    byte[] content = null;
    try {
      ByteBuffer buffer = ByteBuffer.wrap(encoded).order(ByteOrder.BIG_ENDIAN);
      byte[] magic = new byte[8]; buffer.get(magic);
      if (!Arrays.equals(magic, MAGIC)) throw fail("VEIL_ENVELOPE_INVALID");
      if (Short.toUnsignedInt(buffer.getShort()) != 2) throw fail("VEIL_ENVELOPE_VERSION_UNSUPPORTED");
      int suiteLength = Short.toUnsignedInt(buffer.getShort());
      if (suiteLength != SUITE.length || suiteLength > buffer.remaining()) throw fail("VEIL_ENVELOPE_SUITE_UNSUPPORTED");
      byte[] suite = new byte[suiteLength]; buffer.get(suite);
      if (!Arrays.equals(suite, SUITE)) throw fail("VEIL_ENVELOPE_SUITE_UNSUPPORTED");
      if (buffer.get() != 1) throw fail("VEIL_ENVELOPE_INVALID");
      String route = string(buffer, 512);
      VeilApplicationContext.Device sender = device(buffer), recipient = device(buffer);
      long epoch = buffer.getLong();
      VeilApplicationContext wire = new VeilApplicationContext(route, sender, recipient, epoch);
      UUID id = new UUID(buffer.getLong(), buffer.getLong()); validateId(id);
      int size = buffer.getInt();
      if (size < 1 || size > MAX_CONTENT || size != buffer.remaining()) throw fail("VEIL_ENVELOPE_INVALID");
      content = new byte[size]; buffer.get(content);
      byte[] canonical = encode(wire, true, id, content);
      boolean exact = Arrays.equals(canonical, encoded); Arrays.fill(canonical, (byte) 0);
      if (!exact) throw fail("VEIL_ENVELOPE_INVALID");
      Decoded result = new Decoded(wire, id, content); content = null; return result;
    } catch (IllegalStateException error) { throw error; }
    catch (Exception error) { throw fail("VEIL_ENVELOPE_INVALID"); }
    finally { if (content != null) Arrays.fill(content, (byte) 0); }
  }
  private static String string(ByteBuffer buffer, int maximum) throws Exception {
    int length = Short.toUnsignedInt(buffer.getShort());
    if (length < 1 || length > maximum || length > buffer.remaining()) throw fail("VEIL_ENVELOPE_INVALID");
    ByteBuffer bytes = buffer.slice(); bytes.limit(length); buffer.position(buffer.position() + length);
    String result = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(bytes).toString();
    text(result, maximum); return result;
  }
  private static VeilApplicationContext.Device device(ByteBuffer buffer) throws Exception {
    String name = string(buffer, 256); int device = buffer.getInt();
    byte[] identity = new byte[33]; buffer.get(identity);
    return new VeilApplicationContext.Device(name, device, identity, buffer.getLong());
  }
  static byte[] digest(byte[]... fields) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      for (byte[] field : fields) { digest.update(ByteBuffer.allocate(4).putInt(field.length).array()); digest.update(field); }
      return digest.digest();
    } catch (Exception error) { throw new IllegalStateException(error); }
  }
  static String hex(byte[] bytes) {
    StringBuilder result = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) result.append(Character.forDigit((value >>> 4) & 15, 16)).append(Character.forDigit(value & 15, 16));
    return result.toString();
  }
  static byte[] id(UUID value) { return ByteBuffer.allocate(16).putLong(value.getMostSignificantBits()).putLong(value.getLeastSignificantBits()).array(); }
}
