package com.ynxweb4.shop;
import org.json.JSONObject;
import org.junit.Test;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

// Actual request sequencing and original journals, with controlled memory and
// HTTP results. This does not claim Activity, device, signer or Wallet acceptance.
public final class InvoicePresentationTest {
 @Test public void backgroundDuringProofPreservesPreparedKeyAndExplicitRetrySendsOnce()throws Exception{
  BuyerJourneyTest.Memory store=new BuyerJourneyTest.Memory();ProductSession session=BuyerJourneyTest.session("a".repeat(64));PrivacyLifecycle lifecycle=new PrivacyLifecycle(store);
  BuyerPaymentReview.Pending original=BuyerPaymentReview.prepare(store,session,BuyerJourneyTest.order());String bytes=store.get(original.original.namespace+"_review_v2");
  PrivacyLifecycle.Ticket ticket=lifecycle.admit(session.account,"POST","/orders/ord_original/pay-handoff",original.original.body());AtomicBoolean visible=new AtomicBoolean(true);AtomicInteger sends=new AtomicInteger();
  assertThrows(SecurityException.class,()->ApiClient.executeTracked(lifecycle,ticket,visible::get,new ApiClient.NetworkCall(){public void prepare(){visible.set(false);}public void admitDispatch()throws Exception{BuyerPaymentReview.markDispatched(store,session,original);}public ApiClient.Response send()throws Exception{sends.incrementAndGet();return new ApiClient.Response(200,BuyerJourneyTest.invoice());}}));
  assertEquals(bytes,store.get(original.original.namespace+"_review_v2"));assertEquals(0,sends.get());assertEquals(0,lifecycle.snapshot(session.account).getJSONObject("requests").length());
  BuyerPaymentReview.Pending retry=BuyerPaymentReview.prepare(store,session,BuyerJourneyTest.order());assertEquals(original.original.key,retry.original.key);assertTrue(retry.mayCreate());visible.set(true);
  PrivacyLifecycle.Ticket next=lifecycle.admit(session.account,"POST","/orders/ord_original/pay-handoff",retry.original.body());JSONObject response=ApiClient.executeTracked(lifecycle,next,visible::get,new ApiClient.NetworkCall(){public void admitDispatch()throws Exception{BuyerPaymentReview.markDispatched(store,session,retry);}public ApiClient.Response send()throws Exception{sends.incrementAndGet();return new ApiClient.Response(200,BuyerJourneyTest.invoice());}});
  assertEquals("ynxpay://invoice/inv_original",BuyerPaymentReview.received(store,session,retry,response));assertEquals(1,sends.get());assertEquals(original.original.key,BuyerPaymentReview.restore(store,session).original.key);
 }
 @Test public void backgroundAfterDispatchKeepsUnknownAndOriginalReceiptOnlyReadsBack()throws Exception{
  BuyerJourneyTest.Memory store=new BuyerJourneyTest.Memory();ProductSession session=BuyerJourneyTest.session("a".repeat(64));PrivacyLifecycle lifecycle=new PrivacyLifecycle(store);BuyerPaymentReview.Pending original=BuyerPaymentReview.prepare(store,session,BuyerJourneyTest.order());
  AtomicBoolean visible=new AtomicBoolean(true);AtomicInteger sends=new AtomicInteger(),observations=new AtomicInteger();PrivacyLifecycle.Ticket ticket=lifecycle.admit(session.account,"POST","/orders/ord_original/pay-handoff",original.original.body());
  assertThrows(SecurityException.class,()->ApiClient.executeTracked(lifecycle,ticket,visible::get,new ApiClient.NetworkCall(){public void admitDispatch()throws Exception{BuyerPaymentReview.markDispatched(store,session,original);}public ApiClient.Response send()throws Exception{sends.incrementAndGet();visible.set(false);return new ApiClient.Response(200,BuyerJourneyTest.invoice());}},response->observations.incrementAndGet()));
  BuyerPaymentReview.Pending cold=BuyerPaymentReview.restore(store,session);assertEquals("unknown",cold.phase);assertEquals(original.original.key,cold.original.key);assertFalse(cold.mayCreate());assertEquals(1,observations.get());
  visible.set(true);JSONObject response=ApiClient.executeTracked(lifecycle,null,visible::get,new ApiClient.NetworkCall(){public ApiClient.Response send()throws Exception{return new ApiClient.Response(200,BuyerJourneyTest.invoice());}});
  assertEquals("ynxpay://invoice/inv_original",BuyerPaymentReview.received(store,session,cold,response));assertEquals(1,sends.get());assertEquals(original.original.key,BuyerPaymentReview.restore(store,session).original.key);
 }
 @Test public void backgroundDuringUnknownReadProofCannotSendOrAdvanceJournal()throws Exception{
  BuyerJourneyTest.Memory store=new BuyerJourneyTest.Memory();ProductSession session=BuyerJourneyTest.session("a".repeat(64));PrivacyLifecycle lifecycle=new PrivacyLifecycle(store);BuyerPaymentReview.Pending original=BuyerPaymentReview.prepare(store,session,BuyerJourneyTest.order());BuyerPaymentReview.markDispatched(store,session,original);String bytes=store.get(original.original.namespace+"_review_v2");AtomicBoolean visible=new AtomicBoolean(true);AtomicInteger sends=new AtomicInteger();
  assertThrows(SecurityException.class,()->ApiClient.executeTracked(lifecycle,null,visible::get,new ApiClient.NetworkCall(){public void prepare(){visible.set(false);}public ApiClient.Response send()throws Exception{sends.incrementAndGet();return new ApiClient.Response(200,BuyerJourneyTest.invoice());}}));
  assertEquals(0,sends.get());assertEquals(bytes,store.get(original.original.namespace+"_review_v2"));assertEquals("unknown",BuyerPaymentReview.restore(store,session).phase);
 }
}
