package com.ynx.social.matrix;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

/** Dormant native protected transport journal; not a crypto authority or receipt.
 * Invoke preparation in the SAME transaction as admitted Outbox encryption.
 * Native callers must independently authorize CryptoEngine AND Matrix routing.
 * No production factory or bridge registration is supplied here. */
final class VeilMatrixJournal {
  enum Phase { PREPARED, MEDIA_READY, UNKNOWN, OBSERVED }

  /** Matrix routing review only. Never substitutes for independent crypto trust.
   * The recheck must work after private transaction handles have been frozen. */
  static final class Scope {
    final String homeserver, self, peer, room;
    final Runnable recheck;
    Scope(String homeserver, String self, String peer, String room, Runnable recheck) {
      checkedText(homeserver, 2048); checkedText(self, 255);
      checkedText(peer, 255); checkedText(room, 255);
      if (!homeserver.startsWith("https://") || !self.startsWith("@") || !peer.startsWith("@")
          || self.equals(peer) || !room.startsWith("!") || recheck == null) throw unavailable();
      this.homeserver = homeserver; this.self = self; this.peer = peer; this.room = room;
      this.recheck = recheck;
    }
    boolean same(Scope other) {
      return homeserver.equals(other.homeserver) && self.equals(other.self)
          && peer.equals(other.peer) && room.equals(other.room);
    }
  }

  static final class Entry {
    final UUID operation, senderMessage;
    final Phase phase;
    final String mediaUrl, matrixTransaction, event;
    final Scope scope;
    final int type, size;
    private final byte[] digest;
    Entry(UUID operation, UUID senderMessage, Scope scope, int type, int size, byte[] digest,
        Phase phase, String mediaUrl, String matrixTransaction, String event) {
      this.operation = operation; this.senderMessage = senderMessage; this.scope = scope;
      this.type = type; this.size = size; this.digest = digest.clone(); this.phase = phase;
      this.mediaUrl = mediaUrl; this.matrixTransaction = matrixTransaction; this.event = event;
    }
    String cipherSha256() { return VeilAuthenticatedEnvelope.hex(digest); }
    Entry next(Phase phase, String media, String transaction, String event) {
      return new Entry(operation, senderMessage, scope, type, size, digest, phase, media, transaction, event);
    }
  }

