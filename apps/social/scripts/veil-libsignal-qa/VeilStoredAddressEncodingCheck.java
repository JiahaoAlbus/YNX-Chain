package com.ynx.social.matrix;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.signal.libsignal.protocol.IdentityKeyPair;

/** Actual official JNI addresses; synthetic record port, not durable storage evidence. */
public final class VeilStoredAddressEncodingCheck {
  private static int checks;
  private static final class Port implements VeilRecordTransaction {
    final Map<String, byte[]> sessions = new LinkedHashMap<>();
    int enumerations, removals;
    public void checkLive() {}
    public byte[] read(VeilRecordKind kind, String id) {
      byte[] value = sessions.get(id); return value == null ? null : value.clone();
    }
    public void write(VeilRecordKind kind, String id, byte[] bytes) { sessions.put(id, bytes.clone()); }
    public void remove(VeilRecordKind kind, String id) { removals++; sessions.remove(id); }
    public List<String> ids(VeilRecordKind kind) { enumerations++; return new ArrayList<>(sessions.keySet()); }
  }
  private static void check(boolean value) {
    if (!value) throw new AssertionError("stored address encoding invariant"); checks++;
  }
  private static void rejected(Runnable action) {
    boolean rejected = false;
    try { action.run(); }
    catch (IllegalArgumentException | IllegalStateException expected) { rejected = true; }
    check(rejected);
  }
  public static void main(String[] args) {
    Port port = new Port();
    var store = new VeilSignalProtocolStore(port, IdentityKeyPair.generate().getPublicKey());
    for (String invalid : new String[] {"\uD800", "\uDC00", "qa\uD800tail"}) {
      int before = port.enumerations;
      rejected(() -> store.getSubDeviceSessions(invalid));
      rejected(() -> store.deleteAllSessions(invalid));
      check(port.enumerations == before && port.removals == 0);
    }
    String peer = "qa\u7528\u6237\uD83D\uDE80";
    port.sessions.put(peer + ".1", new byte[] {1});
    port.sessions.put(peer + ".2", new byte[] {2});
    port.sessions.put(peer + ".127", new byte[] {3});
    port.sessions.put("qa-other.3", new byte[] {4});
    check(store.getSubDeviceSessions(peer).equals(List.of(2, 127)));
    for (String invalid : new String[] {"qa\uD800.2", "qa\uDC00.2", ".2", "qa-other.02", "qa-other.128"}) {
      port.sessions.put(invalid, new byte[] {5});
      List<String> before = new ArrayList<>(port.sessions.keySet());
      rejected(() -> store.getSubDeviceSessions(peer));
      rejected(() -> store.deleteAllSessions(peer));
      check(port.removals == 0 && before.equals(new ArrayList<>(port.sessions.keySet())));
      port.sessions.remove(invalid);
    }
    store.deleteAllSessions(peer);
    check(port.removals == 3 && port.sessions.keySet().equals(java.util.Set.of("qa-other.3")));
    check(store.getSubDeviceSessions(peer).isEmpty());
    System.out.println("PASS stored-address encoding checks=" + checks + "; actual JNI address construction; synthetic records; no durable storage, enrollment or activation proof");
  }
}
