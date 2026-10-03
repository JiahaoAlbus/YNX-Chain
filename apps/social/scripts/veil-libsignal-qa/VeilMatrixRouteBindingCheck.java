package com.ynx.social.matrix;

import java.util.Arrays;
import java.util.UUID;

/** Generation/routing persistence negatives; synthetic trust+atomic memory. */
public final class VeilMatrixRouteBindingCheck {
  static int assertions;
  static void check(boolean value) { if (!value) throw new AssertionError("route binding"); assertions++; }
  static void fails(String code, Runnable action) {
    try { action.run(); } catch (IllegalStateException expected) { check(code.equals(expected.getMessage())); return; }
    throw new AssertionError("expected " + code);
  }
  static VeilMatrixJournal.Scope scope(String hs, String self, String peer, String room) {
    return new VeilMatrixJournal.Scope(hs, self, peer, room, () -> {});
  }
  public static void main(String[] args) {
    VeilMatrixJournalCheck.Port port = new VeilMatrixJournalCheck.Port();
    UUID operation = UUID.fromString("55555555-5555-4555-8555-555555555555");
    byte[] context = new byte[32]; Arrays.fill(context, (byte) 7);
    VeilMatrixJournal.Scope original = scope("https://hs.example.org", "@alice:example.org", "@bob:example.org", "!room:example.org");
    port.run(() -> {
      VeilMatrixContextBinding.require(port, operation, context, 1, original, true);
      port.write(VeilRecordKind.OUTBOX, "signal:" + operation, new byte[] {1});
      port.write(VeilRecordKind.OUTBOX, "matrix-v2:" + operation, new byte[] {2});
    });
    String key = "OUTBOX:matrix-v2-context:" + operation;
    byte[] saved = port.rows.get(key).clone(); check(saved.length == 76);
    // Cold reopen with a fresh reviewed object but SAME durable generation.
    VeilMatrixJournal.Scope reopened = scope(original.homeserver, original.self, original.peer, original.room);
    port.run(() -> VeilMatrixContextBinding.require(port, operation, context, 1, reopened, false));
    check(Arrays.equals(saved, port.rows.get(key)));
    int[] uploadOrSend = {0};
    fails("VEIL_AUTHENTICATED_CONTEXT_MISMATCH", () -> port.run(() -> {
      VeilMatrixContextBinding.require(port, operation, context, 2, reopened, false);
      uploadOrSend[0]++;
    }));
    check(uploadOrSend[0] == 0 && Arrays.equals(saved, port.rows.get(key)));
    for (VeilMatrixJournal.Scope changed : new VeilMatrixJournal.Scope[] {
      scope("https://elsewhere.example.org", original.self, original.peer, original.room),
      scope(original.homeserver, "@other:example.org", original.peer, original.room),
      scope(original.homeserver, original.self, "@other:example.org", original.room),
      scope(original.homeserver, original.self, original.peer, "!other:example.org")
    }) fails("VEIL_AUTHENTICATED_CONTEXT_MISMATCH", () -> port.run(() -> VeilMatrixContextBinding.require(port, operation, context, 1, changed, false)));
    port.rows.put(key, context.clone());
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixContextBinding.require(port, operation, context, 1, original, false)));
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixContextBinding.require(port, operation, context, 2, original, true)));
    check(Arrays.equals(context, port.rows.get(key))); // No legacy rewrite/adoption.
    port.rows.remove(key);
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixContextBinding.require(port, operation, context, 1, original, true)));
    check(!port.rows.containsKey(key));
    port.rows.remove("OUTBOX:matrix-v2:" + operation);
    fails("VEIL_NATIVE_RECOVERY_REQUIRED", () -> port.run(() -> VeilMatrixContextBinding.require(port, operation, context, 1, original, true)));
    check(!port.rows.containsKey(key)); // Old cipher alone cannot seed a new binding.
    int reads = port.reads;
    fails("VEIL_APPLICATION_CONTEXT_UNAVAILABLE", () -> port.run(() -> VeilMatrixContextBinding.require(port, operation, context, 0, original, false)));
    check(port.reads == reads);
    UUID unsigned = UUID.fromString("66666666-6666-4666-8666-666666666666");
    port.run(() -> {
      VeilMatrixContextBinding.require(port, unsigned, context, -1L, original, true);
      port.write(VeilRecordKind.OUTBOX, "signal:" + unsigned, new byte[] {1});
      port.write(VeilRecordKind.OUTBOX, "matrix-v2:" + unsigned, new byte[] {2});
    });
    port.run(() -> VeilMatrixContextBinding.require(port, unsigned, context, -1L, reopened, false));
    fails("VEIL_AUTHENTICATED_CONTEXT_MISMATCH", () -> port.run(() -> VeilMatrixContextBinding.require(port, unsigned, context, Long.MIN_VALUE, reopened, false)));
    System.out.println("PASS durable generation/route binding assertions=" + assertions + "; synthetic authority+memory only, no real issuer/routes/OS proof");
  }
}
