package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.signal.libsignal.protocol.*;
import org.signal.libsignal.protocol.ecc.ECPublicKey;
import org.signal.libsignal.protocol.groups.state.SenderKeyRecord;
import org.signal.libsignal.protocol.state.*;

/**
 * Isolated official 0.104.0 JNI callback adapter. Not in active Gradle sources.
 * Requires a live native transaction and the independently admitted own public
 * identity. No TOFU, SSO enrollment, key generation or automatic mode selection.
 */
final class VeilSignalProtocolStore implements SignalProtocolStore {
  private final VeilRecordTransaction tx;
  private final IdentityKey approvedOwnIdentity;
  VeilSignalProtocolStore(VeilRecordTransaction tx, IdentityKey approvedOwnIdentity) {
    this.tx = Objects.requireNonNull(tx);
    this.approvedOwnIdentity = Objects.requireNonNull(approvedOwnIdentity);
    tx.checkLive();
  }
  private interface Decode<T> { T run(byte[] bytes) throws Exception; }
  private <T> T decoded(VeilRecordKind kind, String id, Decode<T> decoder) {
    tx.checkLive();
    byte[] bytes = tx.read(kind, id);
    if (bytes == null) throw new IllegalStateException("VEIL_ENROLLED_RECORD_MISSING");
    try { T value = decoder.run(bytes); tx.checkLive(); return value; }
    catch (Exception error) { throw new IllegalStateException("VEIL_ENROLLED_RECORD_REJECTED"); }
    finally { Arrays.fill(bytes, (byte) 0); }
  }
  private void saved(VeilRecordKind kind, String id, byte[] bytes) {
    try { tx.checkLive(); tx.write(kind, id, bytes); }
    finally { Arrays.fill(bytes, (byte) 0); }
  }
  private boolean present(VeilRecordKind kind, String id) {
    tx.checkLive();
    byte[] bytes = tx.read(kind, id);
    if (bytes == null) return false;
    Arrays.fill(bytes, (byte) 0);
    return true;
  }
  private static String keyId(int id) {
    if (id < 0 || id > 0xffffff) throw new IllegalArgumentException("VEIL_KEY_ID_REJECTED");
    return Integer.toString(id);
  }
  @Override public IdentityKeyPair getIdentityKeyPair() {
    // Verify the admitted public pin before decrypting the private pair record.
    IdentityKey pin = decoded(VeilRecordKind.SOCIAL_IDENTITY, "public", IdentityKey::new);
    if (!pin.equals(approvedOwnIdentity)) throw new IllegalStateException("VEIL_OWN_IDENTITY_MISMATCH");
    IdentityKeyPair pair = decoded(VeilRecordKind.SOCIAL_IDENTITY, "identity", IdentityKeyPair::new);
    if (!pair.getPublicKey().equals(pin) || !new IdentityKey(pair.getPrivateKey().publicKey()).equals(pin))
      throw new IllegalStateException("VEIL_PRIVATE_PAIR_MISMATCH");
    return pair;
  }
  @Override public int getLocalRegistrationId() {
    return decoded(VeilRecordKind.SOCIAL_IDENTITY, "registration", bytes -> {
      if (bytes.length != 4) throw new IllegalStateException();
      int value = ByteBuffer.wrap(bytes).getInt();
      if (value <= 0) throw new IllegalStateException();
      return value;
    });
  }
  @Override public IdentityChange saveIdentity(SignalProtocolAddress address, IdentityKey identity) {
    if (!isTrustedIdentity(address, identity, Direction.SENDING)) throw new IllegalStateException("VEIL_PEER_PIN_REQUIRED");
    return IdentityChange.NEW_OR_UNCHANGED;
  }
  @Override public boolean isTrustedIdentity(SignalProtocolAddress address, IdentityKey identity, Direction direction) {
    IdentityKey pin = getIdentity(address);
    return pin != null && pin.equals(identity);
  }
  @Override public IdentityKey getIdentity(SignalProtocolAddress address) {
    if (!present(VeilRecordKind.IDENTITY_PIN, address.toString())) return null;
    return decoded(VeilRecordKind.IDENTITY_PIN, address.toString(), IdentityKey::new);
  }
  @Override public SessionRecord loadSession(SignalProtocolAddress address) {
    if (!present(VeilRecordKind.SESSION, address.toString())) return new SessionRecord();
    return decoded(VeilRecordKind.SESSION, address.toString(), SessionRecord::new);
  }
  @Override public List<SessionRecord> loadExistingSessions(List<SignalProtocolAddress> addresses) throws NoSessionException {
    List<SessionRecord> records = new ArrayList<>();
    for (SignalProtocolAddress address : addresses) {
      if (!containsSession(address)) throw new NoSessionException(address, "VEIL_SESSION_MISSING");
      records.add(loadSession(address));
    }
    return records;
  }
  @Override public List<Integer> getSubDeviceSessions(String name) {
    List<Integer> devices = new ArrayList<>();
    String prefix = name + ".";
    for (String id : tx.ids(VeilRecordKind.SESSION)) if (id.startsWith(prefix)) {
      int device = Integer.parseInt(id.substring(prefix.length()));
      if (device < 1 || device > 127) throw new IllegalStateException("VEIL_DEVICE_ID_REJECTED");
      if (device != 1) devices.add(device);
    }
    return devices;
  }
  @Override public void storeSession(SignalProtocolAddress address, SessionRecord record) { saved(VeilRecordKind.SESSION, address.toString(), record.serialize()); }
  @Override public boolean containsSession(SignalProtocolAddress address) { return present(VeilRecordKind.SESSION, address.toString()); }
  @Override public void deleteSession(SignalProtocolAddress address) { tx.remove(VeilRecordKind.SESSION, address.toString()); }
  @Override public void deleteAllSessions(String name) {
    for (String id : tx.ids(VeilRecordKind.SESSION)) if (id.startsWith(name + ".")) tx.remove(VeilRecordKind.SESSION, id);
  }
  @Override public PreKeyRecord loadPreKey(int id) throws InvalidKeyIdException {
    if (!containsPreKey(id)) throw new InvalidKeyIdException("VEIL_PREKEY_MISSING");
    return decoded(VeilRecordKind.PREKEY, keyId(id), PreKeyRecord::new);
  }
  @Override public void storePreKey(int id, PreKeyRecord record) {
    if (record.getId() != id) throw new IllegalStateException("VEIL_PREKEY_BINDING_REJECTED");
    saved(VeilRecordKind.PREKEY, keyId(id), record.serialize());
  }
  @Override public boolean containsPreKey(int id) { return present(VeilRecordKind.PREKEY, keyId(id)); }
  @Override public void removePreKey(int id) { tx.remove(VeilRecordKind.PREKEY, keyId(id)); }
  @Override public SignedPreKeyRecord loadSignedPreKey(int id) throws InvalidKeyIdException {
    if (!containsSignedPreKey(id)) throw new InvalidKeyIdException("VEIL_SIGNED_PREKEY_MISSING");
    return decoded(VeilRecordKind.SIGNED_PREKEY, keyId(id), SignedPreKeyRecord::new);
  }
  @Override public List<SignedPreKeyRecord> loadSignedPreKeys() {
    List<SignedPreKeyRecord> records = new ArrayList<>();
    for (String id : tx.ids(VeilRecordKind.SIGNED_PREKEY)) records.add(decoded(VeilRecordKind.SIGNED_PREKEY, id, SignedPreKeyRecord::new));
    return records;
  }
  @Override public void storeSignedPreKey(int id, SignedPreKeyRecord record) {
    if (record.getId() != id) throw new IllegalStateException("VEIL_SIGNED_PREKEY_BINDING_REJECTED");
    saved(VeilRecordKind.SIGNED_PREKEY, keyId(id), record.serialize());
  }
  @Override public boolean containsSignedPreKey(int id) { return present(VeilRecordKind.SIGNED_PREKEY, keyId(id)); }
  @Override public void removeSignedPreKey(int id) { tx.remove(VeilRecordKind.SIGNED_PREKEY, keyId(id)); }
  private int kemMode(int id) {
    return decoded(VeilRecordKind.KEM_PREKEY_MODE, keyId(id), bytes -> {
      if (bytes.length != 1 || (bytes[0] != 0 && bytes[0] != 1)) throw new IllegalStateException("VEIL_KEM_MODE_REQUIRED");
      return (int) bytes[0]; // Protected enrollment: 0=one-time, 1=last-resort.
    });
  }
  @Override public KyberPreKeyRecord loadKyberPreKey(int id) throws InvalidKeyIdException {
    kemMode(id);
    if (!containsKyberPreKey(id)) throw new InvalidKeyIdException("VEIL_KEM_PREKEY_MISSING");
    return decoded(VeilRecordKind.KEM_PREKEY, keyId(id), KyberPreKeyRecord::new);
  }
  @Override public List<KyberPreKeyRecord> loadKyberPreKeys() {
    List<KyberPreKeyRecord> records = new ArrayList<>();
    for (String id : tx.ids(VeilRecordKind.KEM_PREKEY)) { kemMode(Integer.parseInt(id)); records.add(decoded(VeilRecordKind.KEM_PREKEY, id, KyberPreKeyRecord::new)); }
    return records;
  }
  @Override public void storeKyberPreKey(int id, KyberPreKeyRecord record) {
    kemMode(id);
    if (record.getId() != id) throw new IllegalStateException("VEIL_KEM_BINDING_REJECTED");
    saved(VeilRecordKind.KEM_PREKEY, keyId(id), record.serialize());
  }
  @Override public boolean containsKyberPreKey(int id) { return present(VeilRecordKind.KEM_PREKEY, keyId(id)); }
  @Override public void markKyberPreKeyUsed(int id, int signedId, ECPublicKey baseKey) throws ReusedBaseKeyException {
    tx.checkLive();
    int mode = kemMode(id);
    keyId(signedId);
    if (!containsKyberPreKey(id)) throw new ReusedBaseKeyException("VEIL_KEM_ALREADY_CONSUMED");
    String marker = keyId(id) + ":" + keyId(signedId) + ":" + java.util.HexFormat.of().formatHex(baseKey.serialize());
    if (present(VeilRecordKind.USED_KEM, marker)) throw new ReusedBaseKeyException("VEIL_KEM_BASE_KEY_REUSED");
    saved(VeilRecordKind.USED_KEM, marker, new byte[] {1});
    if (mode == 0) tx.remove(VeilRecordKind.KEM_PREKEY, keyId(id));
  }
  @Override public void storeSenderKey(SignalProtocolAddress sender, UUID distribution, SenderKeyRecord record) {
    tx.checkLive(); throw new UnsupportedOperationException("VEIL_PAIRED_GROUP_FANOUT_REQUIRED");
  }
  @Override public SenderKeyRecord loadSenderKey(SignalProtocolAddress sender, UUID distribution) {
    tx.checkLive(); throw new UnsupportedOperationException("VEIL_LEGACY_SENDER_KEY_READ_REQUIRES_LEGACY_READER");
  }
}
