package com.ynxweb4.shop;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

// Product references only, held in the existing encrypted product store.
// No signing/capsule/approval or automatic create/send exists during restore.
final class NativeInvoiceJourney {
 static final class Record {
  final String account,orderID,key,digest,phase,operation;final boolean lookupByKey;
  Record(JSONObject v)throws Exception{account=v.getString("account");orderID=v.getString("orderId");key=v.getString("key");digest=v.getString("digest");phase=v.getString("phase");operation=v.optString("operation","");Object lookup=v.get("lookupByKey");if(!(lookup instanceof Boolean))throw new SecurityException("Original recovery mode required");lookupByKey=(Boolean)lookup;
   if(!orderID.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||!key.matches("[A-Za-z0-9._:-]{8,128}")||!digest.matches("[a-f0-9]{64}")||!phase.matches("prepared|unknown|reference")||(!phase.equals("reference")&&!lookupByKey)||(phase.equals("reference")?!operation.matches("npi_[a-f0-9]{48}"):!operation.isEmpty()))throw new SecurityException("Preserve malformed Native recovery evidence");}
  JSONObject json()throws Exception{JSONObject v=new JSONObject().put("account",account).put("orderId",orderID).put("key",key).put("digest",digest).put("phase",phase).put("lookupByKey",lookupByKey);if(!operation.isEmpty())v.put("operation",operation);return v;}
  JSONObject body()throws Exception{return new JSONObject().put("IdempotencyKey",key);}
  boolean mayCreate(){return phase.equals("prepared");}
  String method(){return phase.equals("reference")&&!lookupByKey?"GET":"POST";}
  String path(){return "/orders/"+orderID+"/native-pay-intent"+(!mayCreate()&&lookupByKey?"-lookup":"");}
 }
 private static String hash(String value)throws Exception{byte[] raw=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();for(byte n:raw)b.append(String.format(java.util.Locale.ROOT,"%02x",n&255));return b.toString();}
 private static String namespace(String account)throws Exception{return "native_invoice_journey_v1_"+hash(account);}
 static JSONObject records(PayHandoffRecovery.Storage store,String account)throws Exception{String raw=store.get(namespace(account));JSONObject rows=raw.isEmpty()?new JSONObject():new JSONObject(raw);for(String id:NativeInvoiceJourney.originalKeys(rows)){Record v=new Record(rows.getJSONObject(id));if(!v.account.equals(account)||!id.equals(v.orderID))throw new SecurityException("Foreign Native recovery namespace");}return rows;}
 private static void save(PayHandoffRecovery.Storage store,String account,JSONObject rows)throws Exception{String encoded=rows.toString();store.put(namespace(account),encoded);if(!encoded.equals(store.get(namespace(account))))throw new SecurityException("Native recovery storage outcome unconfirmed");}
 static Record prepare(PayHandoffRecovery.Storage store,ProductSession session,JSONObject order)throws Exception{synchronized(store){
  if(session==null||!BuyerReceipt.owned(order,session.account))throw new SecurityException("Original owned order required");String id=order.getString("ID"),digest=PayHandoffRecovery.orderDigest(order);JSONObject rows=records(store,session.account);
  if(rows.has(id)){Record old=new Record(rows.getJSONObject(id));if(!old.digest.equals(digest))throw new IllegalStateException("Original Native bill unresolved");return old;}
  if(!store.get(PayHandoffRecovery.namespace(session.account,id)).isEmpty())throw new IllegalStateException("Original legacy handoff unresolved");
  String operation=order.optString("PayIntentID");boolean reference=operation.matches("npi_[a-f0-9]{48}");if(!reference&&(!operation.isEmpty()||!order.optString("InvoiceID").isEmpty()||!order.optString("Status").equals("payment_pending")))throw new SecurityException("Native original selection required");
  JSONObject v=new JSONObject().put("account",session.account).put("orderId",id).put("digest",digest).put("key",UUID.randomUUID().toString()).put("phase",reference?"reference":"prepared").put("lookupByKey",!reference);if(reference)v.put("operation",operation);Record made=new Record(v);rows.put(id,made.json());save(store,session.account,rows);return made;
 }}
 static void dispatched(PayHandoffRecovery.Storage store,Record original)throws Exception{synchronized(store){JSONObject rows=records(store,original.account);Record old=new Record(rows.getJSONObject(original.orderID));if(!old.mayCreate()||!NativeProductState.canonical(old.json()).equals(NativeProductState.canonical(original.json())))throw new IllegalStateException("Original Native creation already attempted");JSONObject v=old.json().put("phase","unknown");rows.put(old.orderID,v);save(store,old.account,rows);}}
 static Record observed(PayHandoffRecovery.Storage store,Record original,JSONObject result)throws Exception{synchronized(store){JSONObject rows=records(store,original.account);Record old=new Record(rows.getJSONObject(original.orderID));String operation=result.optString("originalOperation");
  if(!old.key.equals(original.key)||!old.digest.equals(original.digest)||!operation.matches("npi_[a-f0-9]{48}")||!old.operation.isEmpty()&&!old.operation.equals(operation))throw new SecurityException("Original Native intent changed");
  NativeIntentObservation.validate(new JSONObject().put("ID",original.orderID).put("PayIntentID",operation),new JSONObject(result.toString()).put("queryOnly",true));
  if(!(result.opt("queryOnly") instanceof Boolean)||!original.mayCreate()&&!Boolean.TRUE.equals(result.opt("queryOnly")))throw new SecurityException("Original query-only recovery required");
  Record retained=new Record(old.json().put("phase","reference").put("operation",operation));rows.put(old.orderID,retained.json());save(store,old.account,rows);return retained;
 }}
 static java.util.List<String> originalKeys(JSONObject object){java.util.ArrayList<String> values=new java.util.ArrayList<>();java.util.Iterator<String> keys=object.keys();while(keys.hasNext())values.add(keys.next());java.util.Collections.sort(values);return values;}
 private NativeInvoiceJourney(){}
}
