package com.ynxweb4.shop;

import org.json.JSONObject;

// Read-only DATA from the original Pay intent, never a funds acknowledgement.
final class NativeIntentObservation {
 static boolean pendingHistory(JSONObject payment) {
  org.json.JSONArray pending=payment.optJSONArray("PendingOriginals");
  return payment.optBoolean("ReconciliationRequired",true) || !payment.optBoolean("CompleteKnownOriginals",false) || (pending!=null && pending.length()>0);
 }
 static boolean isNative(JSONObject order){return order.optString("PayIntentID").startsWith("npi_");}
 static String path(JSONObject order,String account){
  if(!BuyerReceipt.owned(order,account)||!order.optString("ID").matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||!order.optString("PayIntentID").matches("npi_[a-f0-9]{48}"))throw new SecurityException("Original owned intent required");
  return "/orders/"+order.optString("ID")+"/native-pay-intent";
 }
 static String confirmationPath(JSONObject order,String account){
  path(order,account);
  return "/orders/"+order.optString("ID")+"/confirm-payment";
 }
 // Display consistency only; normal Shop server owns cryptographic verification.
 static void validatePayment(JSONObject order)throws Exception{
  if(!order.optString("PayIntentID").matches("npi_[a-f0-9]{48}"))throw new SecurityException("Original Native intent required");
  JSONObject p=order.getJSONObject("NativePayment");
  java.math.BigInteger principal=atoms(p.getString("PrincipalAtoms")),paid=atoms(p.getString("PaidAtoms")),refunded=atoms(p.getString("RefundedAtoms")),net=atoms(p.getString("NetPaidAtoms"));
  if(p.getBoolean("ReconciliationRequired")||!p.getString("InvoiceID").equals(order.getString("InvoiceID"))||p.getString("SessionID").isEmpty()||!p.getString("TermsHash").matches("[a-f0-9]{64}")||!p.getString("SettlementNativeHash").matches("0x[a-f0-9]{64}")||principal.signum()<=0||!paid.equals(principal)||refunded.compareTo(paid)>0||!net.equals(paid.subtract(refunded)))throw new SecurityException("Original Native payment differs");
  org.json.JSONArray receipts=p.getJSONArray("Receipts");int settlements=0;
  for(int i=0;i<receipts.length();i++){
   JSONObject r=receipts.getJSONObject(i);
   if(!"shop.order".equals(r.getString("productId"))||!order.getString("StoreID").equals(r.getString("storeId"))||!order.getString("ID").equals(r.getString("sourceOrder"))||!order.getString("PayMerchant").equals(r.getString("merchant"))||!p.getString("InvoiceID").equals(r.getString("invoiceId"))||!p.getString("SessionID").equals(r.getString("sessionId"))||!p.getString("TermsHash").equals(r.getString("termsHash"))||!p.getString("SettlementNativeHash").equals(r.getString("settlementNativeHash")))throw new SecurityException("Rebound Native payment");
   if("invoice_settle".equals(r.getString("kind"))&&"confirmed".equals(r.getString("status"))){
    if(!p.getString("SettlementNativeHash").equals(r.getString("nativeHash"))||!sameHexBuyer(order.getString("Buyer"),r.getString("payer"))||!order.getString("PayPayoutAddress").equals(r.getString("recipient")))throw new SecurityException("Settlement party differs");settlements++;
   }
  }
  if(settlements!=1)throw new SecurityException("Original settlement required");
 }
 private static boolean sameHexBuyer(String a,String b){return a.equals(b)||(a.matches("0x[a-fA-F0-9]{40}")&&b.matches("0x[a-fA-F0-9]{40}")&&a.equalsIgnoreCase(b));}
 private static java.math.BigInteger atoms(String value){
  if(!value.matches("0|[1-9][0-9]{0,19}"))throw new SecurityException("Exact atoms required");
  java.math.BigInteger n=new java.math.BigInteger(value);if(n.bitLength()>64)throw new SecurityException("Atoms overflow");return n;
 }
 static void validate(JSONObject order,JSONObject result){
  if(!order.optString("ID").equals(result.optString("orderId"))||!order.optString("PayIntentID").equals(result.optString("originalOperation"))||!Boolean.TRUE.equals(result.opt("queryOnly"))||!Boolean.FALSE.equals(result.opt("fundsVerified"))||!result.optString("state").matches("PREPARED|ISSUED")||!result.optString("phase").matches("[A-Za-z0-9._:-]{1,96}"))throw new SecurityException("Original intent observation differs");
 }
 private NativeIntentObservation(){}
}
