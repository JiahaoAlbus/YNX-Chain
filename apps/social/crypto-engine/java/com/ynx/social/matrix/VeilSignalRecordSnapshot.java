package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.IdentityKeyPair;
import org.signal.libsignal.protocol.state.KyberPreKeyRecord;
import org.signal.libsignal.protocol.state.PreKeyRecord;
import org.signal.libsignal.protocol.state.SessionRecord;
import org.signal.libsignal.protocol.state.SignedPreKeyRecord;

/**
 * Native-only, versioned record image for the pinned official SDK store.
 * This framing is a Social storage container, NOT an SDK backup format or a
 * new cipher. SDK bytes are retained intact, including ratchet state. Plain
 * image bytes must go directly to the reviewed native backup sealer, never JS.
 * Parsing does not grant trust, enroll a device, advance an anchor or restore.
 */
final class VeilSignalRecordSnapshot implements AutoCloseable {
  static final int MAX_BYTES = 8 * 1024 * 1024;
  private static final int MAGIC = 0x56535231, VERSION = 1, MAX_ROWS = 4096;
  private static final byte[] SDK = "libsignal:0.104.0".getBytes(StandardCharsets.US_ASCII);
  // Explicit wire identifiers, never enum ordinals. A new record kind needs a
  // new reviewed container schema; it must not silently disappear from backup.
  private static final List<String> KINDS = List.of(
      "SOCIAL_IDENTITY", "KEM_PREKEY_MODE", "PREKEY_LIFECYCLE", "SESSION",
      "IDENTITY_PIN", "PREKEY", "SIGNED_PREKEY", "KEM_PREKEY", "USED_KEM",
      "OUTBOX", "INBOX_RECEIPT", "INBOX_MESSAGE", "AUTHENTICATED_REPLAY");
  private byte[] image;

  private VeilSignalRecordSnapshot(byte[] image) { this.image = image; }

  static VeilSignalRecordSnapshot capture(VeilRecordTransaction tx, IdentityKey approvedOwn) {
    Objects.requireNonNull(tx); Objects.requireNonNull(approvedOwn); tx.checkLive();
    requireSchema();
    List<Row> rows = new ArrayList<>();
    long size = 16L + SDK.length;
    try {
      for (String name : KINDS) {
        VeilRecordKind kind = VeilRecordKind.valueOf(name);
        HashSet<String> unique = new HashSet<>();
        for (String id : tx.ids(kind)) {
          tx.checkLive();
          byte[] identifier = identifier(id, 1024);
          if (!unique.add(id) || rows.size() >= MAX_ROWS) throw fail("VEIL_BACKUP_RECORD_SET_REJECTED");
          byte[] bytes = tx.read(kind, id);
          if (bytes == null) throw fail("VEIL_BACKUP_RECORD_SET_CHANGED");
          boolean retained = false;
          try {
            if (bytes.length < 1 || bytes.length > MAX_BYTES) throw fail("VEIL_BACKUP_RECORD_SIZE_REJECTED");
            size = Math.addExact(size, 12L + name.length() + identifier.length + bytes.length);
            if (size > MAX_BYTES) throw fail("VEIL_BACKUP_IMAGE_TOO_LARGE");
            rows.add(new Row(kind, id, bytes)); retained = true;
          } finally { if (!retained) Arrays.fill(bytes, (byte) 0); }
        }
      }
      validateSdkRecords(rows, approvedOwn);
      tx.checkLive();
      byte[] encoded = new byte[(int) size];
      try {
        ByteBuffer out = ByteBuffer.wrap(encoded);
        out.putInt(MAGIC).putInt(VERSION).putInt(SDK.length).put(SDK).putInt(rows.size());
        for (Row row : rows) {
          put(out, row.kind.name().getBytes(StandardCharsets.US_ASCII));
          put(out, identifier(row.id, 1024)); put(out, row.bytes);
        }
        tx.checkLive();
        return new VeilSignalRecordSnapshot(encoded);
      } catch (RuntimeException | Error error) { Arrays.fill(encoded, (byte) 0); throw error; }
    } finally { rows.forEach(Row::close); }
  }

