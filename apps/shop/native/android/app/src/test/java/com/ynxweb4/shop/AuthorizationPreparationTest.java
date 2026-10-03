package com.ynxweb4.shop;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;
public final class AuthorizationPreparationTest {
 @Test public void failedProofIsNotRecordedAsDispatched()throws Exception{
  PrivacyLifecycle lifecycle=new PrivacyLifecycle(new PrivacyLifecycleTest.Memory());
  PrivacyLifecycle.Ticket ticket=lifecycle.admit(PrivacyLifecycleTest.A,"PUT","/profile",new JSONObject());AtomicInteger sent=new AtomicInteger();
  assertThrows(IOException.class,()->ApiClient.executeTracked(lifecycle,ticket,()->true,new ApiClient.NetworkCall(){public void prepare()throws Exception{assertEquals("ADMITTED",lifecycle.snapshot(ticket.account).getJSONObject("requests").getJSONObject(ticket.id).getString("status"));throw new IOException("authority unavailable before business HTTP");}public ApiClient.Response send(){sent.incrementAndGet();return new ApiClient.Response(200,new JSONObject());}}));
  assertEquals(0,sent.get());assertEquals(0,lifecycle.snapshot(ticket.account).getJSONObject("requests").length());
 }
 @Test public void contextChangeDuringProofCannotDispatch()throws Exception{
  PrivacyLifecycle lifecycle=new PrivacyLifecycle(new PrivacyLifecycleTest.Memory());PrivacyLifecycle.Ticket ticket=lifecycle.admit(PrivacyLifecycleTest.A,"PUT","/profile",new JSONObject());AtomicBoolean current=new AtomicBoolean(true);AtomicInteger sent=new AtomicInteger();
  assertThrows(SecurityException.class,()->ApiClient.executeTracked(lifecycle,ticket,current::get,new ApiClient.NetworkCall(){public void prepare(){current.set(false);}public ApiClient.Response send(){sent.incrementAndGet();return new ApiClient.Response(200,new JSONObject());}}));
  assertEquals(0,sent.get());assertEquals(0,lifecycle.snapshot(ticket.account).getJSONObject("requests").length());
 }
 @Test public void preparedBusinessLossRetainsUnknownOutcome()throws Exception{
  PrivacyLifecycle lifecycle=new PrivacyLifecycle(new PrivacyLifecycleTest.Memory());PrivacyLifecycle.Ticket ticket=lifecycle.admit(PrivacyLifecycleTest.A,"PUT","/profile",new JSONObject());AtomicBoolean prepared=new AtomicBoolean();
  assertThrows(IOException.class,()->ApiClient.executeTracked(lifecycle,ticket,()->true,new ApiClient.NetworkCall(){public void prepare(){prepared.set(true);}public ApiClient.Response send()throws Exception{assertTrue(prepared.get());assertEquals("DISPATCHED",lifecycle.snapshot(ticket.account).getJSONObject("requests").getJSONObject(ticket.id).getString("status"));throw new IOException("lost business response");}}));
  assertEquals("UNKNOWN",lifecycle.snapshot(ticket.account).getJSONObject("requests").getJSONObject(ticket.id).getString("status"));
 }
}
