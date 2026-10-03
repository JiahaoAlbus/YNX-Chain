package com.ynxweb4.shop;

import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

// Shared by every SecureStore session reader. A failed credential removal must
// still fail closed in this process; unrelated account recovery data is retained.
final class SessionRevocation {
    interface Storage { String read() throws Exception; void remove() throws Exception; }
    private final Set<String> rejected=new HashSet<>();
    private String fingerprint(ProductSession session)throws Exception{
        byte[] bytes=(session.account+"\n"+session.token+"\n"+session.expiresAt).getBytes(StandardCharsets.UTF_8);
        return java.util.Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    synchronized boolean allows(String raw,Instant now)throws Exception{
        ProductSession current=ProductSession.parse(raw,now);return current==null||!rejected.contains(fingerprint(current));
    }
    synchronized void reject(ProductSession expected,Storage storage,Instant now)throws Exception{
        if(expected==null)return;
        rejected.add(fingerprint(expected));
        ProductSession actual=ProductSession.parse(storage.read(),now);
        if(expected.same(actual))storage.remove();
    }
}
