package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
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
import org.signal.libsignal.protocol.util.KeyHelper;

/** Actual JNI crypto, synthetic independent-admission grants and atomic-memory ONLY. */
public final class VeilEnvelopeCheck {
  interface Action<T> { T run() throws Exception; }
  static final class Port implements VeilRecordTransaction, VeilContextAuthority.CommitGuardPort {
    Map<String, byte[]> rows = new LinkedHashMap<>();
    final List<Runnable> guards = new ArrayList<>();
    Runnable beforeCommit;
    boolean unknownCommitted;
    int reads, commits;
    static String key(VeilRecordKind kind, String id) { return kind.name() + "/" + id; }
    public void checkLive() {}
    public void guardCommit(Runnable guard) { guards.add(guard); }
    public byte[] read(VeilRecordKind kind, String id) { reads++; byte[] b = rows.get(key(kind, id)); return b == null ? null : b.clone(); }
    public void write(VeilRecordKind kind, String id, byte[] bytes) { rows.put(key(kind, id), bytes.clone()); }
    public void remove(VeilRecordKind kind, String id) { rows.remove(key(kind, id)); }
    public List<String> ids(VeilRecordKind kind) {
      String prefix = kind.name() + "/"; List<String> ids = new ArrayList<>();
      for (String key : rows.keySet()) if (key.startsWith(prefix)) ids.add(key.substring(prefix.length())); return ids;
    }
    Map<String, byte[]> snapshot() { Map<String, byte[]> copy = new LinkedHashMap<>(); rows.forEach((k,v) -> copy.put(k,v.clone())); return copy; }
    <T> T atomic(Action<T> action) throws Exception {
      Map<String, byte[]> before = snapshot(); boolean committed = false; T result = null; guards.clear();
      try {
        result = action.run(); if (beforeCommit != null) beforeCommit.run();
        for (Runnable check : guards) check.run(); commits++; committed = true;
        if (unknownCommitted) { unknownCommitted = false; throw new IllegalStateException("VEIL_NATIVE_RECOVERY_REQUIRED"); }
        return result;
      } catch (Exception error) {
        if (!committed) rows = before;
        if (result instanceof AutoCloseable closeable) closeable.close();
        throw error;
      } finally { guards.clear(); }
    }
  }
  static final class Fixture {
    final Port sender = new Port(), receiver = new Port();
    final SignalProtocolAddress alice = VeilSignalAddress.of("alice.public", 1).sdk();
    final SignalProtocolAddress bob = VeilSignalAddress.of("bob.public", 2).sdk();
    final IdentityKeyPair aliceKey = IdentityKeyPair.generate(), bobKey = IdentityKeyPair.generate();
    final VeilApplicationContext outgoing, incoming;
    boolean current = true;
    final VeilContextAuthority sendAuthority, receiveAuthority;
    Fixture() throws Exception {
      outgoing = new VeilApplicationContext("independently-mapped-direct-A", device(alice, aliceKey, 1), device(bob, bobKey, 1), 1);
      incoming = new VeilApplicationContext(outgoing.route, outgoing.peer, outgoing.local, 1);
      sendAuthority = authority(outgoing); receiveAuthority = authority(incoming);
      int aRegistration = KeyHelper.generateRegistrationId(false), bRegistration = KeyHelper.generateRegistrationId(false);
      seed(sender, alice, aliceKey, aRegistration, bob, bobKey);
      seed(receiver, bob, bobKey, bRegistration, alice, aliceKey);
      ECKeyPair pre = ECKeyPair.generate(), signed = ECKeyPair.generate();
      KEMKeyPair kem = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
      byte[] signature = bobKey.getPrivateKey().calculateSignature(signed.getPublicKey().serialize());
      byte[] kemSignature = bobKey.getPrivateKey().calculateSignature(kem.getPublicKey().serialize());
      VeilSignalProtocolStore receivingStore = new VeilSignalProtocolStore(receiver, bobKey.getPublicKey());
      receivingStore.storePreKey(11, new PreKeyRecord(11, pre));
      receivingStore.storeSignedPreKey(12, new SignedPreKeyRecord(12, 0L, signed, signature));
      receiver.write(VeilRecordKind.KEM_PREKEY_MODE, "13", new byte[] { 0 });
      receivingStore.storeKyberPreKey(13, new KyberPreKeyRecord(13, 0L, kem, kemSignature));
      PreKeyBundle bundle = new PreKeyBundle(bRegistration, 2, 11, pre.getPublicKey(), 12, signed.getPublicKey(),
          signature, bobKey.getPublicKey(), 13, kem.getPublicKey(), kemSignature);
      sender.atomic(() -> { new SessionBuilder(new VeilSignalProtocolStore(sender, aliceKey.getPublicKey()), bob, alice).process(bundle); return null; });
    }
    VeilContextAuthority authority(VeilApplicationContext context) {
      return new VeilContextAuthority((tx, handle) -> {
        // Explicit engineering directory map, NOT request-derived trust or production provider.
        if (!current) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
        VeilApplicationContext grant = handle.equals("ui-room-A") ? context :
            new VeilApplicationContext("independently-mapped-direct-B", context.local, context.peer, context.epoch);
        return new VeilContextAuthority.Grant(grant, () -> {
          if (!current) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
        });
      });
    }
    VeilSignalOutbox.PendingCiphertext send(UUID op, byte[] content) throws Exception {
      return sender.atomic(() -> VeilSignalOutbox.encryptInTransaction(sender, sendAuthority,
          aliceKey.getPublicKey(), alice, op, "ui-room-A", bob, content));
    }
    VeilSignalInbox.ReceivedMessage receive(UUID op, String handle, VeilSignalOutbox.PendingCiphertext packet) throws Exception {
      return receiver.atomic(() -> VeilSignalInbox.decryptInTransaction(receiver, receiveAuthority,
          bobKey.getPublicKey(), bob, op, handle, alice, packet.type, packet.serialize()));
    }
    VeilSignalOutbox.PendingCiphertext adversarial(byte[] envelope) throws Exception {
      return sender.atomic(() -> {
        CiphertextMessage packet = new SessionCipher(new VeilSignalProtocolStore(sender, aliceKey.getPublicKey()), alice, bob).encrypt(envelope);
        return new VeilSignalOutbox.PendingCiphertext(packet.getType(), UUID.randomUUID(), packet.serialize());
      });
    }
  }
  private static VeilApplicationContext.Device device(SignalProtocolAddress address, IdentityKeyPair pair, long generation) {
    return new VeilApplicationContext.Device(address.getName(), address.getDeviceId(), pair.getPublicKey().serialize(), generation);
  }
  private static void seed(Port port, SignalProtocolAddress address, IdentityKeyPair pair, int registration,
      SignalProtocolAddress peer, IdentityKeyPair other) {
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "public", pair.getPublicKey().serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "identity", pair.serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "registration", ByteBuffer.allocate(4).putInt(registration).array());
    port.write(VeilRecordKind.SOCIAL_IDENTITY, "signal-address", address.toString().getBytes(StandardCharsets.UTF_8));
    port.write(VeilRecordKind.IDENTITY_PIN, peer.toString(), other.getPublicKey().serialize());
  }
  private static boolean same(Map<String, byte[]> a, Map<String, byte[]> b) {
    if (!a.keySet().equals(b.keySet())) return false;
    for (String key : a.keySet()) if (!Arrays.equals(a.get(key), b.get(key))) return false; return true;
  }
  private static void check(boolean condition, String name) { if (!condition) throw new AssertionError(name); System.out.println("PASS " + name); }
  private static void rejects(Action<?> action, String code) throws Exception {
    try { action.run(); } catch (IllegalStateException error) { if (!code.equals(error.getMessage())) throw error; return; }
    throw new AssertionError("expected " + code);
  }
  public static void main(String[] args) throws Exception {
    Fixture fixture = new Fixture(); byte[] body = "public opaque V2 QA body".getBytes(StandardCharsets.UTF_8);
    UUID senderOp = UUID.randomUUID(), receiverOp = UUID.randomUUID();
    VeilSignalOutbox.PendingCiphertext first = fixture.send(senderOp, body);
    Map<String, byte[]> before = fixture.receiver.snapshot();
    int commits = fixture.receiver.commits;
    rejects(() -> fixture.receive(UUID.randomUUID(), "ui-room-B", first), "VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
    check(same(before, fixture.receiver.rows) && commits == fixture.receiver.commits,
        "original actual SDK cross-room attack rejects with zero message/receipt/ratchet/prekey commits");
    try (VeilSignalInbox.ReceivedMessage received = fixture.receive(receiverOp, "ui-room-A", first)) {
      check(Arrays.equals(body, received.bytes()) && received.senderMessageId.equals(first.senderMessageId) &&
          received.originalOperation.equals(receiverOp), "actual SDK receive permits independent recipient local operation");
    }
    Map<String, byte[]> senderState = fixture.sender.snapshot();
    VeilSignalOutbox.PendingCiphertext retry = fixture.send(senderOp, body);
    check(retry.senderMessageId.equals(first.senderMessageId) && Arrays.equals(retry.serialize(), first.serialize()) &&
        same(senderState, fixture.sender.rows), "same sender operation retains immutable message ID/ciphertext without ratchet advancement");
    int messages = fixture.receiver.ids(VeilRecordKind.INBOX_MESSAGE).size();
    try (VeilSignalInbox.ReceivedMessage replay = fixture.receive(UUID.randomUUID(), "ui-room-A", first)) {
      check(replay.originalOperation.equals(receiverOp) && Arrays.equals(replay.bytes(), body) &&
          fixture.receiver.ids(VeilRecordKind.INBOX_MESSAGE).size() == messages &&
          fixture.receiver.ids(VeilRecordKind.AUTHENTICATED_REPLAY).size() == 1,
          "same authenticated sender message under new local operation returns original record, not a new message");
    }
    rejects(() -> fixture.send(senderOp, new byte[] { 9 }), "VEIL_AUTHENTICATED_MESSAGE_REUSE");
    check(same(senderState, fixture.sender.rows), "changed sender content under original operation cannot silently resend");

    List<VeilApplicationContext> wrong = List.of(
        new VeilApplicationContext("different-trusted-route", fixture.outgoing.local, fixture.outgoing.peer, 1),
        new VeilApplicationContext(fixture.outgoing.route,
            new VeilApplicationContext.Device(fixture.outgoing.local.name, 3, fixture.outgoing.local.identity(), 1), fixture.outgoing.peer, 1),
        new VeilApplicationContext(fixture.outgoing.route, fixture.outgoing.local,
            new VeilApplicationContext.Device(fixture.outgoing.peer.name, 3, fixture.outgoing.peer.identity(), 1), 1),
        new VeilApplicationContext(fixture.outgoing.route,
            new VeilApplicationContext.Device("other-sender", 1, fixture.outgoing.local.identity(), 1), fixture.outgoing.peer, 1),
        new VeilApplicationContext(fixture.outgoing.route, fixture.outgoing.local,
            new VeilApplicationContext.Device("other-recipient", 2, fixture.outgoing.peer.identity(), 1), 1),
        new VeilApplicationContext(fixture.outgoing.route,
            new VeilApplicationContext.Device(fixture.outgoing.local.name, 1, fixture.outgoing.peer.identity(), 1), fixture.outgoing.peer, 1),
        new VeilApplicationContext(fixture.outgoing.route, fixture.outgoing.local,
            new VeilApplicationContext.Device(fixture.outgoing.peer.name, 2, fixture.outgoing.local.identity(), 1), 1),
        new VeilApplicationContext(fixture.outgoing.route,
            new VeilApplicationContext.Device(fixture.outgoing.local.name, 1, fixture.outgoing.local.identity(), 2), fixture.outgoing.peer, 1),
        new VeilApplicationContext(fixture.outgoing.route, fixture.outgoing.local,
            new VeilApplicationContext.Device(fixture.outgoing.peer.name, 2, fixture.outgoing.peer.identity(), 2), 1),
        new VeilApplicationContext(fixture.outgoing.route, fixture.outgoing.local, fixture.outgoing.peer, 2));
    for (VeilApplicationContext context : wrong) {
      VeilSignalOutbox.PendingCiphertext attack = fixture.adversarial(VeilAuthenticatedEnvelope.encode(context, true, UUID.randomUUID(), body));
      Map<String, byte[]> state = fixture.receiver.snapshot();
      rejects(() -> fixture.receive(UUID.randomUUID(), "ui-room-A", attack), "VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
      check(same(state, fixture.receiver.rows), "actual SDK rejects changed authenticated route/device/identity/generation/epoch without commit");
    }
    byte[] changedBody = new byte[] { 4, 5 };
    VeilSignalOutbox.PendingCiphertext reused = fixture.adversarial(VeilAuthenticatedEnvelope.encode(fixture.outgoing, true, first.senderMessageId, changedBody));
    Map<String, byte[]> retained = fixture.receiver.snapshot();
    rejects(() -> fixture.receive(UUID.randomUUID(), "ui-room-A", reused), "VEIL_AUTHENTICATED_MESSAGE_REUSE");
    check(same(retained, fixture.receiver.rows), "same authenticated message ID with changed cipher/body cannot create a second message");

    byte[] canonical = VeilAuthenticatedEnvelope.encode(fixture.outgoing, true, UUID.randomUUID(), body);
    byte[] version = canonical.clone(); version[9] = 3;
    byte[] suite = canonical.clone(); suite[12] ^= 1;
    byte[] mode = canonical.clone(); mode[12 + VeilApplicationContext.SUITE.length()] = 2;
    int routeStart = 12 + VeilApplicationContext.SUITE.length() + 1 + 2;
    byte[] invalidUtf8 = canonical.clone(); invalidUtf8[routeStart] = (byte) 0xc0; invalidUtf8[routeStart + 1] = (byte) 0xaf;
    List<byte[]> malformed = List.of(version, suite, mode, invalidUtf8,
        Arrays.copyOf(canonical, canonical.length - 1), Arrays.copyOf(canonical, canonical.length + 1));
    String[] codes = { "VEIL_ENVELOPE_VERSION_UNSUPPORTED", "VEIL_ENVELOPE_SUITE_UNSUPPORTED", "VEIL_ENVELOPE_INVALID",
        "VEIL_ENVELOPE_INVALID", "VEIL_ENVELOPE_INVALID", "VEIL_ENVELOPE_INVALID" };
    for (int i = 0; i < malformed.size(); i++) {
      VeilSignalOutbox.PendingCiphertext attack = fixture.adversarial(malformed.get(i));
      Map<String, byte[]> state = fixture.receiver.snapshot(); final String code = codes[i];
      rejects(() -> fixture.receive(UUID.randomUUID(), "ui-room-A", attack), code);
      check(same(state, fixture.receiver.rows), "actual SDK malformed/version/suite/group/truncated/trailing payload refuses without fallback");
    }
    byte[] maximum = new byte[65536]; maximum[0] = 7;
    VeilSignalOutbox.PendingCiphertext large = fixture.send(UUID.randomUUID(), maximum);
    try (VeilSignalInbox.ReceivedMessage received = fixture.receive(UUID.randomUUID(), "ui-room-A", large)) {
      check(Arrays.equals(received.bytes(), maximum), "actual SDK supports full64KiB content inside bounded68KiB application envelope");
    }
    rejects(() -> fixture.send(UUID.randomUUID(), new byte[65537]), "VEIL_ENVELOPE_INVALID");
    rejects(() -> new VeilApplicationContext("\uD800", fixture.outgoing.local, fixture.outgoing.peer, 1), "VEIL_ENVELOPE_INVALID");
    check(true, "oversized content and malformed UTF16 refuse before provider/crypto work");
    byte[] mutable = body.clone(), originalContent = mutable.clone();
    VeilContextAuthority mutatingProvider = new VeilContextAuthority((tx, handle) -> {
      mutable[0] ^= 1;
      return new VeilContextAuthority.Grant(fixture.outgoing, () -> {});
    });
    VeilSignalOutbox.PendingCiphertext snapshotted = fixture.sender.atomic(() ->
        VeilSignalOutbox.encryptInTransaction(fixture.sender, mutatingProvider, fixture.aliceKey.getPublicKey(),
            fixture.alice, UUID.randomUUID(), "ui-room-A", fixture.bob, mutable));
    try (VeilSignalInbox.ReceivedMessage received = fixture.receive(UUID.randomUUID(), "ui-room-A", snapshotted)) {
      check(Arrays.equals(received.bytes(), originalContent), "mutable caller content is snapshotted before independent provider entry");
    }
    VeilApplicationContext unicode = new VeilApplicationContext("\u8def\u7531.\uD83D\uDE80",
        new VeilApplicationContext.Device("\u53d1\u9001.\uD83D\uDE80", 1, fixture.outgoing.local.identity(), -1L),
        new VeilApplicationContext.Device("\u63a5\u6536.\u00e9", 127, fixture.outgoing.peer.identity(), Long.MIN_VALUE), -1L);
    byte[] unicodeBytes = VeilAuthenticatedEnvelope.encode(unicode, true, UUID.randomUUID(), body);
    try (VeilAuthenticatedEnvelope.Decoded decoded = VeilAuthenticatedEnvelope.decode(unicodeBytes)) {
      decoded.match(unicode, true);
      check(Arrays.equals(decoded.content(), body), "canonical Unicode/device127/full unsigned64 bits roundtrip without normalization or numeric truncation");
    }
    Arrays.fill(unicodeBytes, (byte) 0);
    UUID unknown = UUID.randomUUID(); fixture.sender.unknownCommitted = true;
    rejects(() -> fixture.send(unknown, body), "VEIL_NATIVE_RECOVERY_REQUIRED");
    Map<String, byte[]> coldState = fixture.sender.snapshot();
    VeilSignalOutbox.PendingCiphertext cold = fixture.send(unknown, body);
    check(same(coldState, fixture.sender.rows), "unknown committed sender operation reads original durable-model outbox without reencrypt");
    UUID unknownReceive = UUID.randomUUID(); fixture.receiver.unknownCommitted = true;
    rejects(() -> fixture.receive(unknownReceive, "ui-room-A", cold), "VEIL_NATIVE_RECOVERY_REQUIRED");
    try (VeilSignalInbox.ReceivedMessage recovered = fixture.receive(unknownReceive, "ui-room-A", cold)) {
      check(recovered.originalOperation.equals(unknownReceive) && Arrays.equals(body, recovered.bytes()),
          "unknown committed receive recovers original durable-model replay mapping without redecrypt");
    }
    Map<String, byte[]> beforeRevoke = fixture.sender.snapshot(); fixture.sender.beforeCommit = () -> fixture.current = false;
    rejects(() -> fixture.send(UUID.randomUUID(), body), "VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    check(same(beforeRevoke, fixture.sender.rows), "late independent admission revoke at final commit guard rolls back candidate SDK state");
    fixture.current = true; fixture.sender.beforeCommit = null;
    int readsBefore = fixture.sender.reads;
    rejects(() -> VeilSignalOutbox.encryptInTransaction(fixture.sender, fixture.aliceKey.getPublicKey(), fixture.alice,
        UUID.randomUUID(), "ui-room-A", fixture.bob, body), "VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    check(readsBefore == fixture.sender.reads, "missing production independent context does not borrow request metadata or private store values");
    String messageKey = fixture.receiver.ids(VeilRecordKind.INBOX_MESSAGE).get(0);
    fixture.receiver.remove(VeilRecordKind.INBOX_MESSAGE, messageKey);
    Map<String, byte[]> orphaned = fixture.receiver.snapshot();
    rejects(() -> fixture.receive(receiverOp, "ui-room-A", first), "VEIL_NATIVE_RECOVERY_REQUIRED");
    check(same(orphaned, fixture.receiver.rows), "orphan durable-model replay mapping requires recovery, no reset or reenrollment");
    System.out.println("PASS full direct V2 actual-SDK batch; synthetic directory/provenance and atomic-memory only; no real provider/OS/activation proof");
  }
}
