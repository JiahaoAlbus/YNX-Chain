package com.ynxweb4.shop;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

public class NativeInvoiceJourneyTest {
 static final String A="ynx1"+"q".repeat(38),B="ynx1"+"p".repeat(38),OP="npi_"+"ab".repeat(24);
 static final class Memory implements PayHandoffRecovery.Storage {final Map<String,String> rows=new HashMap<>();boolean fail;public String get(String key){return rows.getOrDefault(key,"");}public void put(String key,String value){if(fail)throw new IllegalStateException("PUBLIC storage failure");rows.put(key,value);}}
 static ProductSession session(String account)throws Exception{return ProductSession.parse(new JSONObject().put("account",account).put("token","t".repeat(43)).put("expiresAt",Instant.now().plusSeconds(3600).toString()).toString(),Instant.now());}
 static JSONObject order()throws Exception{return new JSONObject().put("ID","ord_native").put("Buyer",A).put("StoreID","store_original").put("Status","payment_pending").put("Currency","YNXT").put("TotalYNXT",8);}
 static JSONObject observation()throws Exception{return new JSONObject().put("orderId","ord_native").put("originalOperation",OP).put("state","PREPARED").put("phase","awaiting_merchant_approval").put("queryOnly",true).put("fundsVerified",false);}
 @Test public void coldUnknownUsesOnlyOriginalLookupAndPreservesReference()throws Exception{
  Memory store=new Memory();NativeInvoiceJourney.Record prepared=NativeInvoiceJourney.prepare(store,session(A),order());assertTrue(prepared.mayCreate());NativeInvoiceJourney.dispatched(store,prepared);
  NativeInvoiceJourney.Record cold=NativeInvoiceJourney.prepare(store,session(A),order());assertEquals(prepared.key,cold.key);assertFalse(cold.mayCreate());assertEquals("POST",cold.method());assertTrue(cold.path().endsWith("native-pay-intent-lookup"));
  assertThrows(IllegalStateException.class,()->NativeInvoiceJourney.dispatched(store,cold));
  NativeInvoiceJourney.Record retained=NativeInvoiceJourney.observed(store,cold,observation());assertEquals(OP,retained.operation);assertEquals(prepared.key,retained.key);assertFalse(retained.mayCreate());assertTrue(retained.path().endsWith("-lookup"));assertEquals(0,NativeInvoiceJourney.records(store,B).length());
  Map<String,String> before=new HashMap<>(store.rows);assertThrows(IllegalStateException.class,()->NativeInvoiceJourney.prepare(store,session(A),order().put("TotalYNXT",9)));assertEquals(before,store.rows);
 }
 @Test public void existingOriginalUsesReadOnlyGetAndNoLegacyOrForgedFunds()throws Exception{
  Memory store=new Memory();NativeInvoiceJourney.Record original=NativeInvoiceJourney.prepare(store,session(A),order().put("PayIntentID",OP));assertEquals("GET",original.method());assertFalse(original.lookupByKey);
  assertThrows(SecurityException.class,()->NativeInvoiceJourney.observed(store,original,observation().put("fundsVerified",true)));
  assertThrows(SecurityException.class,()->NativeInvoiceJourney.observed(store,original,observation().put("originalOperation","npi_"+"cd".repeat(24))));
  Memory legacy=new Memory();legacy.put(PayHandoffRecovery.namespace(A,"ord_native"),"PUBLIC original legacy evidence");Map<String,String> before=new HashMap<>(legacy.rows);assertThrows(IllegalStateException.class,()->NativeInvoiceJourney.prepare(legacy,session(A),order()));assertEquals(before,legacy.rows);
 }
 @Test public void storageFailureAndMalformedColdStateCannotRotateOrCreate()throws Exception{
  Memory store=new Memory();NativeInvoiceJourney.Record original=NativeInvoiceJourney.prepare(store,session(A),order());Map<String,String> before=new HashMap<>(store.rows);store.fail=true;assertThrows(IllegalStateException.class,()->NativeInvoiceJourney.dispatched(store,original));assertEquals(before,store.rows);store.fail=false;
  String namespace=store.rows.keySet().iterator().next();JSONObject invalid=new JSONObject(store.rows.get(namespace));invalid.getJSONObject("ord_native").put("phase","unknown").put("lookupByKey",false);store.rows.put(namespace,invalid.toString());before=new HashMap<>(store.rows);assertThrows(SecurityException.class,()->NativeInvoiceJourney.records(store,A));assertEquals(before,store.rows);
 }
}
