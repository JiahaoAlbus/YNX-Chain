package com.ynxweb4.shop;

import org.json.JSONObject;
import org.junit.Test;
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
}
