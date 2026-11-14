package com.ynx.social.pqauth.internal;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.GeneralSecurityException;

/* Internal normal SDK policy body. No Context/key/secret/grant creation here.
 * Called only by the source-owned C producer on the same native owner worker.
 * Authentication window is an explicit private product policy input, NOT an
 * authorization flag or JS option. No unauthenticated/default policy exists.
 */
final class VeilOwnKeyBootstrapPolicy {
    private VeilOwnKeyBootstrapPolicy() {}
    private static void validate(String alias, int seconds) throws GeneralSecurityException {
        if (alias == null || !alias.matches("ynx\\.social\\.ownkey\\.v1\\.[0-9a-f]{32}"))
            throw new GeneralSecurityException("OWN_ALIAS_PROFILE");
        if (seconds < 1 || seconds > 120)
            throw new GeneralSecurityException("OWN_KEY_AUTH_WINDOW");
    }
    @SuppressWarnings("deprecation")
    private static KeyGenParameterSpec authenticated(String alias, int seconds)
            throws GeneralSecurityException {
        validate(alias, seconds);
        return build(alias, seconds);
    }
    private static KeyGenParameterSpec authenticatedCoreStorage(String alias, int seconds)
            throws GeneralSecurityException {
        VeilCoreStorageBinding.validateAlias(alias);
        if (seconds < 1 || seconds > 120)
            throw new GeneralSecurityException("CORE_KEY_AUTH_WINDOW");
        return build(alias, seconds);
    }
    @SuppressWarnings("deprecation")
    private static KeyGenParameterSpec build(String alias, int seconds)
            throws GeneralSecurityException {
        if (Build.VERSION.SDK_INT < 24)
            throw new GeneralSecurityException("OWN_PLATFORM_API_REQUIRED");
        return new KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationValidityDurationSeconds(seconds)
            .build();
    }
}
