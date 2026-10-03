package com.ynxweb4.shop;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class AIPresentationTest {
    @Test public void newAttemptNavigationAndOldDismissalCannotResurrectPresentation(){AIPresentation state=new AIPresentation();long a=state.begin(),b=state.begin();assertFalse(state.current(a));state.cancel(a);assertTrue(state.current(b));state.clear();assertFalse(state.current(b));long c=state.begin();state.cancel(c);assertFalse(state.current(c));}
    @Test public void cancelledAdmissionDoesNotRunAndDispatchedOutcomeStillRecords()throws Exception{
        PrivacyLifecycleTest.Memory storage=new PrivacyLifecycleTest.Memory();PrivacyLifecycle lifecycle=new PrivacyLifecycle(storage);AIPresentation state=new AIPresentation();long a=state.begin();PrivacyLifecycle.Ticket cancelled=lifecycle.admit(PrivacyLifecycleTest.A,"POST","/ai/jobs",new JSONObject().put("IdempotencyKey","ai-cancelled-intent"));state.clear();AtomicInteger sent=new AtomicInteger();
        assertThrows(SecurityException.class,()->ApiClient.executeTracked(lifecycle,cancelled,()->state.current(a),()->{sent.incrementAndGet();return new ApiClient.Response(200,new JSONObject());}));assertEquals(0,sent.get());assertEquals(0,lifecycle.snapshot(PrivacyLifecycleTest.A).getJSONObject("requests").length());
        long b=state.begin();PrivacyLifecycle.Ticket dispatched=lifecycle.admit(PrivacyLifecycleTest.A,"POST","/ai/jobs/job/run",new JSONObject());
        assertThrows(SecurityException.class,()->ApiClient.executeTracked(lifecycle,dispatched,()->state.current(b),()->{state.clear();sent.incrementAndGet();return new ApiClient.Response(200,new JSONObject());}));assertEquals(1,sent.get());assertEquals(0,lifecycle.snapshot(PrivacyLifecycleTest.A).getJSONObject("requests").length());
    }
}
