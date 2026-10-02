package com.ynxweb4.shop;

import org.json.*;
import org.junit.Test;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

public final class PrivacyLifecycleTest {
    static final String A="ynx1"+"q".repeat(38),B="ynx1"+"p".repeat(38);
    static class Memory implements PrivacyLifecycle.Storage,OfflineMutationQueue.Storage {
        final Map<String,String> values=new ConcurrentHashMap<>();boolean failBatch;
        interface Hook{void run()throws Exception;} volatile Hook queueRead;
        public String get(String key)throws Exception{String result=values.getOrDefault(key,"");Hook hook=queueRead;if(key.equals("offline_mutations")&&hook!=null)hook.run();return result;}
        public void put(String key,String value){values.put(key,value);}
        public void putAll(Map<String,String> updates)throws Exception{if(failBatch)throw new IOException("injected atomic commit failure");values.putAll(updates);}
        void login(String account)throws Exception{put("commerce_session",new JSONObject().put("account",account).put("token","qa-product-service-token-opaque").put("expiresAt",Instant.now().plusSeconds(240).toString()).toString());}
    }
    private JSONObject receipt(JSONObject request)throws Exception{return new JSONObject().put("receiptId","qa-privacy-receipt").put("deletionRequestId",request.getString("deletionRequestId")).put("retiredIntentsVersion",1).put("retiredIntentsCount",request.getJSONArray("retiredIntents").length());}
    private JSONObject order(String key)throws Exception{return new JSONObject().put("IdempotencyKey",key).put("StoreID","store").put("Items",new JSONArray("[{\"ProductID\":\"p\",\"VariantID\":\"v\",\"Quantity\":1}]")).put("Address",new JSONObject().put("Line1","preserved original address"));}
    @Test public void admittedButNotDispatchedWriteCannotPassDeletionBarrier()throws Exception{
        Memory memory=new Memory();PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);
        PrivacyLifecycle.Ticket ticket=lifecycle.admit(A,"PUT","/profile",new JSONObject().put("DisplayName","earlier"));
        lifecycle.begin(A);AtomicInteger network=new AtomicInteger();
        assertThrows(PrivacyLifecycle.Blocked.class,()->ApiClient.executeTracked(lifecycle,ticket,()->true,()->{network.incrementAndGet();return new ApiClient.Response(200,new JSONObject());}));
        assertEquals(0,network.get());assertEquals(0,lifecycle.snapshot(A).getJSONObject("requests").length());assertNotNull(lifecycle.plan(A));
    }
    @Test public void threeLiveWorkersRecordOutcomesBeforeOldContextIsSuppressed()throws Exception{
        Memory memory=new Memory();PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);
        PrivacyLifecycle.Ticket profile=lifecycle.admit(A,"PUT","/profile",new JSONObject()),cart=lifecycle.admit(A,"PUT","/cart",new JSONObject()),order=lifecycle.admit(A,"POST","/orders",order("three-worker-key"));
        CountDownLatch sent=new CountDownLatch(3),finish=new CountDownLatch(1);ExecutorService workers=Executors.newFixedThreadPool(3);
        try{
            List<Future<?>> futures=new ArrayList<>();for(PrivacyLifecycle.Ticket ticket:List.of(profile,cart,order))futures.add(workers.submit(()->{
                try{ApiClient.executeTracked(lifecycle,ticket,()->lifecycle.current(A,ticket.generation),()->{sent.countDown();assertTrue(finish.await(2,TimeUnit.SECONDS));if(ticket==cart)throw new IOException("lost response");return new ApiClient.Response(200,new JSONObject());});fail("old context presented");}
                catch(SecurityException|IOException expected){}catch(Exception error){throw new RuntimeException(error);}
            }));
            assertTrue(sent.await(2,TimeUnit.SECONDS));lifecycle.begin(A);assertNull(lifecycle.plan(A));finish.countDown();for(Future<?> future:futures)future.get(2,TimeUnit.SECONDS);
            JSONObject pending=lifecycle.snapshot(A).getJSONObject("requests");assertEquals(1,pending.length());assertEquals("UNKNOWN",pending.getJSONObject(cart.id).getString("status"));
            assertThrows(PrivacyLifecycle.Blocked.class,()->lifecycle.plan(A));
            PrivacyLifecycle restored=new PrivacyLifecycle(memory);assertEquals(PrivacyLifecycle.BLOCKED,restored.snapshot(A).getString("phase"));assertThrows(PrivacyLifecycle.Blocked.class,()->restored.startNewShopping(A));assertThrows(PrivacyLifecycle.Blocked.class,()->restored.plan(A));
            assertNotNull(restored.admit(B,"PUT","/profile",new JSONObject()));
        }finally{finish.countDown();workers.shutdownNow();}
    }
    @Test public void dispatchWithoutAReceiptBecomesUnknownAfterProcessRestart()throws Exception{
        Memory memory=new Memory();PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);PrivacyLifecycle.Ticket ticket=lifecycle.admit(A,"POST","/orders/order_"+"a".repeat(24)+"/pay-handoff",new JSONObject());lifecycle.dispatch(ticket);
        PrivacyLifecycle restored=new PrivacyLifecycle(memory);restored.begin(A);assertThrows(PrivacyLifecycle.Blocked.class,()->restored.plan(A));
        assertEquals("UNKNOWN",restored.snapshot(A).getJSONObject("requests").getJSONObject(ticket.id).getString("status"));assertEquals(PrivacyLifecycle.BLOCKED,restored.snapshot(A).getString("phase"));
    }
    @Test public void confirmedDeletionPreservesOriginalEvidenceAndOtherAccountsAndTwoRoundsStaySeparate()throws Exception{
        Memory memory=new Memory();memory.login(A);PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);OfflineMutationQueue queue=new OfflineMutationQueue(memory);
        JSONObject purchase=order("archived-order-key");CheckoutIntent intent=CheckoutIntent.prepare(A,purchase,"");purchase.put("IdempotencyKey",intent.key);
        memory.put("checkout:"+A,intent.serialized);memory.put("cart:"+A,purchase.getJSONArray("Items").toString());queue.enqueue("POST","/orders",purchase);
        memory.login(B);queue.enqueue("POST","/orders",order("foreign-order-key"));memory.put("checkout:"+B,"foreign checkout evidence");memory.put("cart:"+B,"foreign cart");memory.login(A);
        JSONArray original=new JSONArray(memory.get("offline_mutations"));JSONObject legacy=new JSONObject().put("id","old-unbound").put("body","unbound evidence");original.put(legacy);memory.put("offline_mutations",original.toString());
        PrivacyLifecycle.Ticket ai=lifecycle.admit(A,"POST","/ai/jobs",new JSONObject().put("IdempotencyKey","unknown-ai-key"));lifecycle.dispatch(ai);lifecycle.outcome(ai,false);
        lifecycle.begin(A);JSONObject request=lifecycle.plan(A);assertEquals(2,request.getJSONArray("retiredIntents").length());lifecycle.confirm(A,request,receipt(request));
        JSONObject state=lifecycle.snapshot(A);assertEquals(PrivacyLifecycle.CONFIRMED,state.getString("phase"));assertEquals(0,state.getJSONObject("requests").length());assertTrue(state.getJSONArray("archives").toString().contains("preserved original address"));
        JSONArray remaining=new JSONArray(memory.get("offline_mutations"));assertEquals(2,remaining.length());assertEquals(B,remaining.getJSONObject(0).getString("account"));assertEquals(legacy.toString(),remaining.getJSONObject(1).toString());assertEquals("",memory.get("checkout:"+A));assertEquals("[]",memory.get("cart:"+A));assertEquals("foreign checkout evidence",memory.get("checkout:"+B));assertEquals("foreign cart",memory.get("cart:"+B));
        lifecycle.startNewShopping(A);assertFalse(PrivacyLifecycle.queueExecutable(memory,A,original.getJSONObject(0)));queue.enqueue("POST","/orders",order("second-round-key"));lifecycle.begin(A);JSONObject second=lifecycle.plan(A);assertEquals(1,second.getJSONArray("retiredIntents").length());assertEquals("second-round-key",second.getJSONArray("retiredIntents").getJSONObject(0).getString("key"));lifecycle.confirm(A,second,receipt(second));assertEquals(2,lifecycle.snapshot(A).getJSONArray("archives").length());
    }
    @Test public void lostDeletionReceiptRetriesTheFrozenIdAndListWithoutOpeningWrites()throws Exception{
        Memory memory=new Memory();memory.login(A);PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);new OfflineMutationQueue(memory).enqueue("POST","/orders",order("frozen-key"));lifecycle.begin(A);JSONObject sent=lifecycle.plan(A);
        PrivacyLifecycle restored=new PrivacyLifecycle(memory);assertEquals(PrivacyLifecycle.UNKNOWN,restored.snapshot(A).getString("phase"));assertThrows(PrivacyLifecycle.Blocked.class,()->restored.admit(A,"PUT","/cart",new JSONObject()));
        JSONObject retry=restored.plan(A);assertEquals(WalletAuth.canonical(sent),WalletAuth.canonical(retry));assertThrows(PrivacyLifecycle.Blocked.class,()->restored.plan(A));restored.confirm(A,retry,receipt(retry));assertEquals(PrivacyLifecycle.CONFIRMED,restored.snapshot(A).getString("phase"));
    }
    @Test public void validReceiptSurvivesCleanupCommitFailureWithoutDowngradingToUnknown()throws Exception{
        Memory memory=new Memory();memory.login(A);PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);new OfflineMutationQueue(memory).enqueue("POST","/orders",order("cleanup-order-key"));String before=memory.get("offline_mutations");lifecycle.begin(A);JSONObject request=lifecycle.plan(A);memory.failBatch=true;
        long drainingRead=lifecycle.generation(A);assertThrows(IOException.class,()->lifecycle.confirm(A,request,receipt(request)));lifecycle.markUnknown(A,request);assertEquals(PrivacyLifecycle.CLEANUP,lifecycle.snapshot(A).getString("phase"));assertFalse(lifecycle.current(A,drainingRead));assertEquals(before,memory.get("offline_mutations"));
        PrivacyLifecycle restarted=new PrivacyLifecycle(memory);assertEquals(PrivacyLifecycle.CLEANUP,restarted.snapshot(A).getString("phase"));memory.failBatch=false;restarted.finishCleanup(A);assertEquals(PrivacyLifecycle.CONFIRMED,restarted.snapshot(A).getString("phase"));assertEquals("[]",memory.get("offline_mutations"));assertTrue(restarted.snapshot(A).getJSONArray("archives").toString().contains("cleanup-order-key"));
    }
    @Test public void incompatibleReceiptPreservesEvidenceAndDoesNotUnlockTheAccount()throws Exception{
        Memory memory=new Memory();PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);lifecycle.begin(A);JSONObject request=lifecycle.plan(A);JSONObject wrong=receipt(request).put("deletionRequestId","wrong-operation");
        assertThrows(PrivacyLifecycle.Blocked.class,()->lifecycle.confirm(A,request,wrong));assertEquals(PrivacyLifecycle.UNKNOWN,lifecycle.snapshot(A).getString("phase"));assertThrows(PrivacyLifecycle.Blocked.class,()->lifecycle.startNewShopping(A));assertEquals(WalletAuth.canonical(request),WalletAuth.canonical(lifecycle.plan(A)));
    }
    @Test public void oldQueueWorkerCannotAdmitUnderTheNewShoppingGeneration()throws Exception{
        Memory memory=new Memory();memory.login(A);PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);OfflineMutationQueue queue=new OfflineMutationQueue(memory);JSONObject body=order("old-worker-key");queue.enqueue("POST","/orders",body);
        CountDownLatch selected=new CountDownLatch(1),admit=new CountDownLatch(1);ExecutorService worker=Executors.newSingleThreadExecutor();AtomicInteger network=new AtomicInteger();
        try{
            Future<Integer> flush=worker.submit(()->queue.flush(new OfflineMutationQueue.Sender(){public ProductSession session()throws Exception{return ProductSession.parse(memory.get("commerce_session"),Instant.now());}public JSONObject requestForSession(String method,String path,JSONObject request,ProductSession session,long generation)throws Exception{selected.countDown();assertTrue(admit.await(2,TimeUnit.SECONDS));PrivacyLifecycle.Ticket ticket=lifecycle.admit(A,method,path,request,generation);return ApiClient.executeTracked(lifecycle,ticket,()->true,()->{network.incrementAndGet();return new ApiClient.Response(200,new JSONObject());});}}));
            assertTrue(selected.await(2,TimeUnit.SECONDS));lifecycle.begin(A);JSONObject deletion=lifecycle.plan(A);lifecycle.confirm(A,deletion,receipt(deletion));lifecycle.startNewShopping(A);admit.countDown();assertEquals(Integer.valueOf(0),flush.get(2,TimeUnit.SECONDS));assertEquals(0,network.get());assertEquals(0,lifecycle.snapshot(A).getJSONObject("requests").length());
        }finally{admit.countDown();worker.shutdownNow();}
    }
    @Test public void delayedRestoreClickCannotTakeANewGenerationQueueSnapshot()throws Exception{
        Memory memory=new Memory();memory.login(A);PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);OfflineMutationQueue queue=new OfflineMutationQueue(memory);long clickedGeneration=lifecycle.generation(A);ProductSession session=ProductSession.parse(memory.get("commerce_session"),Instant.now());
        CountDownLatch delayed=new CountDownLatch(1),start=new CountDownLatch(1);ExecutorService worker=Executors.newSingleThreadExecutor();AtomicInteger network=new AtomicInteger();
        try{
            Future<?> click=worker.submit(()->{delayed.countDown();try{assertTrue(start.await(2,TimeUnit.SECONDS));assertThrows(PrivacyLifecycle.Blocked.class,()->queue.flush(new OfflineMutationQueue.Sender(){public ProductSession session(){return session;}public JSONObject requestForSession(String method,String path,JSONObject body,ProductSession expected,long generation){network.incrementAndGet();return new JSONObject();}},session,clickedGeneration));}catch(Exception error){throw new RuntimeException(error);}});
            assertTrue(delayed.await(2,TimeUnit.SECONDS));lifecycle.begin(A);JSONObject request=lifecycle.plan(A);lifecycle.confirm(A,request,receipt(request));lifecycle.startNewShopping(A);queue.enqueue("POST","/orders",order("new-shopping-key"));start.countDown();click.get(2,TimeUnit.SECONDS);assertEquals(0,network.get());assertEquals(1,queue.size());assertEquals("new-shopping-key",new JSONArray(memory.get("offline_mutations")).getJSONObject(0).getJSONObject("body").getString("IdempotencyKey"));
        }finally{start.countDown();worker.shutdownNow();}
    }
    @Test public void queueAcknowledgementAndDeletionCleanupCannotOverwriteEachOthersQueueSnapshot()throws Exception{
        Memory memory=new Memory();memory.login(A);PrivacyLifecycle lifecycle=new PrivacyLifecycle(memory);OfflineMutationQueue queue=new OfflineMutationQueue(memory);queue.enqueue("POST","/orders",order("interleave-a-key"));memory.login(B);queue.enqueue("POST","/orders",order("interleave-b-key"));memory.login(A);
        CountDownLatch sent=new CountDownLatch(1),returnResponse=new CountDownLatch(1),snapshotRead=new CountDownLatch(1),finishAck=new CountDownLatch(1),cleanupStarted=new CountDownLatch(1);ExecutorService workers=Executors.newFixedThreadPool(2);
        try{
            Future<Integer> flush=workers.submit(()->{Thread.currentThread().setName("queue-ack-test");return queue.flush(new OfflineMutationQueue.Sender(){public ProductSession session()throws Exception{return ProductSession.parse(memory.get("commerce_session"),Instant.now());}public JSONObject requestForSession(String method,String path,JSONObject body,ProductSession session,long generation)throws Exception{sent.countDown();assertTrue(returnResponse.await(2,TimeUnit.SECONDS));return new JSONObject();}});});
            assertTrue(sent.await(2,TimeUnit.SECONDS));lifecycle.begin(A);JSONObject request=lifecycle.plan(A);
            AtomicBoolean intercepted=new AtomicBoolean();memory.queueRead=()->{if(Thread.currentThread().getName().equals("queue-ack-test")&&intercepted.compareAndSet(false,true)){snapshotRead.countDown();assertTrue(finishAck.await(2,TimeUnit.SECONDS));}};
            returnResponse.countDown();assertTrue(snapshotRead.await(2,TimeUnit.SECONDS));Future<?> cleanup=workers.submit(()->{cleanupStarted.countDown();try{lifecycle.confirm(A,request,receipt(request));}catch(Exception error){throw new RuntimeException(error);}});assertTrue(cleanupStarted.await(2,TimeUnit.SECONDS));assertThrows(TimeoutException.class,()->cleanup.get(100,TimeUnit.MILLISECONDS));finishAck.countDown();assertEquals(Integer.valueOf(1),flush.get(2,TimeUnit.SECONDS));cleanup.get(2,TimeUnit.SECONDS);
            JSONArray remaining=new JSONArray(memory.get("offline_mutations"));assertEquals(1,remaining.length());assertEquals(B,remaining.getJSONObject(0).getString("account"));assertEquals(PrivacyLifecycle.CONFIRMED,lifecycle.snapshot(A).getString("phase"));
        }finally{memory.queueRead=null;returnResponse.countDown();finishAck.countDown();workers.shutdownNow();}
    }
}
