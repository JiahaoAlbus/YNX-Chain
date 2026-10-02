package com.ynxweb4.shop;

import org.json.JSONObject;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public final class SecureStoreCommitTest {
    private static final String ACCOUNT="ynx1"+"q".repeat(38);
    static final class Preferences implements PrivacyLifecycle.Storage {
        final Map<String,String> memory=new HashMap<>(),disk=new HashMap<>();boolean fail;
        final SecureStore.StableValues stable=new SecureStore.StableValues(Map.of(),next->{memory.clear();memory.putAll(next);if(fail)return false;disk.clear();disk.putAll(next);return true;});
        public String get(String key){return stable.get(key);}
        public void put(String key,String value)throws Exception{stable.update(Map.of(key,value),Set.of());}
        public void putAll(Map<String,String> values)throws Exception{stable.update(values,Set.of());}
    }
    @Test public void failedPlanDoesNotExposeMemoryOnlySendingOrCarryItIntoAnotherCommit()throws Exception{
        Preferences preferences=new Preferences();PrivacyLifecycle lifecycle=new PrivacyLifecycle(preferences);lifecycle.begin(ACCOUNT);preferences.fail=true;
        assertThrows(IllegalStateException.class,()->lifecycle.plan(ACCOUNT));
        assertEquals(PrivacyLifecycle.SENDING,new JSONObject(preferences.memory.get(PrivacyLifecycle.RECORD)).getJSONObject(ACCOUNT).getString("phase"));
        assertEquals(PrivacyLifecycle.DRAINING,lifecycle.snapshot(ACCOUNT).getString("phase"));
        preferences.fail=false;preferences.put("foreign-account-record","preserved value");
        assertEquals(PrivacyLifecycle.DRAINING,new JSONObject(preferences.disk.get(PrivacyLifecycle.RECORD)).getJSONObject(ACCOUNT).getString("phase"));assertFalse(new JSONObject(preferences.disk.get(PrivacyLifecycle.RECORD)).getJSONObject(ACCOUNT).has("operation"));
        JSONObject retry=lifecycle.plan(ACCOUNT);assertNotNull(retry.getString("deletionRequestId"));assertEquals("preserved value",preferences.get("foreign-account-record"));
    }
    @Test public void failedRemoveAndMultiRecordWriteRemainUnacknowledgedAndAreNotPiggybacked()throws Exception{
        Preferences preferences=new Preferences();preferences.putAll(Map.of("commerce_session","active encrypted session","other-account","original evidence"));preferences.fail=true;
        assertThrows(IllegalStateException.class,()->preferences.stable.update(Map.of(),Set.of("commerce_session")));assertEquals("active encrypted session",preferences.get("commerce_session"));assertFalse(preferences.memory.containsKey("commerce_session"));
        assertThrows(IllegalStateException.class,()->preferences.putAll(Map.of("other-account","failed replacement","checkout","failed checkout")));assertEquals("original evidence",preferences.get("other-account"));assertEquals("",preferences.get("checkout"));
        preferences.fail=false;preferences.put("safe-write","new value");assertEquals("active encrypted session",preferences.disk.get("commerce_session"));assertEquals("original evidence",preferences.disk.get("other-account"));assertFalse(preferences.disk.containsKey("checkout"));
    }
}
