package com.ynx.social.matrix;

import java.util.*;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.ecc.ECPublicKey;
import org.signal.libsignal.protocol.state.SessionRecord;

/** Actual vendor addresses and empty record holder; no private keys generated. */
public final class VeilKeylessAdapterCheck {
  private interface Action { void run(); }
  private static int checks;
  private static void test(String name, Action action) { action.run(); checks++; System.out.println("PASS " + name); }
  private static void refused(Action action) {
    try { action.run(); } catch (IllegalStateException error) { return; }
    throw new AssertionError("ExpectedRefusal");
  }
  private static final class CountingRecord extends SessionRecord {
    int calls;
    CountingRecord() { super(); } // Empty native session, not an identity/prekey.
    @Override public byte[] serialize() { calls++; return new byte[]{1}; }
  }
  private static final class Port implements VeilRecordTransaction {
    boolean live = true;
    int reads, writes, removals, lists;
    final Map<String,byte[]> sessions = new LinkedHashMap<>();
    public void checkLive() { if (!live) throw new IllegalStateException("ControlledScopeExpired"); }
    public byte[] read(VeilRecordKind kind,String id) { checkLive(); reads++; byte[] value=sessions.get(id); return value==null?null:value.clone(); }
    public void write(VeilRecordKind kind,String id,byte[] value) { checkLive(); writes++; sessions.put(id,value.clone()); }
    public void remove(VeilRecordKind kind,String id) { checkLive(); removals++; sessions.remove(id); }
    public List<String> ids(VeilRecordKind kind) { checkLive(); lists++; return new ArrayList<>(sessions.keySet()); }
  }
  public static void main(String[] args) {
    try {
      byte[] publicOnly = new byte[33]; publicOnly[0]=5; publicOnly[1]=9;
      IdentityKey identity = new IdentityKey(new ECPublicKey(publicOnly));
      Port port = new Port(); VeilSignalProtocolStore store = new VeilSignalProtocolStore(port,identity);
      var peer1 = new SignalProtocolAddress("peer",1);
      var peer2 = new SignalProtocolAddress("peer",2);
      var branch3 = new SignalProtocolAddress("peer.branch",3);
      var dotted4 = new SignalProtocolAddress("peer.",4);
      port.sessions.put(peer1.toString(),new byte[]{1});
      port.sessions.put(peer2.toString(),new byte[]{1});
      port.sessions.put(branch3.toString(),new byte[]{1});
      port.sessions.put(dotted4.toString(),new byte[]{1});
      test("actual SDK complete peer name isolates peer.2 from peer.branch.3", () -> {
        if (!store.getSubDeviceSessions("peer").equals(List.of(2))) throw new AssertionError();
        if (!store.getSubDeviceSessions("peer.branch").equals(List.of(3))) throw new AssertionError();
        if (!store.getSubDeviceSessions("peer.").equals(List.of(4))) throw new AssertionError();
      });
      test("deleteAll removes only exact peer fields and preserves other dotted peers", () -> {
        store.deleteAllSessions("peer");
        if (port.sessions.containsKey(peer1.toString()) || port.sessions.containsKey(peer2.toString()) ||
            !port.sessions.containsKey(branch3.toString()) || !port.sessions.containsKey(dotted4.toString())) throw new AssertionError();
      });
      test("noncanonical stored address holds before any partial deletion", () -> {
        port.sessions.put(peer2.toString(),new byte[]{1}); port.sessions.put("peer.02",new byte[]{1});
        int before=port.removals; refused(() -> store.deleteAllSessions("peer"));
        if (!port.sessions.containsKey(peer2.toString()) || port.removals!=before) throw new AssertionError();
        port.sessions.remove("peer.02");
      });
      CountingRecord record = new CountingRecord();
      port.live=false;
      test("expired retained session callback rejects before any serialize or I/O", () -> {
        int writes=port.writes; refused(() -> store.storeSession(peer2,record));
        if (record.calls!=0 || port.writes!=writes) throw new AssertionError();
      });
      test("expired key callbacks reject before touching even null native records", () -> {
        refused(() -> store.storePreKey(11,null));
        refused(() -> store.storeSignedPreKey(12,null));
        refused(() -> store.storeKyberPreKey(13,null));
      });
      test("expired query and deletion callbacks reject before address work and I/O", () -> {
        int reads=port.reads, lists=port.lists, removes=port.removals;
        refused(() -> store.containsSession(null)); refused(() -> store.getIdentity(null));
        refused(() -> store.deleteSession(null)); refused(() -> store.getSubDeviceSessions("peer"));
        refused(() -> store.deleteAllSessions("peer"));
        if (reads!=port.reads || lists!=port.lists || removes!=port.removals) throw new AssertionError();
      });
      port.live=true;
      test("live opposite boundary serializes exactly once and stores the expected peer", () -> {
        store.storeSession(peer2,record);
        if (record.calls!=1 || !port.sessions.containsKey(peer2.toString())) throw new AssertionError();
      });
      System.out.println("PASS "+checks+" keyless callback/address checks; controlled transaction only");
    } catch (Throwable error) {
      System.err.println("FAIL "+error.getClass().getSimpleName()); System.exit(1);
    }
  }
}
