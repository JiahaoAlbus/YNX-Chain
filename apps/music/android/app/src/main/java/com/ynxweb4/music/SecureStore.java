package com.ynxweb4.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

final class SecureStore {
    private static final String ALIAS="ynx_music_session_aes_v1";
    private static SessionCustody custody(Context context) {
        SharedPreferences preferences=context.getSharedPreferences("secure",Context.MODE_PRIVATE);
        return new SessionCustody(new SessionCustody.Record() {
            public String read() { return preferences.getString("sessionBinding",null); }
            public boolean write(String raw) { return preferences.edit().putString("sessionBinding",raw).commit(); }
            public boolean remove() { return preferences.edit().remove("sessionBinding").commit(); }
        },new SessionCustody.Keys() {
            public SecretKey existing() throws Exception {
                KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
                if(!store.containsAlias(ALIAS)) return null;
                SecretKey key=(SecretKey)store.getKey(ALIAS,null);
                if(key==null) throw new IllegalStateException("Existing Music storage key is unavailable");
                return key;
            }
            public SecretKey create() throws Exception {
                // Called only after proving there is no inherited encrypted record.
                SecretKey existing=existing();if(existing!=null)return existing;
                KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
                return generator.generateKey();
            }
        });
    }
    static synchronized void put(Context context,String value) { custody(context).write(value); }
    static synchronized String get(Context context) { return custody(context).read(); }
    static synchronized void clear(Context context) { custody(context).clear(); }
    static boolean hasSavedRecord(Context context) { return context.getSharedPreferences("secure",Context.MODE_PRIVATE).contains("sessionBinding"); }
}
