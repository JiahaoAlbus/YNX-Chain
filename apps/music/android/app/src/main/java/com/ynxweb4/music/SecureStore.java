package com.ynxweb4.music;

import android.content.Context;
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
    private static final String ALIAS = "ynx_music_session_aes_v1";
    static void put(Context c, String value) throws Exception { Cipher x=Cipher.getInstance("AES/GCM/NoPadding");x.init(Cipher.ENCRYPT_MODE,key());byte[] data=x.doFinal(value.getBytes(StandardCharsets.UTF_8));c.getSharedPreferences("secure",0).edit().putString("token",Base64.encodeToString(x.getIV(),Base64.NO_WRAP)+"."+Base64.encodeToString(data,Base64.NO_WRAP)).apply(); }
    static String get(Context c) { try {String raw=c.getSharedPreferences("secure",0).getString("token","");if(raw.isEmpty())return "";String[] p=raw.split("\\.");Cipher x=Cipher.getInstance("AES/GCM/NoPadding");x.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));return new String(x.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}catch(Exception e){c.getSharedPreferences("secure",0).edit().clear().apply();return "";} }
    static void clear(Context c){c.getSharedPreferences("secure",0).edit().clear().apply();}
    private static SecretKey key() throws Exception {KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);if(!ks.containsAlias(ALIAS)){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}return (SecretKey)ks.getKey(ALIAS,null);}
}
