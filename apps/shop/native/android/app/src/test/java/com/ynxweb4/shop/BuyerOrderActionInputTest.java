package com.ynxweb4.shop;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
public final class BuyerOrderActionInputTest {
    @Test public void requiresExplicitRatingAndKeepsActualReview()throws Exception{
        assertThrows(IllegalArgumentException.class,()->BuyerOrderActionInput.build("delivered","reviewed",0,"",""));
        JSONObject body=BuyerOrderActionInput.build("delivered","reviewed",2,"","Actual buyer review");assertEquals(2,body.getInt("Rating"));assertEquals("Actual buyer review",body.getString("Body"));assertEquals("",body.getString("Explanation"));
        assertEquals("",BuyerOrderActionInput.build("delivered","reviewed",4,"","").getString("Body"));
    }
    @Test public void rejectsSellerActionsInvalidStatesAndFabricatedDefaults(){
        assertThrows(IllegalArgumentException.class,()->BuyerOrderActionInput.build("paid","reviewed",5,"","text"));
        assertThrows(IllegalArgumentException.class,()->BuyerOrderActionInput.build("paid","shipped",0,"",""));
        assertThrows(IllegalArgumentException.class,()->BuyerOrderActionInput.build("paid","refund_requested",0,"  ",""));
        assertThrows(IllegalArgumentException.class,()->BuyerOrderActionInput.build("shipped","delivered",5,"",""));
    }
    @Test public void separatesActualReasonAndExplanationWithBackendByteLimits()throws Exception{
        JSONObject body=BuyerOrderActionInput.build("reviewed","return_requested",0,"  Damaged  "," Packaging torn ");assertEquals("Damaged",body.getString("Reason"));assertEquals("Packaging torn",body.getString("Explanation"));assertEquals("",body.getString("Body"));
        BuyerOrderActionInput.build("refund_requested","disputed",0,"a".repeat(1000),"a".repeat(5000));
        assertThrows(IllegalArgumentException.class,()->BuyerOrderActionInput.build("paid","disputed",0,"中".repeat(334),""));
        assertThrows(IllegalArgumentException.class,()->BuyerOrderActionInput.build("delivered","reviewed",3,"","中".repeat(1667)));
    }
    @Test public void confirmationActionsContainNoInventedRatingOrText()throws Exception{
        JSONObject body=BuyerOrderActionInput.build("payment_pending","cancelled",0,"","");assertEquals(0,body.getInt("Rating"));assertEquals("",body.getString("Body"));assertEquals("",body.getString("Reason"));assertFalse(body.has("IdempotencyKey"));
    }
}
