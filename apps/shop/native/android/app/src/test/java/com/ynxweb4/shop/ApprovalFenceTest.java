package com.ynxweb4.shop;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

public final class ApprovalFenceTest {
    @Test public void logoutBeforeLateApprovalNeverRestoresSession() throws Exception {
        ApprovalFence fence = new ApprovalFence();
        AtomicReference<String> session = new AtomicReference<>("old-account");
        AtomicReference<Throwable> failure = new AtomicReference<>();
        long pending = fence.begin();
        CountDownLatch networkReturned = new CountDownLatch(1);
        Thread late = new Thread(() -> {
            try { networkReturned.await(); fence.commit(pending, () -> session.set("late-account")); fail("late approval admitted"); }
            catch (SecurityException expected) { }
            catch (Throwable error) { failure.set(error); }
        });
        late.start();
        fence.invalidateAndWrite(() -> session.set(null));
        networkReturned.countDown(); late.join();
        assertNull(failure.get()); assertNull(session.get());
    }
    @Test public void replacementAndDuplicateApprovalCannotOverwriteAcceptedAccount() throws Exception {
        ApprovalFence fence = new ApprovalFence(); AtomicReference<String> session = new AtomicReference<>();
        long first = fence.begin(), replacement = fence.begin();
        try { fence.commit(first, () -> session.set("first")); fail("old request accepted"); } catch (SecurityException expected) { }
        fence.commit(replacement, () -> session.set("replacement"));
        try { fence.commit(replacement, () -> session.set("duplicate")); fail("duplicate accepted"); } catch (SecurityException expected) { }
        assertEquals("replacement", session.get());
    }
}
