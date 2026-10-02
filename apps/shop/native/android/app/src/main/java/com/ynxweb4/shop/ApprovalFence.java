package com.ynxweb4.shop;

// An approval may return after sign-out or a replacement approval. Its durable
// session write must be atomic with respect to those local user decisions.
final class ApprovalFence {
    interface Write { void run() throws Exception; }
    private long revision;
    synchronized long begin() { return ++revision; }
    synchronized long capture() { return revision; }
    synchronized boolean current(long expected) { return revision == expected; }
    synchronized void invalidate() { revision++; }
    synchronized void commit(long expected, Write write) throws Exception {
        if (!current(expected)) throw new SecurityException("Shop approval was cancelled or replaced");
        write.run();
        revision++;
    }
    synchronized void invalidateAndWrite(Write write) throws Exception {
        revision++;
        write.run();
    }
}
