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
  private void savedKey(VeilRecordKind kind, int id, byte[] serialized) {
    String slot = keyId(id);
    byte[] existing = null;
    try {
      tx.checkLive();
      if (present(VeilRecordKind.PREKEY_LIFECYCLE, "retired:" + kind.name() + ":" + slot))
        throw new IllegalStateException("VEIL_PREKEY_ID_RETIRED");
      existing = tx.read(kind, slot);
      if (existing != null && !Arrays.equals(existing, serialized))
        throw new IllegalStateException("VEIL_ENROLLED_PREKEY_REPLACEMENT_REJECTED");
      if (existing == null) tx.write(kind, slot, serialized);
    } finally {
      Arrays.fill(serialized, (byte) 0);
      if (existing != null) Arrays.fill(existing, (byte) 0);
    }
  }
  private void retired(VeilRecordKind kind, int id) {
    tx.checkLive();
    String slot = keyId(id);
    saved(VeilRecordKind.PREKEY_LIFECYCLE, "retired:" + kind.name() + ":" + slot, new byte[] {1});
    tx.remove(kind, slot);
  }
  private static String publicBaseId(byte[] bytes) {
    // Public identifier formatting only; not a KDF, nonce or protocol encoding.
    char[] hex = "0123456789abcdef".toCharArray();
    StringBuilder result = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) { result.append(hex[(value & 255) >>> 4]); result.append(hex[value & 15]); }
    return result.toString();
  }
  private static String keyId(int id) {
    if (id < 0 || id > 0xffffff) throw new IllegalArgumentException("VEIL_KEY_ID_REJECTED");
    return Integer.toString(id);
  }
  @Override public IdentityKeyPair getIdentityKeyPair() {
    tx.checkLive();
    // Verify the admitted public pin before decrypting the private pair record.
    IdentityKey pin = decoded(VeilRecordKind.SOCIAL_IDENTITY, "public", IdentityKey::new);
    if (!pin.equals(approvedOwnIdentity)) throw new IllegalStateException("VEIL_OWN_IDENTITY_MISMATCH");
    IdentityKeyPair pair = decoded(VeilRecordKind.SOCIAL_IDENTITY, "identity", IdentityKeyPair::new);
    if (!pair.getPublicKey().equals(pin) || !new IdentityKey(pair.getPrivateKey().publicKey()).equals(pin))
      throw new IllegalStateException("VEIL_PRIVATE_PAIR_MISMATCH");
    return pair;
  }
  @Override public int getLocalRegistrationId() {
    tx.checkLive();
    return decoded(VeilRecordKind.SOCIAL_IDENTITY, "registration", bytes -> {
      if (bytes.length != 4) throw new IllegalStateException();
      int value = ByteBuffer.wrap(bytes).getInt();
      if (value <= 0) throw new IllegalStateException();
      return value;
    });
  }
  @Override public IdentityChange saveIdentity(SignalProtocolAddress address, IdentityKey identity) {
    tx.checkLive();
    if (!isTrustedIdentity(address, identity, Direction.SENDING)) throw new IllegalStateException("VEIL_PEER_PIN_REQUIRED");
    return IdentityChange.NEW_OR_UNCHANGED;
  }
  @Override public boolean isTrustedIdentity(SignalProtocolAddress address, IdentityKey identity, Direction direction) {
    tx.checkLive();
    IdentityKey pin = getIdentity(address);
    return pin != null && pin.equals(identity);
  }
  @Override public IdentityKey getIdentity(SignalProtocolAddress address) {
    tx.checkLive();
    if (!present(VeilRecordKind.IDENTITY_PIN, address.toString())) return null;
    return decoded(VeilRecordKind.IDENTITY_PIN, address.toString(), IdentityKey::new);
  }
  @Override public SessionRecord loadSession(SignalProtocolAddress address) {
    tx.checkLive();
    if (!present(VeilRecordKind.SESSION, address.toString())) return new SessionRecord();
    return decoded(VeilRecordKind.SESSION, address.toString(), SessionRecord::new);
  }
  @Override public List<SessionRecord> loadExistingSessions(List<SignalProtocolAddress> addresses) throws NoSessionException {
    tx.checkLive();
    List<SessionRecord> records = new ArrayList<>();
    for (SignalProtocolAddress address : addresses) {
      if (!containsSession(address)) throw new NoSessionException(address, "VEIL_SESSION_MISSING");
      records.add(loadSession(address));
    }
    return records;
  }
  @Override public List<Integer> getSubDeviceSessions(String name) {
    tx.checkLive();
    List<Integer> devices = new ArrayList<>();
    for (String id : tx.ids(VeilRecordKind.SESSION)) {
      SignalProtocolAddress address = storedAddress(id);
      if (address.getName().equals(name) && address.getDeviceId() != 1) devices.add(address.getDeviceId());
    }
    return devices;
  }
  private SignalProtocolAddress storedAddress(String id) {
    tx.checkLive();
    int separator = id.lastIndexOf('.');
    if (separator < 0 || separator == id.length() - 1) throw new IllegalStateException("VEIL_ADDRESS_RECOVERY_REQUIRED");
    String name = id.substring(0, separator);
    String suffix = id.substring(separator + 1);
    int device;
    try { device = Integer.parseInt(suffix); }
    catch (NumberFormatException error) { throw new IllegalStateException("VEIL_ADDRESS_RECOVERY_REQUIRED"); }
    if (device < 1 || device > 127 || !Integer.toString(device).equals(suffix)) throw new IllegalStateException("VEIL_ADDRESS_RECOVERY_REQUIRED");
    SignalProtocolAddress address = new SignalProtocolAddress(name, device);
    if (!address.toString().equals(id)) throw new IllegalStateException("VEIL_ADDRESS_RECOVERY_REQUIRED");
    return address;
  }
  @Override public void storeSession(SignalProtocolAddress address, SessionRecord record) { tx.checkLive(); saved(VeilRecordKind.SESSION, address.toString(), record.serialize()); }
  @Override public boolean containsSession(SignalProtocolAddress address) { tx.checkLive(); return present(VeilRecordKind.SESSION, address.toString()); }
  @Override public void deleteSession(SignalProtocolAddress address) { tx.checkLive(); tx.remove(VeilRecordKind.SESSION, address.toString()); }
  @Override public void deleteAllSessions(String name) {
    tx.checkLive();
    List<String> matching = new ArrayList<>();
    for (String id : tx.ids(VeilRecordKind.SESSION)) if (storedAddress(id).getName().equals(name)) matching.add(id);
    // Parse and validate every address before any removal; never partially erase
    // a valid peer when a later stored address needs trusted recovery.
    tx.checkLive();
    for (String id : matching) tx.remove(VeilRecordKind.SESSION, id);
  }
  @Override public PreKeyRecord loadPreKey(int id) throws InvalidKeyIdException {
    tx.checkLive();
    if (!containsPreKey(id)) throw new InvalidKeyIdException("VEIL_PREKEY_MISSING");
    return decoded(VeilRecordKind.PREKEY, keyId(id), PreKeyRecord::new);
  }
  @Override public void storePreKey(int id, PreKeyRecord record) {
    tx.checkLive();
    if (record.getId() != id) throw new IllegalStateException("VEIL_PREKEY_BINDING_REJECTED");
    savedKey(VeilRecordKind.PREKEY, id, record.serialize());
  }
  @Override public boolean containsPreKey(int id) { tx.checkLive(); return present(VeilRecordKind.PREKEY, keyId(id)); }
  @Override public void removePreKey(int id) { tx.checkLive(); retired(VeilRecordKind.PREKEY, id); }
  @Override public SignedPreKeyRecord loadSignedPreKey(int id) throws InvalidKeyIdException {
    tx.checkLive();
    if (!containsSignedPreKey(id)) throw new InvalidKeyIdException("VEIL_SIGNED_PREKEY_MISSING");
    return decoded(VeilRecordKind.SIGNED_PREKEY, keyId(id), SignedPreKeyRecord::new);
  }
  @Override public List<SignedPreKeyRecord> loadSignedPreKeys() {
    tx.checkLive();
    List<SignedPreKeyRecord> records = new ArrayList<>();
    for (String id : tx.ids(VeilRecordKind.SIGNED_PREKEY)) records.add(decoded(VeilRecordKind.SIGNED_PREKEY, id, SignedPreKeyRecord::new));
    return records;
  }
  @Override public void storeSignedPreKey(int id, SignedPreKeyRecord record) {
    tx.checkLive();
    if (record.getId() != id) throw new IllegalStateException("VEIL_SIGNED_PREKEY_BINDING_REJECTED");
    savedKey(VeilRecordKind.SIGNED_PREKEY, id, record.serialize());
  }
  @Override public boolean containsSignedPreKey(int id) { tx.checkLive(); return present(VeilRecordKind.SIGNED_PREKEY, keyId(id)); }
  @Override public void removeSignedPreKey(int id) { tx.checkLive(); retired(VeilRecordKind.SIGNED_PREKEY, id); }
  private int kemMode(int id) {
    int mode = decoded(VeilRecordKind.KEM_PREKEY_MODE, keyId(id), bytes -> {
      if (bytes.length != 1 || (bytes[0] != 0 && bytes[0] != 1)) throw new IllegalStateException("VEIL_KEM_MODE_REQUIRED");
      return (int) bytes[0]; // Protected enrollment: 0=one-time, 1=last-resort.
    });
    String receipt = "kem-mode:" + keyId(id);
    if (present(VeilRecordKind.PREKEY_LIFECYCLE, receipt)) {
      int pinned = decoded(VeilRecordKind.PREKEY_LIFECYCLE, receipt, bytes -> {
        if (bytes.length != 1 || (bytes[0] != 0 && bytes[0] != 1)) throw new IllegalStateException();
        return (int) bytes[0];
      });
      if (pinned != mode) throw new IllegalStateException("VEIL_ENROLLED_KEM_MODE_CHANGED");
    } else if (present(VeilRecordKind.KEM_PREKEY, keyId(id))) {
      throw new IllegalStateException("VEIL_KEM_MODE_RECOVERY_REQUIRED");
    }
    return mode;
  }
  @Override public KyberPreKeyRecord loadKyberPreKey(int id) throws InvalidKeyIdException {
    tx.checkLive();
    kemMode(id);
    if (!containsKyberPreKey(id)) throw new InvalidKeyIdException("VEIL_KEM_PREKEY_MISSING");
    return decoded(VeilRecordKind.KEM_PREKEY, keyId(id), KyberPreKeyRecord::new);
  }
  @Override public List<KyberPreKeyRecord> loadKyberPreKeys() {
    tx.checkLive();
    List<KyberPreKeyRecord> records = new ArrayList<>();
    for (String id : tx.ids(VeilRecordKind.KEM_PREKEY)) { kemMode(Integer.parseInt(id)); records.add(decoded(VeilRecordKind.KEM_PREKEY, id, KyberPreKeyRecord::new)); }
    return records;
  }
  @Override public void storeKyberPreKey(int id, KyberPreKeyRecord record) {
    tx.checkLive();
    int mode = kemMode(id);
    if (record.getId() != id) throw new IllegalStateException("VEIL_KEM_BINDING_REJECTED");
    savedKey(VeilRecordKind.KEM_PREKEY, id, record.serialize());
    if (!present(VeilRecordKind.PREKEY_LIFECYCLE, "kem-mode:" + keyId(id)))
      saved(VeilRecordKind.PREKEY_LIFECYCLE, "kem-mode:" + keyId(id), new byte[] {(byte) mode});
  }
  @Override public boolean containsKyberPreKey(int id) { tx.checkLive(); return present(VeilRecordKind.KEM_PREKEY, keyId(id)); }
  @Override public void markKyberPreKeyUsed(int id, int signedId, ECPublicKey baseKey) throws ReusedBaseKeyException {
    tx.checkLive();
    int mode = kemMode(id);
    keyId(signedId);
    if (!containsKyberPreKey(id)) throw new ReusedBaseKeyException("VEIL_KEM_ALREADY_CONSUMED");
    String marker = keyId(id) + ":" + keyId(signedId) + ":" + publicBaseId(baseKey.serialize());
    if (present(VeilRecordKind.USED_KEM, marker)) throw new ReusedBaseKeyException("VEIL_KEM_BASE_KEY_REUSED");
    saved(VeilRecordKind.USED_KEM, marker, new byte[] {1});
    if (mode == 0) retired(VeilRecordKind.KEM_PREKEY, id);
  }
  @Override public void storeSenderKey(SignalProtocolAddress sender, UUID distribution, SenderKeyRecord record) {
    tx.checkLive(); throw new UnsupportedOperationException("VEIL_PAIRED_GROUP_FANOUT_REQUIRED");
  }
  @Override public SenderKeyRecord loadSenderKey(SignalProtocolAddress sender, UUID distribution) {
    tx.checkLive(); throw new UnsupportedOperationException("VEIL_LEGACY_SENDER_KEY_READ_REQUIRES_LEGACY_READER");
  }
}
