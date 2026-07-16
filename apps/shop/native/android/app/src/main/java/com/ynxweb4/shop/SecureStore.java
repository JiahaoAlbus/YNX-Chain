package com.ynxweb4.shop;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static final String ALIAS = "ynx_shop_secure_store_v1";
    private final SharedPreferences prefs;

    SecureStore(Context context) {
        prefs = context.getSharedPreferences("secure", Context.MODE_PRIVATE);
    }

    synchronized void put(String key, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
        if (!prefs.edit().putString(key, encoded).commit()) throw new IllegalStateException("secure storage write failed");
    }

    synchronized String get(String key) throws Exception {
        String encoded = prefs.getString(key, "");
        if (encoded == null || encoded.isEmpty()) return "";
        String[] pieces = encoded.split("\\.", 2);
        if (pieces.length != 2) throw new SecurityException("secure storage record is malformed");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    synchronized void remove(String key) { prefs.edit().remove(key).apply(); }

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
