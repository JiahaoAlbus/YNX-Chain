package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.signal.libsignal.protocol.IdentityKeyPair;
import org.signal.libsignal.protocol.SessionBuilder;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.ecc.ECKeyPair;
import org.signal.libsignal.protocol.kem.KEMKeyPair;
import org.signal.libsignal.protocol.kem.KEMKeyType;
import org.signal.libsignal.protocol.message.CiphertextMessage;
import org.signal.libsignal.protocol.message.PreKeySignalMessage;
import org.signal.libsignal.protocol.message.SignalMessage;
import org.signal.libsignal.protocol.state.KyberPreKeyRecord;
import org.signal.libsignal.protocol.state.PreKeyBundle;
import org.signal.libsignal.protocol.state.PreKeyRecord;
import org.signal.libsignal.protocol.state.SignedPreKeyRecord;
import org.signal.libsignal.protocol.util.KeyHelper;

/** Real original SDK/native adapter pipeline. Synthetic pins and memory atomicity;
 * not device enrollment, SQLite/checkpoint atomicity, Matrix, or platform proof. */
public final class VeilColdRatchetCheck {
  private static final String ROOM = "!cold-ratchet:example.test";
  private static int checks, messages, pqMessages;
  private static final Set<String> curveRatchets = new HashSet<>();

  private static void require(boolean value, String label) {
    if (!value) throw new AssertionError(label);
    ++checks;
  }

  private static boolean same(Map<String, byte[]> a, Map<String, byte[]> b) {
    if (!a.keySet().equals(b.keySet())) return false;
    for (String key : a.keySet()) if (!Arrays.equals(a.get(key), b.get(key))) return false;
    return true;
  }

  private static final class Peer {
    final VeilEnvelopeCheck.Port port;
    final SignalProtocolAddress address;
    final IdentityKeyPair identity;
    final int registration;
    final VeilSignalProtocolStore sdk;
    VeilApplicationContext syntheticContext;
    VeilContextAuthority syntheticAuthority;

    Peer(String name, int device) {
      port = new VeilEnvelopeCheck.Port();
      address = new SignalProtocolAddress(name, device);
      identity = IdentityKeyPair.generate();
      registration = KeyHelper.generateRegistrationId(false);
      port.write(VeilRecordKind.SOCIAL_IDENTITY, "public", identity.getPublicKey().serialize());
      port.write(VeilRecordKind.SOCIAL_IDENTITY, "identity", identity.serialize());
      port.write(VeilRecordKind.SOCIAL_IDENTITY, "registration", ByteBuffer.allocate(4).putInt(registration).array());
      port.write(VeilRecordKind.SOCIAL_IDENTITY, "signal-address", address.toString().getBytes(StandardCharsets.UTF_8));
      sdk = new VeilSignalProtocolStore(port, identity.getPublicKey());
    }

    Peer(Peer previous) throws Exception {
      port = new VeilEnvelopeCheck.Port();
      port.rows = previous.port.snapshot();
      address = previous.address;
      identity = new IdentityKeyPair(port.read(VeilRecordKind.SOCIAL_IDENTITY, "identity"));
      registration = ByteBuffer.wrap(port.read(VeilRecordKind.SOCIAL_IDENTITY, "registration")).getInt();
      sdk = new VeilSignalProtocolStore(port, previous.identity.getPublicKey());
      syntheticContext = previous.syntheticContext.copy();
      syntheticAuthority = authority(syntheticContext);
      require(Arrays.equals(identity.getPublicKey().serialize(), previous.identity.getPublicKey().serialize()), "cold identity is retained, not regenerated");
    }

    void pinSyntheticPeer(Peer other) {
      port.write(VeilRecordKind.IDENTITY_PIN, other.address.toString(), other.identity.getPublicKey().serialize());
      syntheticContext = new VeilApplicationContext("independently-mapped-cold-ratchet",
          new VeilApplicationContext.Device(address.getName(), address.getDeviceId(), identity.getPublicKey().serialize(), 1),
          new VeilApplicationContext.Device(other.address.getName(), other.address.getDeviceId(), other.identity.getPublicKey().serialize(), 1), 1);
      syntheticAuthority = authority(syntheticContext);
    }
  }

