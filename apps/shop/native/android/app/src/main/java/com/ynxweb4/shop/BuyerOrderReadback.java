package com.ynxweb4.shop;
import org.json.JSONObject;
import java.util.Set;
final class BuyerOrderReadback {
 static void validate(JSONObject order,ProductSession session)throws Exception{
  if(session==null||!BuyerReceipt.owned(order,session.account)||!order.getString("ID").matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||!"YNXT".equals(order.getString("Currency"))||integer(order.get("TotalYNXT"))<=0)throw new SecurityException("Original owned order readback required");
  String state=order.getString("Status");
  if(Set.of("paid","shipped","delivered","reviewed","return_requested","return_approved","refund_requested","refunded").contains(state)){
   JSONObject receipt=order.getJSONObject("Settlement");
   if(!"paid".equals(receipt.getString("Status"))||!order.getString("InvoiceID").equals(receipt.getString("InvoiceID"))||!order.getString("PayIntentID").equals(receipt.getString("IntentID"))||!order.getString("PayMerchant").equals(receipt.getString("Merchant"))||!order.getString("PayPayoutAddress").equals(receipt.getString("PayoutAddress"))||!session.account.equals(receipt.getString("Payer"))||!"YNXT".equals(receipt.getString("Currency"))||integer(order.get("TotalYNXT"))!=integer(receipt.get("AmountYNXT"))||integer(receipt.get("BlockHeight"))<=0||!receipt.getString("TransactionHash").matches("0x[a-fA-F0-9]{64}"))throw new SecurityException("Original backend settlement receipt required");
  }
 }
 private static long integer(Object value){if(!(value instanceof Number))throw new SecurityException("Integer receipt required");return Long.parseLong(value.toString());}
}
