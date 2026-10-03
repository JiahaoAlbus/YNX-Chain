package com.ynxweb4.shop;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore implements OfflineMutationQueue.Storage, PrivacyLifecycle.Storage {
    private static final String ALIAS = "ynx_shop_secure_store_v1";
    private final SharedPreferences prefs;
    private final StableValues values;
    private static SecureStore shared;
    private PrivacyLifecycle privacy;
    private final SessionRevocation sessionRevocation=new SessionRevocation();

    static synchronized SecureStore open(Context context){if(shared==null)shared=new SecureStore(context.getApplicationContext());return shared;}
    private SecureStore(Context context) {
        prefs = context.getSharedPreferences("secure", Context.MODE_PRIVATE);
        Map<String,String> initial=new HashMap<>();for(Map.Entry<String,?> entry:prefs.getAll().entrySet())if(entry.getValue() instanceof String)initial.put(entry.getKey(),(String)entry.getValue());
        values=new StableValues(initial,next->{
            SharedPreferences.Editor editor=prefs.edit();
            // Preserve unknown non-string metadata as well as every captured
            // account record. Remove only strings absent from this confirmed
            // snapshot (explicit removals or an earlier failed memory write).
            for(Map.Entry<String,?> entry:prefs.getAll().entrySet())if(entry.getValue() instanceof String&&!next.containsKey(entry.getKey()))editor.remove(entry.getKey());
            for(Map.Entry<String,String> entry:next.entrySet())editor.putString(entry.getKey(),entry.getValue());return editor.commit();
        });
    }
    synchronized PrivacyLifecycle privacy()throws Exception{if(privacy==null)privacy=new PrivacyLifecycle(this);return privacy;}

    public synchronized void put(String key, String value) throws Exception {
        putAll(java.util.Map.of(key,value));
    }

    public synchronized void putAll(Map<String,String> values) throws Exception {
        Map<String,String> encrypted=new HashMap<>();for(Map.Entry<String,String> entry:values.entrySet())encrypted.put(entry.getKey(),encrypt(entry.getValue()));
        this.values.update(encrypted,Set.of());
    }
    private String encrypt(String value)throws Exception{
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
    }

    public synchronized String get(String key) throws Exception {
        String raw=readUnfiltered(key);
        if(key.equals("commerce_session")&&!sessionRevocation.allows(raw,java.time.Instant.now()))return "";
        return raw;
    }
    synchronized void rejectSession(ProductSession expected)throws Exception{
        sessionRevocation.reject(expected,new SessionRevocation.Storage(){
            public String read()throws Exception{return readUnfiltered("commerce_session");}
            public void remove()throws Exception{SecureStore.this.remove("commerce_session");}
        },java.time.Instant.now());
    }
    private String readUnfiltered(String key)throws Exception {
        String encoded = values.get(key);
        if (encoded == null || encoded.isEmpty()) return "";
        String[] pieces = encoded.split("\\.", 2);
        if (pieces.length != 2) throw new SecurityException("secure storage record is malformed");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    synchronized void remove(String key)throws Exception{values.update(Map.of(),Set.of(key));}

    // SharedPreferences.commit can change its memory map before returning false.
    // Expose only acknowledged snapshots and never carry a failed write into an
    // unrelated later commit. This preferences file is exclusively product data.
    static final class StableValues {
        interface Commit { boolean save(Map<String,String> values)throws Exception; }
        private Map<String,String> confirmed;private final Commit backend;
        StableValues(Map<String,String> initial,Commit backend){confirmed=new HashMap<>(initial);this.backend=backend;}
        synchronized String get(String key){return confirmed.getOrDefault(key,"");}
        synchronized void update(Map<String,String> updates,Set<String> removals)throws Exception{
            Map<String,String> next=new HashMap<>(confirmed);next.putAll(updates);for(String key:removals)next.remove(key);
            if(!backend.save(new HashMap<>(next)))throw new IllegalStateException("secure storage write failed");confirmed=next;
        }
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
    }
}