  /** Decrypted input must originate from the native reviewed backup opener.
   * approvedOwn is an independently admitted public key, NOT the image's pin.
   * This only stages/validates a representation; it makes no persistent effect.
   */
  static VeilSignalRecordSnapshot stageImport(byte[] decrypted, IdentityKey approvedOwn, Runnable current) {
    Objects.requireNonNull(decrypted); Objects.requireNonNull(approvedOwn); Objects.requireNonNull(current);
    if (decrypted.length < 16 + SDK.length || decrypted.length > MAX_BYTES) throw fail("VEIL_BACKUP_IMAGE_SIZE_REJECTED");
    current.run(); requireSchema();
    byte[] copy = decrypted.clone();
    List<Row> rows = new ArrayList<>();
    boolean retained = false;
    try {
      ByteBuffer in = ByteBuffer.wrap(copy);
      if (in.getInt() != MAGIC || in.getInt() != VERSION || !Arrays.equals(take(in, SDK.length), SDK))
        throw fail("VEIL_BACKUP_SCHEMA_UNSUPPORTED");
      if (in.remaining() < 4) throw fail("VEIL_BACKUP_IMAGE_REJECTED");
      int count = in.getInt();
      if (count < 1 || count > MAX_ROWS) throw fail("VEIL_BACKUP_RECORD_SET_REJECTED");
      HashSet<String> unique = new HashSet<>();
      for (int n = 0; n < count; n++) {
        current.run();
        String name = ascii(take(in, 32), 32);
        if (!KINDS.contains(name)) throw fail("VEIL_BACKUP_SCHEMA_UNSUPPORTED");
        String id = ascii(take(in, 1024), 1024);
        if (!unique.add(name + ":" + id)) throw fail("VEIL_BACKUP_RECORD_SET_REJECTED");
        byte[] record = take(in, MAX_BYTES);
        rows.add(new Row(VeilRecordKind.valueOf(name), id, record));
      }
      if (in.hasRemaining()) throw fail("VEIL_BACKUP_TRAILING_BYTES_REJECTED");
      validateSdkRecords(rows, approvedOwn); current.run();
      retained = true;
      return new VeilSignalRecordSnapshot(copy);
    } finally { rows.forEach(Row::close); if (!retained) Arrays.fill(copy, (byte) 0); }
  }

  // Deliberately no restore/write method: the existing native authority must
  // bind reviewed external context, generation and rollback checkpoint and
  // perform the original atomic import. A decoded image is not that approval.
  synchronized byte[] bytesForNativeSealer() {
    if (image == null) throw fail("VEIL_BACKUP_IMAGE_CLOSED");
    return image.clone();
  }
  @Override public synchronized void close() {
    if (image != null) { Arrays.fill(image, (byte) 0); image = null; }
  }

