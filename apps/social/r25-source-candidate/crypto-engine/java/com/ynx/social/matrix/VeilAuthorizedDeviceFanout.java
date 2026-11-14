package com.ynx.social.matrix;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import kotlin.Unit;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.SignalProtocolAddress;

/** Dormant native composition. No JS admission, sender key, transport or activation. */
final class VeilAuthorizedDeviceFanout {
  static final int MAX_RECIPIENTS = 32, MAX_QUEUED = 8, MAX_MANIFESTS = 64;
  static final int MAX_BATCH_BYTES = 4 * 1024 * 1024, MAX_OUTBOX_BYTES = 32 * 1024 * 1024;
  private static final int MAGIC = 0x56464231, HEADER = 92;
  private static final String PREFIX = "fanout-v1:";

  interface Directory {
    // Independently authorize the COMPLETE current remote-device set, including
    // the sender's other admitted devices, membership epoch, send permission,
    // revocation freshness and provenance. No metadata-derived production grant.
    // Resolve only independently verified native state: no suspend/network work
    // inside this transaction. The producer must order its live guard against
    // the actual protected commit; a freshness bit supplied by JS is not a guard.
    Snapshot verify(VeilRecordTransaction tx, String opaqueConversationHandle);
  }
  interface DeliveryVerifier {
    // Independently match every device's exact original batch to trusted native
    // transport readback. Partial/partitioned results MUST remain UNKNOWN.
    // Native verified readback must be ready before entering the transaction;
    // this verifier and its final recheck cannot initiate network delivery.
    Observation verify(VeilRecordTransaction tx, UUID operation, byte[] originalManifestDigest);
  }
  enum State { PREPARED, IN_FLIGHT, UNKNOWN, CONFIRMED }
  enum Outcome { UNKNOWN, DEFINITELY_NOT_SENT, ALL_CONFIRMED }
  static final class Observation {
    final Outcome outcome; final Runnable recheck;
    Observation(Outcome outcome, Runnable recheck) { this.outcome=Objects.requireNonNull(outcome);this.recheck=Objects.requireNonNull(recheck); }
  }
  static final class Recipient {
    final VeilApplicationContext.Device device; final String contextHandle;
    Recipient(VeilApplicationContext.Device device, String contextHandle) {
      this.device=Objects.requireNonNull(device).copy();this.contextHandle=contextHandle;
      VeilAuthenticatedEnvelope.validateDevice(this.device);VeilAuthenticatedEnvelope.text(contextHandle,4096);
    }
  }
  static final class Snapshot {
    final String route; final long epoch, revision;
    final VeilApplicationContext.Device local;
    final List<Recipient> recipients; final Runnable recheck;
    Snapshot(String route,long epoch,long revision,VeilApplicationContext.Device local,List<Recipient> recipients,Runnable recheck) {
      VeilAuthenticatedEnvelope.text(route,512);
      if(epoch==0||revision==0||recipients==null||recipients.isEmpty()||recipients.size()>MAX_RECIPIENTS)throw fail("VEIL_FANOUT_RECIPIENT_SET_INVALID");
      this.route=route;this.epoch=epoch;this.revision=revision;this.local=Objects.requireNonNull(local).copy();
      VeilAuthenticatedEnvelope.validateDevice(this.local);this.recheck=Objects.requireNonNull(recheck);
      List<Recipient> copy=new ArrayList<>();Set<String> seen=new HashSet<>();
      for(Recipient recipient:recipients){Recipient value=new Recipient(recipient.device,recipient.contextHandle);
        SignalProtocolAddress address=address(value.device);
        if(address.equals(address(this.local))||!seen.add(address.toString()))throw fail("VEIL_FANOUT_RECIPIENT_SET_INVALID");copy.add(value);}
      copy.sort(Comparator.comparing((Recipient r)->r.device.name).thenComparingInt(r->r.device.device));this.recipients=List.copyOf(copy);
    }
  }
  static final class Packet implements AutoCloseable {
    final UUID deviceOperation, senderMessageId; final int type;
    private byte[] wire, sourceDigest;
    Packet(UUID operation,UUID message,int type,byte[] wire,byte[] sourceDigest) {
      VeilAuthenticatedEnvelope.validateId(operation);VeilAuthenticatedEnvelope.validateId(message);VeilSignalOutbox.requireType(type);
      if(wire==null||wire.length<1||wire.length>VeilAuthenticatedEnvelope.MAX_CIPHER||sourceDigest.length!=32)throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");
      deviceOperation=operation;senderMessageId=message;this.type=type;this.wire=wire.clone();this.sourceDigest=sourceDigest.clone();
    }
    byte[] serialize(){if(wire==null)throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");return wire.clone();}
    public void close(){wipe(wire);wipe(sourceDigest);wire=null;sourceDigest=null;}
  }
  static final class Batch implements AutoCloseable {
    final UUID operation; final State state;
    final List<Recipient> recipients; final List<Packet> packets;
    Batch(UUID operation,State state,List<Recipient> recipients,List<Packet> packets) {
      this.operation=operation;this.state=state;this.recipients=List.copyOf(recipients);this.packets=List.copyOf(packets);
    }
    public void close(){for(Packet packet:packets)packet.close();}
  }
  private static final class Manifest implements AutoCloseable {
    final UUID operation; State state; final byte[] snapshot, request; final List<Packet> packets;
    Manifest(UUID operation,State state,byte[] snapshot,byte[] request,List<Packet> packets){this.operation=operation;this.state=state;this.snapshot=snapshot.clone();this.request=request.clone();this.packets=packets;}
    public void close(){wipe(snapshot);wipe(request);for(Packet packet:packets)packet.close();}
  }
  private record Authorized(Snapshot snapshot,byte[] digest) {}
  private final VeilNativeStore store; private final IdentityKey identity;
  private final SignalProtocolAddress local; private final Directory directory;
  private final VeilContextAuthority contexts; private final DeliveryVerifier delivery;
  VeilAuthorizedDeviceFanout(VeilNativeStore store,IdentityKey identity,VeilSignalAddress local) {
    this(store,identity,local,null,VeilContextAuthority.unavailable(),null);
  }
  VeilAuthorizedDeviceFanout(VeilNativeStore store,IdentityKey identity,VeilSignalAddress local,
      Directory directory,VeilContextAuthority contexts,DeliveryVerifier delivery) {
    this.store=Objects.requireNonNull(store);this.identity=Objects.requireNonNull(identity);this.local=Objects.requireNonNull(local).sdk();
    this.directory=directory;this.contexts=Objects.requireNonNull(contexts);this.delivery=delivery;
  }
  private interface Work<T> { T run(VeilRecordTransaction tx) throws Exception; }
  private <T> T atomic(Work<T> action) {
    Object[] candidate=new Object[1];
    try {T result=store.transaction(tx->{try{T value=action.run(tx);candidate[0]=value;return value;}catch(RuntimeException error){throw error;}catch(Exception error){throw new IllegalStateException("VEIL_FANOUT_TRANSACTION_ABORTED",error);}});candidate[0]=null;return result;}
    finally{if(candidate[0] instanceof Batch batch)batch.close();}
  }
  Batch prepare(UUID operation,String handle,byte[] content) {
    VeilAuthenticatedEnvelope.validateContent(content);byte[] copy=content.clone();
    try{return atomic(tx->prepareInTransaction(tx,directory,contexts,identity,local,operation,handle,copy));}finally{wipe(copy);}
  }
  Batch exactRetry(UUID operation,String handle){return atomic(tx->retryInTransaction(tx,directory,contexts,identity,local,operation,handle));}
  Batch beginDelivery(UUID operation,String handle){return atomic(tx->beginDeliveryInTransaction(tx,directory,contexts,identity,local,operation,handle));}
  State reconcile(UUID operation,String handle){return atomic(tx->reconcileInTransaction(tx,directory,contexts,delivery,identity,local,operation,handle));}

