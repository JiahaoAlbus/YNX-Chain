package com.ynxweb4.shop;

import org.json.JSONObject;
import org.junit.Test;
import java.util.concurrent.*;
import static org.junit.Assert.*;

public final class CheckoutIntentTest {
    private static final String ACCOUNT="ynx1"+"q".repeat(38);
    @Test public void lostResponseRetryAcrossRestartKeepsExactPurchaseKey() throws Exception {
        JSONObject original=new JSONObject("{\"StoreID\":\"store\",\"Items\":[{\"ProductID\":\"product\",\"VariantID\":\"variant\",\"Quantity\":2}],\"Address\":{\"Recipient\":\"QA\",\"Line1\":\"address\"}}");
        CheckoutIntent first=CheckoutIntent.prepare(ACCOUNT,original,"");
        original.put("IdempotencyKey",first.key);
        CheckoutIntent restarted=CheckoutIntent.prepare(ACCOUNT,new JSONObject(original.toString()),first.serialized);
        assertEquals(first.key,restarted.key);
        assertEquals(first.key,original.getString("IdempotencyKey"));
        original.getJSONObject("Address").put("Line1","changed address");
        assertNotEquals(first.key,CheckoutIntent.prepare(ACCOUNT,original,first.serialized).key);
    }
    @Test public void anotherAccountCannotAdoptAPreservedCheckoutIntent() throws Exception {
        JSONObject body=new JSONObject().put("StoreID","store");
        CheckoutIntent first=CheckoutIntent.prepare(ACCOUNT,body,"");
        try { CheckoutIntent.prepare("ynx1"+"p".repeat(38),body,first.serialized);fail("foreign intent accepted"); }
        catch (SecurityException expected) { }
    }
    @Test public void confirmedPurchaseDoesNotClearCartEditedWhileRequestWasPending() throws Exception {
        OfflineMutationQueueTest.Memory memory=new OfflineMutationQueueTest.Memory();
        JSONObject body=new JSONObject("{\"StoreID\":\"store\",\"Items\":[{\"ProductID\":\"p\",\"VariantID\":\"v\",\"Quantity\":1}]}");
        CheckoutIntent intent=CheckoutIntent.prepare(ACCOUNT,body,"");body.put("IdempotencyKey",intent.key);memory.put("checkout:"+ACCOUNT,intent.serialized);
        String edited="[{\"ProductID\":\"p\",\"VariantID\":\"v\",\"Quantity\":2}]";memory.put("cart:"+ACCOUNT,edited);
        assertFalse(CheckoutIntent.confirmed(memory,ACCOUNT,body));assertEquals(edited,memory.get("cart:"+ACCOUNT));assertEquals("",memory.get("checkout:"+ACCOUNT));
    }
    @Test public void olderConfirmationCannotClearAReplacementCheckoutEvenWithSameCart() throws Exception {
        OfflineMutationQueueTest.Memory memory=new OfflineMutationQueueTest.Memory();
        JSONObject body=new JSONObject("{\"StoreID\":\"store\",\"Items\":[{\"ProductID\":\"p\",\"VariantID\":\"v\",\"Quantity\":1}],\"Address\":{\"Line1\":\"old\"}}");
        CheckoutIntent first=CheckoutIntent.prepare(ACCOUNT,body,"");body.put("IdempotencyKey",first.key);
        JSONObject next=new JSONObject(body.toString());next.getJSONObject("Address").put("Line1","new");CheckoutIntent replacement=CheckoutIntent.prepare(ACCOUNT,next,first.serialized);
        String cart=body.getJSONArray("Items").toString();memory.put("cart:"+ACCOUNT,cart);memory.put("checkout:"+ACCOUNT,replacement.serialized);
        assertFalse(CheckoutIntent.confirmed(memory,ACCOUNT,body));assertEquals(cart,memory.get("cart:"+ACCOUNT));assertEquals(replacement.serialized,memory.get("checkout:"+ACCOUNT));
    }
    @Test public void failedCartPersistenceRetainsTheIdempotencyRecordForRetry() throws Exception {
        java.util.Map<String,String> records=new java.util.HashMap<>();JSONObject body=new JSONObject("{\"Items\":[{\"ProductID\":\"p\",\"Quantity\":1}]}");
        CheckoutIntent intent=CheckoutIntent.prepare(ACCOUNT,body,"");body.put("IdempotencyKey",intent.key);String cart=body.getJSONArray("Items").toString();records.put("checkout:"+ACCOUNT,intent.serialized);records.put("cart:"+ACCOUNT,cart);
        CheckoutIntent.Storage failing=new CheckoutIntent.Storage(){public String get(String key){return records.getOrDefault(key,"");}public void put(String key,String value)throws Exception{if(key.startsWith("cart:"))throw new java.io.IOException("storage unavailable");records.put(key,value);}};
        assertThrows(java.io.IOException.class,()->CheckoutIntent.confirmed(failing,ACCOUNT,body));assertEquals(intent.serialized,records.get("checkout:"+ACCOUNT));assertEquals(cart,records.get("cart:"+ACCOUNT));
    }
    @Test public void acknowledgementBetweenCartCaptureAndIntentReadCannotCreateANewPurchaseKey() throws Exception {
        OfflineMutationQueueTest.Memory memory=new OfflineMutationQueueTest.Memory();memory.login(ACCOUNT);
        JSONObject purchase=new JSONObject("{\"StoreID\":\"store\",\"Items\":[{\"ProductID\":\"p\",\"VariantID\":\"v\",\"Quantity\":1}],\"Address\":{\"Line1\":\"saved address\"}}");
        CheckoutIntent first=CheckoutIntent.prepare(ACCOUNT,purchase,"");purchase.put("IdempotencyKey",first.key);
        memory.put("cart:"+ACCOUNT,purchase.getJSONArray("Items").toString());memory.put("checkout:"+ACCOUNT,first.serialized);
        CountDownLatch captured=new CountDownLatch(1),resume=new CountDownLatch(1),ackStarted=new CountDownLatch(1);
        ExecutorService workers=Executors.newFixedThreadPool(2);
        try{
            Future<CheckoutIntent.Prepared> retry=workers.submit(()->CheckoutIntent.prepareCart(memory,purchase.getJSONObject("Address"),id->{
                assertEquals("p",id);captured.countDown();if(!resume.await(2,TimeUnit.SECONDS))throw new IllegalStateException("checkout barrier timed out");return "store";
            }));
            assertTrue(captured.await(2,TimeUnit.SECONDS));
            Future<Boolean> acknowledgement=workers.submit(()->{ackStarted.countDown();return CheckoutIntent.confirmed(memory,ACCOUNT,purchase);});
            assertTrue(ackStarted.await(2,TimeUnit.SECONDS));
            // The acknowledgement is actually running at the snapshot/read
            // boundary, and must wait for the durable retry intent.
            assertThrows(TimeoutException.class,()->acknowledgement.get(100,TimeUnit.MILLISECONDS));
            resume.countDown();CheckoutIntent.Prepared prepared=retry.get(2,TimeUnit.SECONDS);
            assertEquals(first.key,prepared.body.getString("IdempotencyKey"));assertEquals(ACCOUNT,prepared.session.account);
            assertTrue(acknowledgement.get(2,TimeUnit.SECONDS));assertEquals("[]",memory.get("cart:"+ACCOUNT));assertEquals("",memory.get("checkout:"+ACCOUNT));
        }finally{resume.countDown();workers.shutdownNow();}
    }
    @Test public void acknowledgementThatWinsBeforeCaptureLeavesNoCheckoutToRetry() throws Exception {
        OfflineMutationQueueTest.Memory memory=new OfflineMutationQueueTest.Memory();memory.login(ACCOUNT);
        JSONObject purchase=new JSONObject("{\"StoreID\":\"store\",\"Items\":[{\"ProductID\":\"p\",\"VariantID\":\"v\",\"Quantity\":1}],\"Address\":{\"Line1\":\"saved address\"}}");
        CheckoutIntent first=CheckoutIntent.prepare(ACCOUNT,purchase,"");purchase.put("IdempotencyKey",first.key);
        memory.put("cart:"+ACCOUNT,purchase.getJSONArray("Items").toString());memory.put("checkout:"+ACCOUNT,first.serialized);
        assertTrue(CheckoutIntent.confirmed(memory,ACCOUNT,purchase));
        assertThrows(CheckoutIntent.EmptyCartException.class,()->CheckoutIntent.prepareCart(memory,purchase.getJSONObject("Address"),id->"store"));
        assertEquals("",memory.get("checkout:"+ACCOUNT));assertEquals("[]",memory.get("cart:"+ACCOUNT));
    }
}
