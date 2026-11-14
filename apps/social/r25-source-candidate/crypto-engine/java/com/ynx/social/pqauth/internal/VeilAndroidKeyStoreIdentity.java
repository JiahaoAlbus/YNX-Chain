package com.ynx.social.pqauth.internal;

import android.os.Build;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;

/** Core wrapping-key continuity only; never Source-role or counter authority.
 * No key export, hidden API, generation, deletion or alias replacement.
 */
final class VeilAndroidKeyStoreIdentity {
    private static final String KEYSTORE2_KEY="android.security.keystore2.AndroidKeyStoreSecretKey";
    private final SecretKey original;
    private final int authenticationSeconds;
    private VeilAndroidKeyStoreIdentity(SecretKey key,int seconds){
        original=key;authenticationSeconds=seconds;
    }
    static void requireSupported()throws GeneralSecurityException{
        // Legacy equals uses alias/uid and cannot detect alias replacement.
        if(Build.VERSION.SDK_INT<31)throw new GeneralSecurityException("CORE_STORAGE_KEY_CONTINUITY_UNAVAILABLE");
    }
    static int profile(KeyInfo i)throws GeneralSecurityException{
        if(i==null||i.getKeySize()!=256||i.getPurposes()!=(KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)||
            i.getOrigin()!=KeyProperties.ORIGIN_GENERATED||!i.isUserAuthenticationRequired()||
            i.getUserAuthenticationValidityDurationSeconds()<1||i.getUserAuthenticationValidityDurationSeconds()>120||
            !Arrays.equals(i.getBlockModes(),new String[]{KeyProperties.BLOCK_MODE_GCM})||
            !Arrays.equals(i.getEncryptionPaddings(),new String[]{KeyProperties.ENCRYPTION_PADDING_NONE}))
            throw new GeneralSecurityException("OWN_KEY_PROFILE");
        return i.getUserAuthenticationValidityDurationSeconds();
    }
    private static SecretKey platformKey(Key key)throws GeneralSecurityException{
        requireSupported();
        if(!(key instanceof SecretKey)||!"AES".equals(key.getAlgorithm()))
            throw new GeneralSecurityException("CORE_STORAGE_KEY_MISSING_NO_REGENERATION");
        // Framework KeyStore2 equality compares immutable key IDs. Reject an
        // app-provided SecretKey implementation or an alias-only proxy.
        Class<?> type=key.getClass();
        if(!KEYSTORE2_KEY.equals(type.getName())||type.getClassLoader()!=KeyInfo.class.getClassLoader())
            throw new GeneralSecurityException("CORE_STORAGE_KEY_CONTINUITY_UNAVAILABLE");
        return (SecretKey)key;
    }
    static void sameKey(SecretKey original,SecretKey candidate)throws GeneralSecurityException{
        platformKey(original);platformKey(candidate);
        if(candidate.getClass()!=original.getClass()||!original.equals(candidate)||!candidate.equals(original))
            throw new GeneralSecurityException("CORE_STORAGE_KEY_REPLACED");
    }
    static VeilAndroidKeyStoreIdentity pin(SecretKey key,KeyInfo info)throws GeneralSecurityException{
        return new VeilAndroidKeyStoreIdentity(platformKey(key),profile(info));
    }
    void current(String alias)throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        SecretKey candidate=platformKey(store.getKey(alias,null));
        sameKey(original,candidate);
        KeyInfo info=(KeyInfo)SecretKeyFactory.getInstance("AES","AndroidKeyStore").getKeySpec(candidate,KeyInfo.class);
        if(profile(info)!=authenticationSeconds)
            throw new GeneralSecurityException("CORE_STORAGE_KEY_POLICY_CHANGED");
    }
}
