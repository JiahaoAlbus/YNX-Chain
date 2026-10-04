package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.signal.libsignal.protocol.IdentityKeyPair;

/** Real SDK and sodium JNI codec; synthetic authority/password/context only. */
public final class VeilBackupNativeCheck {
  private interface Action { void run(); }
  private static int checks;
  private static void check(String name, Action action) { action.run(); checks++; System.out.println("PASS " + name); }
  private static void reject(Action action, String expected) {
    try { action.run(); } catch (IllegalStateException failure) {
      if (expected == null || expected.equals(failure.getMessage())) return;
      throw new AssertionError("Unexpected typed failure", failure);
    }
    throw new AssertionError("Expected rejection");
  }
  private static final class Port implements VeilRecordTransaction {
    final Map<String,byte[]> rows = new HashMap<>();
    public void checkLive() {}
    public byte[] read(VeilRecordKind kind,String id) { byte[] value=rows.get(kind.name()+"/"+id); return value==null?null:value.clone(); }
    public void write(VeilRecordKind kind,String id,byte[] value) { rows.put(kind.name()+"/"+id,value.clone()); }
    public void remove(VeilRecordKind kind,String id) { rows.remove(kind.name()+"/"+id); }
    public List<String> ids(VeilRecordKind kind) { String prefix=kind.name()+"/"; return rows.keySet().stream().filter(k->k.startsWith(prefix)).map(k->k.substring(prefix.length())).sorted().toList(); }
  }
  public static void main(String[] args) {
    if(args.length!=1) throw new IllegalArgumentException("Expected explicitly built QA library path");
    IdentityKeyPair identity=IdentityKeyPair.generate();
    Port port=new Port();
    port.write(VeilRecordKind.SOCIAL_IDENTITY,"public",identity.getPublicKey().serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY,"identity",identity.serialize());
    port.write(VeilRecordKind.SOCIAL_IDENTITY,"registration",ByteBuffer.allocate(4).putInt(1001).array());
    port.write(VeilRecordKind.SOCIAL_IDENTITY,"signal-address","qa-codec.1".getBytes(StandardCharsets.US_ASCII));
    byte[] password="synthetic QA password only".getBytes(StandardCharsets.UTF_8), context=new byte[32];
    Arrays.fill(context,(byte)7);
    byte[] passwordBefore=password.clone(), contextBefore=context.clone();
    check("missing native library fails closed without alternative cipher",()->reject(()->VeilBackupNative.seal(port,identity.getPublicKey(),password,context,()->{}),"VEIL_BACKUP_NATIVE_UNAVAILABLE"));
    System.load(args[0]);
    byte[] backup=VeilBackupNative.seal(port,identity.getPublicKey(),password,context,()->{});
    try {
      check("actual SDK image sodium JNI seal/open staging round trip",()->{
        try(var original=VeilSignalRecordSnapshot.capture(port,identity.getPublicKey());var opened=VeilBackupNative.openForStaging(backup,identity.getPublicKey(),password,context,()->{})) {
          byte[] a=original.bytesForNativeSealer(),b=opened.bytesForNativeSealer();
          try { if(!Arrays.equals(a,b))throw new AssertionError("Image changed"); } finally { Arrays.fill(a,(byte)0);Arrays.fill(b,(byte)0); }
        }
      });
      check("caller password and external context are not modified",()->{if(!Arrays.equals(passwordBefore,password)||!Arrays.equals(contextBefore,context))throw new AssertionError("Caller input changed");});
      check("incorrect password rejects authenticated native open",()->reject(()->VeilBackupNative.openForStaging(backup,identity.getPublicKey(),new byte[]{1},context,()->{}),"VEIL_BACKUP_AUTH_FAILED"));
      check("foreign external context rejects native open",()->{
        byte[] foreign=context.clone();foreign[0]^=1;
        try {reject(()->VeilBackupNative.openForStaging(backup,identity.getPublicKey(),password,foreign,()->{}),"VEIL_BACKUP_CONTEXT_MISMATCH");}finally{Arrays.fill(foreign,(byte)0);}
      });
      check("ciphertext tamper rejects without installing records",()->{
        byte[] damaged=backup.clone();damaged[damaged.length-1]^=1;
        try {reject(()->VeilBackupNative.openForStaging(damaged,identity.getPublicKey(),password,context,()->{}),"VEIL_BACKUP_AUTH_FAILED");}finally{Arrays.fill(damaged,(byte)0);}
      });
      check("invalid native inputs reject before KDF",()->{
        reject(()->VeilBackupNative.seal(port,identity.getPublicKey(),new byte[0],context,()->{}),"VEIL_BACKUP_INPUT_REJECTED");
        reject(()->VeilBackupNative.seal(port,identity.getPublicKey(),new byte[1025],context,()->{}),"VEIL_BACKUP_INPUT_REJECTED");
        reject(()->VeilBackupNative.seal(port,identity.getPublicKey(),password,new byte[31],()->{}),"VEIL_BACKUP_INPUT_REJECTED");
        reject(()->VeilBackupNative.openForStaging(new byte[1],identity.getPublicKey(),password,context,()->{}),"VEIL_BACKUP_IMAGE_SIZE_REJECTED");
      });
      check("late native observer discards seal result",()->{
        int[] calls={0};reject(()->VeilBackupNative.seal(port,identity.getPublicKey(),password,context,()->{if(++calls[0]==3)throw new IllegalStateException("QA_LATE");}),"QA_LATE");
      });
      check("late native observer discards decrypted staging",()->{
        int[] calls={0};reject(()->VeilBackupNative.openForStaging(backup,identity.getPublicKey(),password,context,()->{if(++calls[0]==2)throw new IllegalStateException("QA_LATE");}),"QA_LATE");
      });
      check("original backup remains usable after rejected attempts",()->{try(var opened=VeilBackupNative.openForStaging(backup,identity.getPublicKey(),password,context,()->{})){if(port.rows.size()!=4)throw new AssertionError("Record set changed");}});
      System.out.println("PASS native backup codec checks="+checks+"; real SDK/libsodium/JNI; synthetic context/trust; no atomic restore, enrollment, OS or activation proof");
    } finally {Arrays.fill(backup,(byte)0);Arrays.fill(password,(byte)0);Arrays.fill(context,(byte)0);Arrays.fill(passwordBefore,(byte)0);Arrays.fill(contextBefore,(byte)0);}
  }
}