  private static IllegalStateException fail(String code){return VeilAuthenticatedEnvelope.fail(code);}
  private static void wipe(byte[] bytes){if(bytes!=null)Arrays.fill(bytes,(byte)0);}
  private static SignalProtocolAddress address(VeilApplicationContext.Device device){return VeilSignalAddress.of(device.name,device.device).sdk();}
  private static void guard(VeilRecordTransaction tx,Runnable check) {
    if(tx instanceof VeilNativeTransaction nativeTx)nativeTx.guardCommit(()->{check.run();return Unit.INSTANCE;});
    else if(tx instanceof VeilContextAuthority.CommitGuardPort port)port.guardCommit(check);
    else throw fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    check.run();tx.checkLive();
  }
  private static Authorized authorize(VeilRecordTransaction tx,Directory directory,VeilContextAuthority contexts,
      IdentityKey own,SignalProtocolAddress local,String handle) throws Exception {
    tx.checkLive();VeilAuthenticatedEnvelope.text(handle,4096);
    if(directory==null)throw fail("VEIL_FANOUT_DIRECTORY_UNAVAILABLE");
    Snapshot supplied=directory.verify(tx,handle);if(supplied==null)throw fail("VEIL_FANOUT_DIRECTORY_UNAVAILABLE");
    Snapshot snapshot=new Snapshot(supplied.route,supplied.epoch,supplied.revision,supplied.local,supplied.recipients,supplied.recheck);
    if(!address(snapshot.local).equals(local)||!Arrays.equals(snapshot.local.identity(),own.serialize()))throw fail("VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
    guard(tx,snapshot.recheck);
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    try(DataOutputStream frame=new DataOutputStream(bytes)) {
      frame.writeUTF("YNX/SOCIAL/NATIVE-FANOUT-SNAPSHOT/V1");frame.writeLong(snapshot.revision);frame.writeInt(snapshot.recipients.size());
      // Resolve EVERY independent context before any SessionCipher or outbox write.
      for(Recipient recipient:snapshot.recipients){
        VeilContextAuthority.Grant grant=contexts.resolve(tx,recipient.contextHandle,own,local,address(recipient.device));
        VeilApplicationContext context=grant.context;
        if(!context.route.equals(snapshot.route)||context.epoch!=snapshot.epoch||!context.local.same(snapshot.local)||!context.peer.same(recipient.device))throw fail("VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
        byte[] field=VeilAuthenticatedEnvelope.contextBytes(context,true);try{frame.writeInt(field.length);frame.write(field);}finally{wipe(field);}
      }
    }
    snapshot.recheck.run();tx.checkLive();byte[] fields=bytes.toByteArray();
    try{return new Authorized(snapshot,VeilAuthenticatedEnvelope.digest(fields));}finally{wipe(fields);}
  }
  private static String key(UUID operation){VeilAuthenticatedEnvelope.validateId(operation);return PREFIX+operation;}
  private static byte[] record(VeilRecordTransaction tx,UUID operation){return tx.read(VeilRecordKind.OUTBOX,key(operation));}
  private static void checkCurrent(Manifest manifest,Authorized authorized,UUID operation) {
    if(!manifest.operation.equals(operation)||!Arrays.equals(manifest.snapshot,authorized.digest))throw fail("VEIL_FANOUT_SNAPSHOT_CHANGED");
    if(manifest.state!=State.CONFIRMED&&manifest.packets.size()!=authorized.snapshot.recipients.size())throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");
  }
  private static void retainedSources(VeilRecordTransaction tx,Manifest manifest) {
    for(Packet packet:manifest.packets){byte[] source=tx.read(VeilRecordKind.OUTBOX,"signal:"+packet.deviceOperation);
      try{if(source==null||!Arrays.equals(VeilAuthenticatedEnvelope.digest(source),packet.sourceDigest))throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");}finally{wipe(source);}}
  }
  private static Batch batch(Manifest manifest,Snapshot snapshot) {
    List<Packet> copy=new ArrayList<>();
    try{for(Packet packet:manifest.packets)copy.add(new Packet(packet.deviceOperation,packet.senderMessageId,packet.type,packet.wire,packet.sourceDigest));return new Batch(manifest.operation,manifest.state,snapshot.recipients,copy);}
    catch(Throwable failure){for(Packet packet:copy)packet.close();throw failure;}
  }
  private static void eligible(Manifest manifest){if(manifest.state==State.CONFIRMED)throw fail("VEIL_FANOUT_ALREADY_CONFIRMED");if(manifest.state!=State.PREPARED)throw fail("VEIL_FANOUT_DELIVERY_UNKNOWN");}
  private static void budget(VeilRecordTransaction tx,boolean newManifest) {
    List<String> ids=tx.ids(VeilRecordKind.OUTBOX);if(ids.size()>4096)throw fail("VEIL_FANOUT_QUEUE_FULL");
    int manifests=0,active=0;long bytes=0;
    for(String id:ids){byte[] value=tx.read(VeilRecordKind.OUTBOX,id);
      try{if(value==null)throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");bytes=Math.addExact(bytes,value.length);
        if(id.startsWith(PREFIX)){manifests++;try(Manifest saved=decode(value)){if(saved.state!=State.CONFIRMED)active++;}}
        if(bytes>MAX_OUTBOX_BYTES)throw fail("VEIL_FANOUT_QUEUE_FULL");
      }finally{wipe(value);}}
    if(manifests>MAX_MANIFESTS||active>MAX_QUEUED||(newManifest&&(manifests>=MAX_MANIFESTS||active>=MAX_QUEUED)))throw fail("VEIL_FANOUT_QUEUE_FULL");
  }
  static Batch prepareInTransaction(VeilRecordTransaction tx,Directory directory,VeilContextAuthority contexts,IdentityKey own,
      SignalProtocolAddress local,UUID operation,String handle,byte[] supplied) throws Exception {
    key(operation);VeilAuthenticatedEnvelope.validateContent(supplied);byte[] content=supplied.clone(),saved=null,request=null;
    Authorized authorized=null;List<Packet> packets=new ArrayList<>();
    try {
      authorized=authorize(tx,directory,contexts,own,local,handle);request=VeilAuthenticatedEnvelope.digest(authorized.digest,VeilAuthenticatedEnvelope.id(operation),content);
      saved=record(tx,operation);
      if(saved!=null){try(Manifest manifest=decode(saved)){checkCurrent(manifest,authorized,operation);if(!Arrays.equals(request,manifest.request))throw fail("VEIL_AUTHENTICATED_MESSAGE_REUSE");eligible(manifest);retainedSources(tx,manifest);authorized.snapshot.recheck.run();tx.checkLive();return batch(manifest,authorized.snapshot);}}
      budget(tx,true);
      for(Recipient recipient:authorized.snapshot.recipients){
        UUID deviceOperation=UUID.randomUUID();byte[] collision=tx.read(VeilRecordKind.OUTBOX,"signal:"+deviceOperation);
        if(collision!=null){wipe(collision);throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");}
        authorized.snapshot.recheck.run();tx.checkLive();
        VeilSignalOutbox.PendingCiphertext pending=VeilSignalOutbox.encryptInTransaction(tx,contexts,own,local,deviceOperation,recipient.contextHandle,address(recipient.device),content);
        byte[] wire=pending.serialize(),source=tx.read(VeilRecordKind.OUTBOX,"signal:"+deviceOperation);
        try{if(source==null)throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");packets.add(new Packet(deviceOperation,pending.senderMessageId,pending.type,wire,VeilAuthenticatedEnvelope.digest(source)));}finally{wipe(wire);wipe(source);}
      }
      try(Manifest manifest=new Manifest(operation,State.PREPARED,authorized.digest,request,packets)){
        save(tx,manifest);budget(tx,false);authorized.snapshot.recheck.run();tx.checkLive();return batch(manifest,authorized.snapshot);
      }
    }finally{wipe(content);wipe(saved);wipe(request);if(authorized!=null)wipe(authorized.digest);for(Packet packet:packets)packet.close();}
  }
  static Batch retryInTransaction(VeilRecordTransaction tx,Directory directory,VeilContextAuthority contexts,IdentityKey own,
      SignalProtocolAddress local,UUID operation,String handle) throws Exception {
    Authorized authorized=authorize(tx,directory,contexts,own,local,handle);byte[] saved=null;
    try{saved=record(tx,operation);if(saved==null)throw fail("VEIL_FANOUT_ORIGINAL_REQUIRED");try(Manifest manifest=decode(saved)){checkCurrent(manifest,authorized,operation);eligible(manifest);retainedSources(tx,manifest);authorized.snapshot.recheck.run();tx.checkLive();return batch(manifest,authorized.snapshot);}}
    finally{wipe(saved);wipe(authorized.digest);}
  }
  static Batch beginDeliveryInTransaction(VeilRecordTransaction tx,Directory directory,VeilContextAuthority contexts,IdentityKey own,
      SignalProtocolAddress local,UUID operation,String handle) throws Exception {
    Authorized authorized=authorize(tx,directory,contexts,own,local,handle);byte[] saved=null;
    try{saved=record(tx,operation);if(saved==null)throw fail("VEIL_FANOUT_ORIGINAL_REQUIRED");try(Manifest manifest=decode(saved)){checkCurrent(manifest,authorized,operation);eligible(manifest);retainedSources(tx,manifest);manifest.state=State.IN_FLIGHT;save(tx,manifest);authorized.snapshot.recheck.run();tx.checkLive();return batch(manifest,authorized.snapshot);}}
    finally{wipe(saved);wipe(authorized.digest);}
  }
  static State reconcileInTransaction(VeilRecordTransaction tx,Directory directory,VeilContextAuthority contexts,DeliveryVerifier verifier,
      IdentityKey own,SignalProtocolAddress local,UUID operation,String handle) throws Exception {
    Authorized authorized=authorize(tx,directory,contexts,own,local,handle);byte[] saved=null,digest=null;
    try{saved=record(tx,operation);if(saved==null)throw fail("VEIL_FANOUT_ORIGINAL_REQUIRED");try(Manifest manifest=decode(saved)){
      checkCurrent(manifest,authorized,operation);if(manifest.state==State.CONFIRMED)return State.CONFIRMED;
      if(manifest.state==State.PREPARED)throw fail("VEIL_FANOUT_NOT_IN_FLIGHT");retainedSources(tx,manifest);
      if(verifier==null)throw fail("VEIL_FANOUT_DELIVERY_VERIFIER_UNAVAILABLE");
      // The proof identity is independent of mutable delivery state.
      State prior=manifest.state;manifest.state=State.PREPARED;byte[] original=encode(manifest);manifest.state=prior;
      try{digest=VeilAuthenticatedEnvelope.digest(original);}finally{wipe(original);}
      Observation observation=verifier.verify(tx,operation,digest.clone());if(observation==null)throw fail("VEIL_FANOUT_DELIVERY_VERIFIER_UNAVAILABLE");guard(tx,observation.recheck);
      manifest.state=observation.outcome==Outcome.ALL_CONFIRMED?State.CONFIRMED:observation.outcome==Outcome.DEFINITELY_NOT_SENT?State.PREPARED:State.UNKNOWN;
      if(manifest.state==State.CONFIRMED){for(Packet packet:manifest.packets){tx.remove(VeilRecordKind.OUTBOX,"signal:"+packet.deviceOperation);packet.close();}manifest.packets.clear();}
      save(tx,manifest);authorized.snapshot.recheck.run();observation.recheck.run();tx.checkLive();return manifest.state;
    }}finally{wipe(saved);wipe(digest);wipe(authorized.digest);}
  }
  private static void save(VeilRecordTransaction tx,Manifest manifest){byte[] bytes=encode(manifest);try{tx.write(VeilRecordKind.OUTBOX,key(manifest.operation),bytes);}finally{wipe(bytes);}}
  private static byte[] encode(Manifest manifest) {
    int size=HEADER;for(Packet packet:manifest.packets)size=Math.addExact(size,72+packet.wire.length);
    if(size>MAX_BATCH_BYTES)throw fail("VEIL_FANOUT_QUEUE_FULL");
    ByteBuffer buffer=ByteBuffer.allocate(size).putInt(MAGIC).putInt(manifest.state.ordinal()).put(VeilAuthenticatedEnvelope.id(manifest.operation)).put(manifest.snapshot).put(manifest.request).putInt(manifest.packets.size());
    for(Packet packet:manifest.packets)buffer.put(VeilAuthenticatedEnvelope.id(packet.deviceOperation)).put(VeilAuthenticatedEnvelope.id(packet.senderMessageId)).putInt(packet.type).putInt(packet.wire.length).put(packet.wire).put(packet.sourceDigest);
    return buffer.array();
  }
  private static Manifest decode(byte[] bytes) {
    List<Packet> packets=new ArrayList<>();byte[] snapshot=new byte[32],request=new byte[32];
    try{
      if(bytes.length<HEADER||bytes.length>MAX_BATCH_BYTES)throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");ByteBuffer buffer=ByteBuffer.wrap(bytes);
      if(buffer.getInt()!=MAGIC)throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");int status=buffer.getInt();if(status<0||status>=State.values().length)throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");State state=State.values()[status];
      UUID operation=new UUID(buffer.getLong(),buffer.getLong());VeilAuthenticatedEnvelope.validateId(operation);buffer.get(snapshot).get(request);int count=buffer.getInt();
      if(count<0||count>MAX_RECIPIENTS||(state==State.CONFIRMED?count!=0:count==0))throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");Set<UUID> seen=new HashSet<>();
      for(int i=0;i<count;i++){UUID id=new UUID(buffer.getLong(),buffer.getLong()),message=new UUID(buffer.getLong(),buffer.getLong());int type=buffer.getInt(),size=buffer.getInt();
        if(size<1||size>VeilAuthenticatedEnvelope.MAX_CIPHER||size>buffer.remaining()-32||!seen.add(id))throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");
        byte[] wire=new byte[size],source=new byte[32];try{buffer.get(wire).get(source);packets.add(new Packet(id,message,type,wire,source));}finally{wipe(wire);wipe(source);}}
      if(buffer.hasRemaining())throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");Manifest result=new Manifest(operation,state,snapshot,request,packets);packets=null;return result;
    }catch(RuntimeException error){throw fail("VEIL_NATIVE_RECOVERY_REQUIRED");}
    finally{wipe(snapshot);wipe(request);if(packets!=null)for(Packet packet:packets)packet.close();}
  }
}