  private static IllegalStateException unavailable() { return VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE"); }
  private static IllegalStateException recovery() { return VeilAuthenticatedEnvelope.fail("VEIL_NATIVE_RECOVERY_REQUIRED"); }
  private static IllegalStateException reuse() { return VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_MESSAGE_REUSE"); }
  private static String key(UUID operation) { VeilAuthenticatedEnvelope.validateId(operation); return "matrix-v2:" + operation; }
  private static void checkedText(String value, int maximum) { VeilAuthenticatedEnvelope.text(value, maximum); }
  private static void authorize(VeilRecordTransaction tx, Scope scope) {
    tx.checkLive();
    if (scope == null) throw unavailable();
    scope.recheck.run(); tx.checkLive();
    if (tx instanceof VeilNativeTransaction nativeTx) {
      nativeTx.guardCommit(() -> { scope.recheck.run(); return kotlin.Unit.INSTANCE; });
    } else if (tx instanceof VeilContextAuthority.CommitGuardPort guarded) {
      guarded.guardCommit(scope.recheck);
    } else throw unavailable();
  }

  private static final class Original implements AutoCloseable {
    final UUID senderMessage; final int type; final byte[] cipher;
    Original(UUID senderMessage, int type, byte[] cipher) { this.senderMessage = senderMessage; this.type = type; this.cipher = cipher; }
    public void close() { Arrays.fill(cipher, (byte) 0); }
  }
  private static Original original(VeilRecordTransaction tx, UUID operation) {
    tx.checkLive();
    byte[] raw = tx.read(VeilRecordKind.OUTBOX, "signal:" + operation);
    if (raw == null) throw recovery();
    try {
      if (raw.length < 93 || raw.length > VeilAuthenticatedEnvelope.MAX_CIPHER + 92) throw recovery();
      ByteBuffer input = ByteBuffer.wrap(raw);
      if (input.getInt() != 0x564f4232) throw recovery();
      UUID senderMessage = new UUID(input.getLong(), input.getLong());
      VeilAuthenticatedEnvelope.validateId(senderMessage);
      input.position(84);
      int type = input.getInt(), size = input.getInt();
      if ((type != 2 && type != 3) || size < 1 || size != input.remaining()) throw recovery();
      byte[] cipher = new byte[size]; input.get(cipher);
      return new Original(senderMessage, type, cipher);
    } finally { Arrays.fill(raw, (byte) 0); }
  }
  private static byte[] cipherDigest(byte[] cipher) {
    try { return java.security.MessageDigest.getInstance("SHA-256").digest(cipher); }
    catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }

  static Entry prepareInTransaction(VeilRecordTransaction tx, Scope scope, UUID operation,
      VeilSignalOutbox.PendingCiphertext pending) {
    key(operation); authorize(tx, scope);
    if (pending == null) throw recovery();
    try (Original original = original(tx, operation)) {
      byte[] candidate = pending.serialize();
      try {
        if (pending.type != original.type || !pending.senderMessageId.equals(original.senderMessage)
            || !Arrays.equals(candidate, original.cipher)) throw reuse();
      } finally { Arrays.fill(candidate, (byte) 0); }
      byte[] raw = tx.read(VeilRecordKind.OUTBOX, key(operation));
      Entry prepared = new Entry(operation, original.senderMessage, scope, original.type,
          original.cipher.length, cipherDigest(original.cipher), Phase.PREPARED, null, null, null);
      if (raw != null) {
        Entry existing = decode(raw, scope);
        requireSameBase(existing, prepared);
        return existing; // Retry never resets an attempted or observed send.
      }
      save(tx, scope, prepared);
      return prepared;
    }
  }
  static Entry readInTransaction(VeilRecordTransaction tx, Scope scope, UUID operation) {
    key(operation); authorize(tx, scope);
    byte[] raw = tx.read(VeilRecordKind.OUTBOX, key(operation));
    if (raw == null) throw recovery();
    Entry result = decode(raw, scope);
    if (!operation.equals(result.operation) || !scope.same(result.scope)) throw reuse();
    try (Original original = original(tx, operation)) {
      if (result.type != original.type || result.size != original.cipher.length
          || !result.senderMessage.equals(original.senderMessage)
          || !Arrays.equals(result.digest, cipherDigest(original.cipher))) throw recovery();
    }
    scope.recheck.run(); tx.checkLive();
    return result;
  }
  static byte[] originalCipherInTransaction(VeilRecordTransaction tx, Scope scope, UUID operation) {
    readInTransaction(tx, scope, operation);
    try (Original original = original(tx, operation)) {
      scope.recheck.run(); tx.checkLive();
      return original.cipher.clone();
    }
  }
  static Entry uploadedInTransaction(VeilRecordTransaction tx, Scope scope, UUID operation, String mediaUrl) {
    checkedText(mediaUrl, 1024);
    if (!mediaUrl.matches("mxc://[A-Za-z0-9.\\[\\]:-]+/[A-Za-z0-9_-]+")) throw reuse();
    Entry entry = readInTransaction(tx, scope, operation);
    if (entry.phase != Phase.PREPARED) {
      if (!mediaUrl.equals(entry.mediaUrl)) throw reuse();
      return entry;
    }
    Entry next = entry.next(Phase.MEDIA_READY, mediaUrl, null, null); save(tx, scope, next); return next;
  }
  static Entry beginSendInTransaction(VeilRecordTransaction tx, Scope scope, UUID operation, String sdkTransaction) {
    if (sdkTransaction != null) checkedText(sdkTransaction, 255);
    Entry entry = readInTransaction(tx, scope, operation);
    if (entry.phase != Phase.MEDIA_READY) throw VeilAuthenticatedEnvelope.fail("VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED");
    Entry next = entry.next(Phase.UNKNOWN, entry.mediaUrl, sdkTransaction, null);
    save(tx, scope, next); return next; // Persist BEFORE any SDK network call.
  }
  static Entry observeInTransaction(VeilRecordTransaction tx, Scope scope, UUID operation,
      String event, String sdkTransaction, UUID senderMessage, String mediaUrl, String cipherSha256) {
    checkedText(event, 255);
    if (!event.startsWith("$")) throw reuse();
    if (sdkTransaction != null) checkedText(sdkTransaction, 255);
    Entry entry = readInTransaction(tx, scope, operation);
    if ((entry.phase != Phase.UNKNOWN && entry.phase != Phase.OBSERVED)
        || !entry.senderMessage.equals(senderMessage) || !entry.mediaUrl.equals(mediaUrl)
        || !entry.cipherSha256().equals(cipherSha256)
        || (entry.matrixTransaction != null && !entry.matrixTransaction.equals(sdkTransaction))
        || (entry.event != null && !entry.event.equals(event))) throw reuse();
    Entry next = entry.next(Phase.OBSERVED, entry.mediaUrl,
        entry.matrixTransaction == null ? sdkTransaction : entry.matrixTransaction, event);
    save(tx, scope, next); return next; // Transport observation, not private/read receipt.
  }
  private static void requireSameBase(Entry a, Entry b) {
    if (!a.operation.equals(b.operation) || !a.senderMessage.equals(b.senderMessage)
        || !a.scope.same(b.scope) || a.type != b.type || a.size != b.size || !Arrays.equals(a.digest, b.digest)) throw reuse();
  }
  private static void save(VeilRecordTransaction tx, Scope scope, Entry entry) {
    scope.recheck.run(); tx.checkLive();
    byte[] encoded = encode(entry);
    try { tx.write(VeilRecordKind.OUTBOX, key(entry.operation), encoded); }
    finally { Arrays.fill(encoded, (byte) 0); }
    scope.recheck.run(); tx.checkLive();
  }
  private static void string(DataOutputStream out, String value) throws java.io.IOException {
    byte[] bytes = value == null ? new byte[0] : VeilAuthenticatedEnvelope.text(value, 2048);
    out.writeShort(bytes.length); out.write(bytes);
  }
  private static String string(DataInputStream in, int maximum, boolean optional) throws java.io.IOException {
    int size = in.readUnsignedShort();
    if (size == 0 && optional) return null;
    if (size == 0 || size > maximum || size > in.available()) throw recovery();
    byte[] bytes = in.readNBytes(size);
    String value = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    checkedText(value, maximum); return value;
  }
  private static byte[] encode(Entry entry) {
    try {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      DataOutputStream out = new DataOutputStream(bytes);
      out.writeInt(0x564d4a32); out.writeByte(entry.phase.ordinal());
      out.writeLong(entry.operation.getMostSignificantBits()); out.writeLong(entry.operation.getLeastSignificantBits());
      out.writeLong(entry.senderMessage.getMostSignificantBits()); out.writeLong(entry.senderMessage.getLeastSignificantBits());
      out.writeByte(entry.type); out.writeInt(entry.size); out.write(entry.digest);
      string(out, entry.scope.homeserver); string(out, entry.scope.self); string(out, entry.scope.peer); string(out, entry.scope.room);
      string(out, entry.mediaUrl); string(out, entry.matrixTransaction); string(out, entry.event);
      out.flush(); return bytes.toByteArray();
    } catch (java.io.IOException impossible) { throw recovery(); }
  }
  private static Entry decode(byte[] raw, Scope current) {
    try {
      if (raw.length < 88 || raw.length > 8192) throw recovery();
      DataInputStream in = new DataInputStream(new ByteArrayInputStream(raw));
      if (in.readInt() != 0x564d4a32) throw recovery();
      int phase = in.readUnsignedByte(); if (phase >= Phase.values().length) throw recovery();
      UUID operation = new UUID(in.readLong(), in.readLong()), sender = new UUID(in.readLong(), in.readLong());
      VeilAuthenticatedEnvelope.validateId(operation); VeilAuthenticatedEnvelope.validateId(sender);
      int type = in.readUnsignedByte(), size = in.readInt();
      byte[] digest = in.readNBytes(32);
      if ((type != 2 && type != 3) || size < 1 || size > VeilAuthenticatedEnvelope.MAX_CIPHER || digest.length != 32) throw recovery();
      Scope scope = new Scope(string(in, 2048, false), string(in, 255, false), string(in, 255, false), string(in, 255, false), current.recheck);
      String media = string(in, 1024, true), transaction = string(in, 255, true), event = string(in, 255, true);
      Phase state = Phase.values()[phase];
      if (in.available() != 0 || (state == Phase.PREPARED && (media != null || transaction != null || event != null))
          || (state != Phase.PREPARED && media == null) || (state == Phase.MEDIA_READY && (transaction != null || event != null))
          || (state == Phase.UNKNOWN && event != null) || (state == Phase.OBSERVED && event == null)) throw recovery();
      Entry result = new Entry(operation, sender, scope, type, size, digest, state, media, transaction, event);
      if (!Arrays.equals(raw, encode(result))) throw recovery();
      return result;
    } catch (Exception failure) { throw recovery(); }
    finally { Arrays.fill(raw, (byte) 0); }
  }
}