  private static VeilContextAuthority authority(VeilApplicationContext context) {
    // Explicit controlled engineering directory, not a production authority or
    // a grant inferred from request/SSO/Wallet metadata. No real revocation proof.
    return new VeilContextAuthority((tx, handle) -> {
      if (!ROOM.equals(handle)) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
      return new VeilContextAuthority.Grant(context, () -> {});
    });
  }

  private static final class Wire {
    final UUID operation;
    final int type;
    final byte[] ciphertext;
    final byte[] expected;
    Wire(UUID operation, int type, byte[] ciphertext, byte[] expected) {
      this.operation = operation; this.type = type;
      this.ciphertext = ciphertext; this.expected = expected;
    }
  }

  private static Wire send(Peer sender, Peer receiver, String label) throws Exception {
    UUID operation = UUID.randomUUID();
    byte[] expected = label.getBytes(StandardCharsets.UTF_8);
    VeilSignalOutbox.PendingCiphertext pending = sender.port.atomic(() ->
        VeilSignalOutbox.encryptInTransaction(sender.port, sender.syntheticAuthority, sender.identity.getPublicKey(),
            sender.address, operation, ROOM, receiver.address, expected));
    byte[] serialized = pending.serialize();
    SignalMessage inner;
    if (pending.type == CiphertextMessage.PREKEY_TYPE) {
      inner = new PreKeySignalMessage(serialized).getWhisperMessage();
    } else {
      require(pending.type == CiphertextMessage.WHISPER_TYPE, "supported session message type");
      inner = new SignalMessage(serialized);
    }
    byte[] pq = inner.getPqRatchet();
    require(pq != null && pq.length > 0, "actual SDK ciphertext has a nonempty PQ ratchet field");
    ++pqMessages;
    curveRatchets.add(java.util.HexFormat.of().formatHex(inner.getSenderRatchetKey().serialize()));
    ++messages;
    return new Wire(operation, pending.type, serialized, expected);
  }

  private static void receive(Peer recipient, Peer sender, Wire wire) throws Exception {
    byte[] unchanged = wire.ciphertext.clone();
    try (VeilSignalInbox.ReceivedMessage message = recipient.port.atomic(() ->
        VeilSignalInbox.decryptInTransaction(recipient.port, recipient.syntheticAuthority, recipient.identity.getPublicKey(),
            recipient.address, wire.operation, ROOM, sender.address, wire.type, wire.ciphertext))) {
      require(Arrays.equals(message.bytes(), wire.expected), "actual native inbox plaintext matches sender");
    }
    require(Arrays.equals(unchanged, wire.ciphertext), "caller ciphertext remains unchanged");
  }

