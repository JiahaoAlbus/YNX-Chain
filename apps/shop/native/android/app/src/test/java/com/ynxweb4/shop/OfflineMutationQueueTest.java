package com.ynxweb4.shop;
import static org.junit.Assert.*;
import java.time.Instant;
import java.util.HashMap;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
public final class OfflineMutationQueueTest {
 static final String A="ynx1"+"q".repeat(38),B="ynx1"+"p".repeat(38);
 static final class Memory implements OfflineMutationQueue.Storage {
  final HashMap<String,String> values=new HashMap<>();
  public String get(String key){return values.getOrDefault(key,"");}
  public void put(String key,String value){values.put(key,value);}
  void login(String actor)throws Exception{put("commerce_session",new JSONObject().put("account",actor).put("token","qa-product-service-token-opaque").put("expiresAt",Instant.now().plusSeconds(240).toString()).toString());}
 }
 @Test public void legacyAndAnotherAccountRemainStoredAndUnexecuted()throws Exception{
  Memory memory=new Memory();memory.login(A);OfflineMutationQueue queue=new OfflineMutationQueue(memory);
  memory.put("offline_mutations",new JSONArray().put(new JSONObject().put("id","legacy").put("method","POST").put("path","/orders").put("body",new JSONObject())).toString());
  JSONObject intent=new JSONObject().put("IdempotencyKey","original-qa-order-key");queue.enqueue("POST","/orders",intent);intent.put("IdempotencyKey","caller-mutation");memory.login(B);queue.enqueue("POST","/orders",new JSONObject().put("IdempotencyKey","account-b-key"));memory.login(A);
  final int[] calls={0};int count=queue.flush(new OfflineMutationQueue.Sender(){public ProductSession session()throws Exception{return ProductSession.parse(memory.get("commerce_session"),Instant.now());}public JSONObject requestForAccount(String method,String path,JSONObject body,String account)throws Exception{assertEquals(A,account);assertEquals("original-qa-order-key",body.getString("IdempotencyKey"));calls[0]++;return new JSONObject();}});
  assertEquals(1,count);assertEquals(1,calls[0]);JSONArray remaining=new JSONArray(memory.get("offline_mutations"));assertEquals(2,remaining.length());assertEquals("legacy",remaining.getJSONObject(0).getString("id"));assertEquals(B,remaining.getJSONObject(1).getString("account"));
 }
 @Test public void firstFailureRetainsOriginalIntentAndDoesNotRunLaterActions()throws Exception{
  Memory memory=new Memory();memory.login(A);OfflineMutationQueue queue=new OfflineMutationQueue(memory);queue.enqueue("POST","/orders",new JSONObject().put("IdempotencyKey","same-original-key"));queue.enqueue("POST","/orders",new JSONObject().put("IdempotencyKey","later-key"));String before=memory.get("offline_mutations");final int[] calls={0};assertEquals(0,queue.flush(new OfflineMutationQueue.Sender(){public ProductSession session()throws Exception{return ProductSession.parse(memory.get("commerce_session"),Instant.now());}public JSONObject requestForAccount(String m,String p,JSONObject body,String account)throws Exception{calls[0]++;throw new java.io.IOException("bounded QA network failure");}}));assertEquals(1,calls[0]);assertEquals(before,memory.get("offline_mutations"));
 }
 @Test public void guestAndPaymentExecutionCannotEnterQueue()throws Exception{
  Memory memory=new Memory();OfflineMutationQueue queue=new OfflineMutationQueue(memory);
  assertThrows(SecurityException.class,()->queue.enqueue("POST","/orders",new JSONObject()));memory.login(A);
  assertThrows(SecurityException.class,()->queue.enqueue("POST","/orders/example/pay-handoff",new JSONObject()));
  assertThrows(SecurityException.class,()->queue.enqueue("POST","/orders/example/transition",new JSONObject().put("Action","refund_approved")));
  assertEquals(0,queue.size());
 }
 @Test public void repeatedOfflineCheckoutKeepsOneExactIntent()throws Exception{
  Memory memory=new Memory();memory.login(A);OfflineMutationQueue queue=new OfflineMutationQueue(memory);
  JSONObject body=new JSONObject().put("IdempotencyKey","stable-checkout-key").put("Quantity",2);
  String id=queue.enqueue("POST","/orders",body),before=memory.get("offline_mutations");
  assertEquals(id,queue.enqueue("POST","/orders",new JSONObject(body.toString())));assertEquals(1,queue.size());
  body.put("Quantity",3);
  assertThrows(SecurityException.class,()->queue.enqueue("POST","/orders",body));
  assertEquals(before,memory.get("offline_mutations"));
 }
}
