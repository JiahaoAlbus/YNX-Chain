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
 @Test public void confirmationReadsOnlyOriginalOwnedShopReceipt()throws Exception{
  assertEquals("/orders/ord_original/confirm-payment",NativeIntentObservation.confirmationPath(order(),"original_account"));
  assertThrows(SecurityException.class,()->NativeIntentObservation.confirmationPath(order(),"foreign"));
  assertThrows(SecurityException.class,()->NativeIntentObservation.confirmationPath(order().put("PayIntentID","npi_invalid"),"original_account"));
  assertEquals("[\"account:read\",\"shop:orders:write\"]",NativeProductState.canonical(NativeBusinessPolicy.scopes("POST","/api/orders/ord_original/confirm-payment")));
  assertThrows(SecurityException.class,()->NativeBusinessPolicy.scopes("GET","/api/orders/ord_original/confirm-payment"));
 }
 @Test public void actualJointOriginalPartialRefundReadback()throws Exception{
  JSONObject actual=new JSONObject(java.nio.file.Files.readString(java.nio.file.Path.of(System.getenv("YNX_SHOP_NATIVE_RECEIPT_FIXTURE"))));
  NativeIntentObservation.validatePayment(actual);
  assertEquals("30",actual.getJSONObject("NativePayment").getString("RefundedAtoms"));
  assertEquals("70",actual.getJSONObject("NativePayment").getString("NetPaidAtoms"));
  for(String key:new String[]{"InvoiceID","NetPaidAtoms","PaidAtoms","TermsHash"}){
   JSONObject changed=new JSONObject(actual.toString());changed.getJSONObject("NativePayment").put(key,"foreign");assertThrows(SecurityException.class,()->NativeIntentObservation.validatePayment(changed));
  }
  JSONObject wrong=new JSONObject(actual.toString());wrong.getJSONObject("NativePayment").getJSONArray("Receipts").getJSONObject(0).put("sourceOrder","foreign");assertThrows(SecurityException.class,()->NativeIntentObservation.validatePayment(wrong));
 }
 @Test public void reboundOriginalAndInventedFundsAreRejected()throws Exception{
  for(String key:new String[]{"orderId","originalOperation","state","phase","queryOnly","fundsVerified"}){JSONObject invalid=observation();invalid.put(key,key.equals("phase")?"invalid/phase":"foreign");assertThrows(SecurityException.class,()->NativeIntentObservation.validate(order(),invalid));}
  assertThrows(SecurityException.class,()->NativeIntentObservation.validate(order(),observation().put("fundsVerified",true)));
  assertThrows(SecurityException.class,()->NativeIntentObservation.path(order().put("PayIntentID","npi_invalid"),"original_account"));
 }
}
