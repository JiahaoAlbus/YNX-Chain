package com.ynxweb4.shop;
import org.json.JSONObject;
import java.time.Instant;
import java.net.URI;

// A product reference journal inside the original encrypted SecureStore. No
// authority, account/vault, signing/payment protocol or offline dispatch queue.
final class BuyerPaymentReview {
 static final class Pending {final PayHandoffRecovery.Prepared original;final String phase;Pending(PayHandoffRecovery.Prepared original,String phase){this.original=original;this.phase=phase;}boolean mayCreate(){return "prepared".equals(phase)&&original.order.optString("InvoiceID").isEmpty();}}
 private static String pointer(String account){return "pay_review_current_v2_"+account;}
 private static String key(PayHandoffRecovery.Prepared original){return original.namespace+"_review_v2";}
 private static void current(ProductSession session){if(session==null||!session.nativeV2||!session.expiresAt.isAfter(Instant.now()))throw new SecurityException("Current verified Native buyer required");}
 static Pending prepare(PayHandoffRecovery.Storage store,ProductSession session,JSONObject order)throws Exception{
  current(session);synchronized(store){boolean legacyPending=!store.get(PayHandoffRecovery.namespace(session.account,order.getString("ID"))).isEmpty();PayHandoffRecovery.Prepared original=PayHandoffRecovery.prepare(store,session,order);String raw=store.get(key(original));
   if(raw.isEmpty()){ // Presence of the old handoff key cannot prove it was unsent.

    JSONObject record=new JSONObject().put("order",original.order).put("key",original.key).put("digest",original.digest).put("phase",legacyPending?"unknown":"prepared");save(store,key(original),record);raw=record.toString();
   }
   JSONObject record=new JSONObject(raw);if(!original.key.equals(record.getString("key"))||!original.digest.equals(record.getString("digest")))throw new SecurityException("Original payment reference changed");savePointer(store,session.account,order.getString("ID"));checkPhase(record);return new Pending(original,record.getString("phase"));
  }
 }
 static Pending restore(PayHandoffRecovery.Storage store,ProductSession session)throws Exception{
  current(session);synchronized(store){String id=store.get(pointer(session.account));if(id.isEmpty())return null;if(!id.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"))throw new SecurityException("Original order reference invalid");
   // Locate only the original account/order journal; do not enumerate another account.
   String namespace=PayHandoffRecovery.namespace(session.account,id);JSONObject record=new JSONObject(store.get(namespace+"_review_v2"));JSONObject order=record.getJSONObject("order");if(!id.equals(order.getString("ID"))||!BuyerReceipt.owned(order,session.account)||!record.getString("digest").equals(PayHandoffRecovery.orderDigest(order)))throw new SecurityException("Original review reference changed");
   JSONObject intent=new JSONObject(store.get(namespace));if(!record.getString("key").equals(intent.getString("key"))||!record.getString("digest").equals(intent.getString("digest")))throw new SecurityException("Original handoff evidence missing");checkPhase(record);return new Pending(new PayHandoffRecovery.Prepared(namespace,intent.getString("key"),intent.getString("digest"),order),record.getString("phase"));
  }
 }
 static void markDispatched(PayHandoffRecovery.Storage store,ProductSession session,Pending pending)throws Exception{current(session);synchronized(store){JSONObject record=record(store,pending);if(!pending.mayCreate()||!"prepared".equals(record.getString("phase")))throw new SecurityException("Unknown invoice may only be read back");record.put("phase","unknown");save(store,key(pending.original),record);}}
 static String received(PayHandoffRecovery.Storage store,ProductSession session,Pending pending,JSONObject response)throws Exception{current(session);String link=PayHandoffRecovery.validatedLink(pending.original,response);if(!response.getString("intentId").equals(response.getJSONObject("order").getString("PayIntentID"))||!BuyerReceipt.owned(response.getJSONObject("order"),session.account))throw new SecurityException("Foreign invoice receipt");synchronized(store){JSONObject record=record(store,pending);record.put("phase","invoice_ready").put("invoiceId",response.getString("invoiceId")).put("intentId",response.getString("intentId")).put("deepLink",link);save(store,key(pending.original),record);return link;}}
 static void opened(PayHandoffRecovery.Storage store,ProductSession session,Pending pending)throws Exception{current(session);synchronized(store){JSONObject record=record(store,pending);if(!record.has("invoiceId")||!"invoice_ready".equals(record.getString("phase")))throw new SecurityException("Original current invoice required");record.put("phase","wallet_opened");save(store,key(pending.original),record);}}
 static void observed(PayHandoffRecovery.Storage store,ProductSession session,Pending pending,JSONObject order)throws Exception{current(session);if(!BuyerReceipt.owned(order,session.account)||!pending.original.digest.equals(PayHandoffRecovery.orderDigest(order)))throw new SecurityException("Foreign original-order readback");synchronized(store){JSONObject record=record(store,pending);if(record.has("invoiceId")&&(!record.getString("invoiceId").equals(order.optString("InvoiceID"))||!record.getString("intentId").equals(order.optString("PayIntentID"))))throw new SecurityException("Payment readback changed invoice");record.put("observedOrder",new JSONObject(order.toString()));save(store,key(pending.original),record);}}
 static boolean callbackHint(String raw)throws Exception{URI uri=new URI(raw);return "ynxshop://orders".equals(uri.toString())&&uri.getRawQuery()==null&&uri.getFragment()==null;}
 private static void checkPhase(JSONObject record)throws Exception{if(!java.util.Set.of("prepared","unknown","invoice_ready","wallet_opened").contains(record.getString("phase")))throw new SecurityException("Unknown original review state");}
 private static JSONObject record(PayHandoffRecovery.Storage store,Pending pending)throws Exception{JSONObject record=new JSONObject(store.get(key(pending.original)));checkPhase(record);if(!pending.original.key.equals(record.getString("key"))||!pending.original.digest.equals(record.getString("digest")))throw new SecurityException("Original invoice operation changed");return record;}
 private static void save(PayHandoffRecovery.Storage store,String key,JSONObject record)throws Exception{String wire=record.toString();store.put(key,wire);if(!wire.equals(store.get(key)))throw new SecurityException("Payment reference write/readback failed");}
 private static void savePointer(PayHandoffRecovery.Storage store,String account,String id)throws Exception{store.put(pointer(account),id);if(!id.equals(store.get(pointer(account))))throw new SecurityException("Current order reference write/readback failed");}
}
