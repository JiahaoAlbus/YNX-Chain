package com.ynxweb4.shop;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeIntentObservationTest {
 private JSONObject order()throws Exception{return new JSONObject().put("ID","ord_original").put("Buyer","original_account").put("PayIntentID","npi_"+"ab".repeat(24));}
 private JSONObject observation()throws Exception{return new JSONObject().put("orderId","ord_original").put("originalOperation","npi_"+"ab".repeat(24)).put("state","PREPARED").put("phase","signed_not_submitted").put("queryOnly",true).put("fundsVerified",false);}
 @Test public void originalOwnedIntentHasOnlyReadRoute()throws Exception{
  JSONObject original=order();assertTrue(NativeIntentObservation.isNative(original));assertEquals("/orders/ord_original/native-pay-intent",NativeIntentObservation.path(original,"original_account"));NativeIntentObservation.validate(original,observation());
  assertThrows(SecurityException.class,()->NativeIntentObservation.path(original,"foreign"));
  assertEquals("[\"account:read\",\"shop:orders:write\"]",NativeProductState.canonical(NativeBusinessPolicy.scopes("GET","/api/orders/ord_original/native-pay-intent")));
  assertThrows(SecurityException.class,()->NativeBusinessPolicy.scopes("DELETE","/api/orders/ord_original/native-pay-intent"));
 }
 @Test public void reboundOriginalAndInventedFundsAreRejected()throws Exception{
  for(String key:new String[]{"orderId","originalOperation","state","phase","queryOnly","fundsVerified"}){JSONObject invalid=observation();invalid.put(key,key.equals("phase")?"invalid/phase":"foreign");assertThrows(SecurityException.class,()->NativeIntentObservation.validate(order(),invalid));}
  assertThrows(SecurityException.class,()->NativeIntentObservation.validate(order(),observation().put("fundsVerified",true)));
  assertThrows(SecurityException.class,()->NativeIntentObservation.path(order().put("PayIntentID","npi_invalid"),"original_account"));
 }
}
