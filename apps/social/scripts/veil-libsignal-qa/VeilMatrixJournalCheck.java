package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.util.*;

/** Atomic-memory transport checks with synthetic opaque cipher; no SDK/OS proof. */
public final class VeilMatrixJournalCheck {
  static int assertions;
  static void check(boolean value) { if (!value) throw new AssertionError("journal assertion"); assertions++; }
  static void fails(String code, Runnable action) {
    try { action.run(); } catch (IllegalStateException expected) { check(expected.getMessage().equals(code)); return; }
    throw new AssertionError("expected " + code);
  }
  static final class Port implements VeilRecordTransaction, VeilContextAuthority.CommitGuardPort {
    Map<String, byte[]> rows = new HashMap<>();
    List<Runnable> guards = new ArrayList<>();
    boolean live; int reads;
    public void checkLive() { if (!live) throw new IllegalStateException("VEIL_TRANSACTION_INACTIVE"); }
    public byte[] read(VeilRecordKind kind, String key) { checkLive(); reads++; byte[] value = rows.get(kind+":"+key); return value == null ? null : value.clone(); }
    public void write(VeilRecordKind kind, String key, byte[] value) { checkLive(); rows.put(kind+":"+key, value.clone()); }
    public void remove(VeilRecordKind kind, String key) { checkLive(); rows.remove(kind+":"+key); }
    public List<String> ids(VeilRecordKind kind) { checkLive(); return List.of(); }
    public void guardCommit(Runnable check) { checkLive(); guards.add(check); }
    void run(Runnable block) {
      Map<String, byte[]> before = new HashMap<>(); rows.forEach((key, value) -> before.put(key, value.clone()));
      guards.clear(); live = true;
      try { block.run(); live = false; guards.forEach(Runnable::run); }
      catch (RuntimeException failure) { rows = before; throw failure; }
      finally { live = false; guards.clear(); }
    }
  }
  public static void main(String[] args) {
    UUID operation = UUID.fromString("11111111-1111-4111-8111-111111111111");
    UUID sender = UUID.fromString("22222222-2222-4222-8222-222222222222");
    byte[] cipher = new byte[128]; Arrays.fill(cipher, (byte) 7);
    ByteBuffer record = ByteBuffer.allocate(92 + cipher.length);
    record.putInt(0x564f4232).putLong(sender.getMostSignificantBits()).putLong(sender.getLeastSignificantBits());
    record.position(84); record.putInt(3).putInt(cipher.length).put(cipher);
    Port port = new Port(); port.rows.put("OUTBOX:signal:" + operation, record.array());
    boolean[] current = { true };
    VeilMatrixJournal.Scope scope = new VeilMatrixJournal.Scope("https://hs.example.org", "@alice:example.org", "@bob:example.org", "!room:example.org",
        () -> { if (!current[0]) throw new IllegalStateException("VEIL_APPLICATION_CONTEXT_UNAVAILABLE"); });
    VeilSignalOutbox.PendingCiphertext pending = new VeilSignalOutbox.PendingCiphertext(3, sender, cipher);
    port.run(() -> {
      VeilMatrixJournal.Entry entry = VeilMatrixJournal.prepareInTransaction(port, scope, operation, pending);
      check(entry.operation.equals(operation) && entry.senderMessage.equals(sender));
      check(entry.phase == VeilMatrixJournal.Phase.PREPARED && entry.matrixTransaction == null);
    });
    port.run(() -> VeilMatrixJournal.uploadedInTransaction(port, scope, operation, "mxc://hs.example.org/cipher"));
    port.run(() -> {
      VeilMatrixJournal.Entry entry = VeilMatrixJournal.beginSendInTransaction(port, scope, operation, null);
      check(entry.phase == VeilMatrixJournal.Phase.UNKNOWN && entry.matrixTransaction == null);
    });
    port.run(() -> {
      check(VeilMatrixJournal.prepareInTransaction(port, scope, operation, pending).phase == VeilMatrixJournal.Phase.UNKNOWN);
      fails("VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED", () -> VeilMatrixJournal.beginSendInTransaction(port, scope, operation, null));
      fails("VEIL_AUTHENTICATED_MESSAGE_REUSE", () -> VeilMatrixJournal.uploadedInTransaction(port, scope, operation, "mxc://hs.example.org/different"));
    });
    port.run(() -> {
      VeilMatrixJournal.Entry entry = VeilMatrixJournal.readInTransaction(port, scope, operation);
      fails("VEIL_AUTHENTICATED_MESSAGE_REUSE", () -> VeilMatrixJournal.observeInTransaction(port, scope, operation,
          "$event", "observed-sdk-txn", operation, entry.mediaUrl, entry.cipherSha256()));
      VeilMatrixJournal.Entry observed = VeilMatrixJournal.observeInTransaction(port, scope, operation,
          "$event", "observed-sdk-txn", sender, entry.mediaUrl, entry.cipherSha256());
      check(observed.phase == VeilMatrixJournal.Phase.OBSERVED && observed.matrixTransaction.equals("observed-sdk-txn"));
      check(VeilMatrixJournal.readInTransaction(port, scope, operation).event.equals("$event"));
      byte[] exported = VeilMatrixJournal.originalCipherInTransaction(port, scope, operation);
      check(Arrays.equals(exported, cipher)); exported[0] ^= 1;
      check(Arrays.equals(VeilMatrixJournal.originalCipherInTransaction(port, scope, operation), cipher));
      fails("VEIL_AUTHENTICATED_MESSAGE_REUSE", () -> VeilMatrixJournal.observeInTransaction(port, scope, operation,
          "$different", "observed-sdk-txn", sender, entry.mediaUrl, entry.cipherSha256()));
    });
    current[0] = false; int reads = port.reads;
    fails("VEIL_APPLICATION_CONTEXT_UNAVAILABLE", () -> port.run(() -> VeilMatrixJournal.readInTransaction(port, scope, operation)));
    check(port.reads == reads); current[0] = true;
    Map<String, byte[]> before = new HashMap<>(port.rows);
    fails("VEIL_APPLICATION_CONTEXT_UNAVAILABLE", () -> port.run(() -> {
      VeilMatrixJournal.readInTransaction(port, scope, operation); current[0] = false;
    }));
    check(port.rows.keySet().equals(before.keySet())); current[0] = true;
    VeilMatrixJournal.Scope wrong = new VeilMatrixJournal.Scope(scope.homeserver, scope.self, scope.peer, "!elsewhere:example.org", () -> {});
    fails("VEIL_AUTHENTICATED_MESSAGE_REUSE", () -> port.run(() -> VeilMatrixJournal.readInTransaction(port, wrong, operation)));
    byte[] fingerprint = new byte[32]; Arrays.fill(fingerprint, (byte) 3);
    UUID fresh = UUID.fromString("33333333-3333-4333-8333-333333333333");
    port.run(() -> VeilMatrixContextBinding.require(port, fresh, fingerprint, true));
    port.run(() -> VeilMatrixContextBinding.require(port, fresh, fingerprint, false));
    byte[] changed = fingerprint.clone(); changed[0] ^= 1;
    fails("VEIL_AUTHENTICATED_CONTEXT_MISMATCH", () -> port.run(() -> VeilMatrixContextBinding.require(port, fresh, changed, false)));
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixContextBinding.require(port, operation, fingerprint, true)));
    UUID missing = UUID.fromString("44444444-4444-4444-8444-444444444444");
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixContextBinding.require(port, missing, fingerprint, false)));
    String journal = "OUTBOX:matrix-v2:" + operation;
    byte[] saved = port.rows.get(journal).clone(); port.rows.put(journal, Arrays.copyOf(saved, saved.length - 1));
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixJournal.readInTransaction(port, scope, operation)));
    port.rows.put(journal, saved);
    port.rows.remove("OUTBOX:signal:" + operation);
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixJournal.readInTransaction(port, scope, operation)));
    System.out.println("PASS native protected-journal model assertions=" + assertions + "; synthetic cipher/memory only; no SDK send, OS, or trust admission proof");
  }
}
