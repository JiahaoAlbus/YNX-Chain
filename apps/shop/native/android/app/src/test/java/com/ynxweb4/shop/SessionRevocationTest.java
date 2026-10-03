package com.ynxweb4.shop;
import java.time.Instant;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class SessionRevocationTest {
    private String record(String suffix)throws Exception{return new JSONObject().put("account","ynx1"+"q".repeat(38)).put("token","opaque-shop-product-token-"+suffix).put("expiresAt",Instant.now().plusSeconds(240).toString()).toString();}
    static final class Memory implements SessionRevocation.Storage {
        String raw;boolean fail;int removed;
        public String read(){return raw;}
        public void remove()throws Exception{removed++;if(fail)throw new IOException("commit failed");raw="";}
    }
    @Test public void oldRejectionDoesNotRemoveNewSessionAndFailedRemovalStillBlocksReaders()throws Exception{
        SessionRevocation revocation=new SessionRevocation();Memory store=new Memory();String old=record("old"),replacement=record("new");ProductSession expected=ProductSession.parse(old,Instant.now());store.raw=replacement;
        revocation.reject(expected,store,Instant.now());assertEquals(0,store.removed);assertTrue(revocation.allows(replacement,Instant.now()));assertFalse(revocation.allows(old,Instant.now()));
        store.raw=replacement;store.fail=true;ProductSession fresh=ProductSession.parse(replacement,Instant.now());assertThrows(IOException.class,()->revocation.reject(fresh,store,Instant.now()));assertEquals(replacement,store.raw);assertFalse(revocation.allows(store.raw,Instant.now()));
    }
    @Test public void onlyPrivateAuthoritative401RejectsCredentials()throws Exception{
        ProductSession session=ProductSession.parse(record("one"),Instant.now());
        for(String path:new String[]{"/orders","/cart","/profile","/ai/jobs/a/run","/privacy/delete"})assertTrue(ApiClient.rejectsSession("POST",path,session,401));
        assertFalse(ApiClient.rejectsSession("GET","/products",session,401));assertFalse(ApiClient.rejectsSession("GET","/stores/one",session,401));assertFalse(ApiClient.rejectsSession("POST","/auth/gateway/sessions",session,401));assertFalse(ApiClient.rejectsSession("GET","/orders",session,403));assertFalse(ApiClient.rejectsSession("GET","/orders",null,401));
    }
    @Test public void rejectionRecordsWriteOutcomeAndStopsAnAlreadyDispatchedLateRead()throws Exception{
        SessionRevocation revocation=new SessionRevocation();Memory store=new Memory();store.raw=record("live");ProductSession expected=ProductSession.parse(store.raw,Instant.now());PrivacyLifecycleTest.Memory journal=new PrivacyLifecycleTest.Memory();PrivacyLifecycle lifecycle=new PrivacyLifecycle(journal);
        PrivacyLifecycle.Ticket ticket=lifecycle.admit(expected.account,"PUT","/profile",new JSONObject());CountDownLatch readSent=new CountDownLatch(1),release=new CountDownLatch(1);ExecutorService worker=Executors.newSingleThreadExecutor();
        try{
            Future<?> late=worker.submit(()->{try{ApiClient.executeTracked(lifecycle,null,()->revocation.allows(store.raw,Instant.now())&&!store.raw.isEmpty(),()->{readSent.countDown();assertTrue(release.await(2,TimeUnit.SECONDS));return new ApiClient.Response(200,new JSONObject().put("private","old"));});fail("late private read escaped");}catch(SecurityException expectedFailure){}catch(Exception error){throw new RuntimeException(error);}});
            assertTrue(readSent.await(2,TimeUnit.SECONDS));assertThrows(SecurityException.class,()->ApiClient.executeTracked(lifecycle,ticket,()->!store.raw.isEmpty(),()->new ApiClient.Response(401,new JSONObject()),response->{assertEquals(0,lifecycle.snapshot(expected.account).getJSONObject("requests").length());revocation.reject(expected,store,Instant.now());}));
            release.countDown();late.get(2,TimeUnit.SECONDS);assertEquals("",store.raw);
        }finally{release.countDown();worker.shutdownNow();}
    }
    @Test public void rejectionStillRunsWhenJournalCommitFails()throws Exception{
        PrivacyLifecycleTest.Memory journal=new PrivacyLifecycleTest.Memory();PrivacyLifecycle lifecycle=new PrivacyLifecycle(journal);PrivacyLifecycle.Ticket ticket=lifecycle.admit(PrivacyLifecycleTest.A,"PUT","/cart",new JSONObject());AtomicInteger rejected=new AtomicInteger();
        assertThrows(Exception.class,()->ApiClient.executeTracked(lifecycle,ticket,()->true,()->{journal.failBatch=true;return new ApiClient.Response(401,new JSONObject());},response->rejected.incrementAndGet()));assertEquals(1,rejected.get());
    }
}
