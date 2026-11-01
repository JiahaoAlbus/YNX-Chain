package com.ynxweb4.shop;

import org.json.JSONObject;

// Read-only DATA from the original Pay intent, never a funds acknowledgement.
final class NativeIntentObservation {
 static boolean isNative(JSONObject order){return order.optString("PayIntentID").startsWith("npi_");}
 static String path(JSONObject order,String account){
  if(!BuyerReceipt.owned(order,account)||!order.optString("ID").matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||!order.optString("PayIntentID").matches("npi_[a-f0-9]{48}"))throw new SecurityException("Original owned intent required");
  return "/orders/"+order.optString("ID")+"/native-pay-intent";
 }
 static void validate(JSONObject order,JSONObject result){
  if(!order.optString("ID").equals(result.optString("orderId"))||!order.optString("PayIntentID").equals(result.optString("originalOperation"))||!Boolean.TRUE.equals(result.opt("queryOnly"))||!Boolean.FALSE.equals(result.opt("fundsVerified"))||!result.optString("state").matches("PREPARED|ISSUED")||!result.optString("phase").matches("[A-Za-z0-9._:-]{1,96}"))throw new SecurityException("Original intent observation differs");
 }
 private NativeIntentObservation(){}
}