  private static void requireSchema() {
    if (VeilRecordKind.values().length != KINDS.size()) throw fail("VEIL_BACKUP_SCHEMA_UNSUPPORTED");
    for (VeilRecordKind kind : VeilRecordKind.values())
      if (!KINDS.contains(kind.name())) throw fail("VEIL_BACKUP_SCHEMA_UNSUPPORTED");
  }
  private static void validateSdkRecords(List<Row> rows, IdentityKey approvedOwn) {
    Row own = find(rows, VeilRecordKind.SOCIAL_IDENTITY, "public");
    Row pair = find(rows, VeilRecordKind.SOCIAL_IDENTITY, "identity");
    Row registration = find(rows, VeilRecordKind.SOCIAL_IDENTITY, "registration");
    Row address = find(rows, VeilRecordKind.SOCIAL_IDENTITY, "signal-address");
    if (own == null || pair == null || registration == null || address == null)
      throw fail("VEIL_BACKUP_ENROLLED_IDENTITY_MISSING");
    try {
      IdentityKey pin = new IdentityKey(own.bytes);
      if (!pin.equals(approvedOwn)) throw fail("VEIL_BACKUP_IDENTITY_MISMATCH");
      IdentityKeyPair decoded = new IdentityKeyPair(pair.bytes);
      if (!decoded.getPublicKey().equals(pin) || !new IdentityKey(decoded.getPrivateKey().publicKey()).equals(pin))
        throw fail("VEIL_BACKUP_IDENTITY_MISMATCH");
      if (registration.bytes.length != 4 || ByteBuffer.wrap(registration.bytes).getInt() <= 0)
        throw fail("VEIL_BACKUP_REGISTRATION_REJECTED");
      address(ascii(address.bytes, 1024));
      for (Row row : rows) {
        switch (row.kind) {
          case SESSION -> { address(row.id); new SessionRecord(row.bytes); }
          case IDENTITY_PIN -> { address(row.id); new IdentityKey(row.bytes); }
          case PREKEY -> { if (new PreKeyRecord(row.bytes).getId() != keyId(row.id)) throw fail("VEIL_BACKUP_PREKEY_BINDING_REJECTED"); }
          case SIGNED_PREKEY -> { if (new SignedPreKeyRecord(row.bytes).getId() != keyId(row.id)) throw fail("VEIL_BACKUP_PREKEY_BINDING_REJECTED"); }
          case KEM_PREKEY -> { if (new KyberPreKeyRecord(row.bytes).getId() != keyId(row.id)) throw fail("VEIL_BACKUP_PREKEY_BINDING_REJECTED"); }
          default -> { /* Own storage records are preserved opaque, not reinterpreted as SDK state. */ }
        }
      }
    } catch (Exception error) {
      // Typed public failure only; never include serialized records in errors.
      throw fail("VEIL_BACKUP_SDK_RECORD_REJECTED");
    }
  }
  private static Row find(List<Row> rows, VeilRecordKind kind, String id) {
    for (Row row : rows) if (row.kind == kind && row.id.equals(id)) return row;
    return null;
  }
  private static int keyId(String id) {
    int value = Integer.parseInt(id);
    if (value < 0 || value > 0xffffff || !Integer.toString(value).equals(id)) throw fail("VEIL_BACKUP_KEY_ID_REJECTED");
    return value;
  }
  private static void address(String id) {
    int dot = id.lastIndexOf('.');
    if (dot < 1 || dot == id.length() - 1) throw fail("VEIL_BACKUP_ADDRESS_REJECTED");
    String suffix = id.substring(dot + 1);
    int device = Integer.parseInt(suffix);
    if (device < 1 || device > 127 || !Integer.toString(device).equals(suffix)) throw fail("VEIL_BACKUP_ADDRESS_REJECTED");
  }
  private static byte[] identifier(String id, int max) {
    if (id == null || id.isEmpty() || id.length() > max) throw fail("VEIL_BACKUP_IDENTIFIER_REJECTED");
    byte[] bytes = id.getBytes(StandardCharsets.US_ASCII);
    if (!ascii(bytes, max).equals(id)) throw fail("VEIL_BACKUP_IDENTIFIER_REJECTED");
    return bytes;
  }
  private static String ascii(byte[] bytes, int max) {
    if (bytes.length < 1 || bytes.length > max) throw fail("VEIL_BACKUP_IDENTIFIER_REJECTED");
    for (byte b : bytes) if (b < 33 || b > 126) throw fail("VEIL_BACKUP_IDENTIFIER_REJECTED");
    return new String(bytes, StandardCharsets.US_ASCII);
  }
  private static void put(ByteBuffer out, byte[] bytes) { out.putInt(bytes.length).put(bytes); }
  private static byte[] take(ByteBuffer in, int max) {
    if (in.remaining() < 4) throw fail("VEIL_BACKUP_IMAGE_REJECTED");
    int size = in.getInt();
    if (size < 1 || size > max || size > in.remaining()) throw fail("VEIL_BACKUP_IMAGE_REJECTED");
    byte[] bytes = new byte[size]; in.get(bytes); return bytes;
  }
  private static IllegalStateException fail(String code) { return new IllegalStateException(code); }
  private static final class Row implements AutoCloseable {
    final VeilRecordKind kind; final String id; final byte[] bytes;
    Row(VeilRecordKind kind, String id, byte[] bytes) { this.kind = kind; this.id = id; this.bytes = bytes; }
    @Override public void close() { Arrays.fill(bytes, (byte) 0); }
  }
}