  public static void main(String[] args) throws Exception {
    Peer a = new Peer("cold-ratchet-a.public", 1);
    Peer b = new Peer("cold-ratchet-b.public", 2);
    a.pinSyntheticPeer(b);
    b.pinSyntheticPeer(a);
    Peer initialA = a, initialB = b;
    Map<String, byte[]> noAuthorityState = a.port.snapshot();
    boolean noAuthorityRefused = false;
    try {
      a.port.atomic(() -> VeilSignalOutbox.encryptInTransaction(initialA.port, initialA.identity.getPublicKey(),
          initialA.address, UUID.randomUUID(), ROOM, initialB.address, new byte[] {1}));
    } catch (IllegalStateException error) {
      if (!"VEIL_APPLICATION_CONTEXT_UNAVAILABLE".equals(error.getMessage())) throw error;
      noAuthorityRefused = true;
    }
    require(noAuthorityRefused && same(noAuthorityState, a.port.rows), "original missing-authority guard still rejects before state mutation");
    ECKeyPair pre = ECKeyPair.generate();
    ECKeyPair signed = ECKeyPair.generate();
    KEMKeyPair kem = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
    byte[] signature = b.identity.getPrivateKey().calculateSignature(signed.getPublicKey().serialize());
    byte[] kemSignature = b.identity.getPrivateKey().calculateSignature(kem.getPublicKey().serialize());
    b.sdk.storePreKey(11, new PreKeyRecord(11, pre));
    b.sdk.storeSignedPreKey(12, new SignedPreKeyRecord(12, 0L, signed, signature));
    b.port.write(VeilRecordKind.KEM_PREKEY_MODE, "13", new byte[] { 0 });
    b.sdk.storeKyberPreKey(13, new KyberPreKeyRecord(13, 0L, kem, kemSignature));
    PreKeyBundle bundle = new PreKeyBundle(b.registration, 2, 11, pre.getPublicKey(),
        12, signed.getPublicKey(), signature, b.identity.getPublicKey(), 13, kem.getPublicKey(), kemSignature);
    new SessionBuilder(a.sdk, b.address, a.address).process(bundle);
    Wire first = send(a, b, "synthetic PQ bootstrap");
    receive(b, a, first);
    require(!b.sdk.containsPreKey(11) && !b.sdk.containsKyberPreKey(13), "actual one-time curve and KEM prekeys consumed");

    for (int round = 0; round < 32; ++round) {
      receive(a, b, send(b, a, "synthetic reply " + round));
      receive(b, a, send(a, b, "synthetic followup " + round));
    }
    Wire[] offline = new Wire[7];
    for (int i = 0; i < offline.length; ++i) offline[i] = send(a, b, "synthetic offline " + i);
    Map<String, byte[]> pending = a.port.snapshot();
    a = new Peer(a);
    b = new Peer(b);
    require(same(pending, a.port.rows), "cold reconstruction preserves pending outbox and evolved session records");
    for (int index : new int[] {6, 0, 4, 1, 5, 2, 3}) receive(b, a, offline[index]);

    Map<String, byte[]> beforeReplay = b.port.snapshot();
    receive(b, a, offline[0]);
    require(same(beforeReplay, b.port.rows), "same operation retry returns retained message without ratchet mutation");
    Wire rejected = send(a, b, "synthetic authentic message after tamper");
    Map<String, byte[]> beforeTamper = b.port.snapshot();
    byte[] tampered = rejected.ciphertext.clone();
    tampered[tampered.length - 1] ^= 1;
    Peer recipient = b;
    Peer sender = a;
    boolean refused = false;
    try {
      try (VeilSignalInbox.ReceivedMessage ignored = b.port.atomic(() ->
          VeilSignalInbox.decryptInTransaction(recipient.port, recipient.syntheticAuthority, recipient.identity.getPublicKey(),
              recipient.address, rejected.operation, ROOM, sender.address, rejected.type, tampered))) {
        // Unexpected successful decryption is closed, then rejected by the assertion.
      }
    } catch (org.signal.libsignal.protocol.InvalidMessageException error) {
      refused = true;
    }
    require(refused, "actual SDK rejects tampered ciphertext");
    require(same(beforeTamper, b.port.rows), "atomic-memory adapter rolls back the tampered receive");
    receive(b, a, rejected);
    receive(a, b, send(b, a, "synthetic continued reply after failed receive"));
    require(curveRatchets.size() > 16, "actual sender curve ratchet keys evolve over bidirectional turns");
    require(pqMessages == messages, "every observed session message retained a nonempty PQ field");
    System.out.println("PASS cold native ratchet checks=" + checks + " messages=" + messages
        + " pqMessages=" + pqMessages + " distinctCurveRatchets=" + curveRatchets.size());
    System.out.println("Synthetic independently pinned peers and atomic-memory transaction only; no OS admission, SQLite/checkpoint, Matrix relay, official build provenance, or complete SPQR/platform acceptance.");
  }
}
