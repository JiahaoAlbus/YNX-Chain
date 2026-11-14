package com.ynx.social.matrix

import okhttp3.Dns

/** Fixed routing, not a registration grant. Signer pins and verified domain remain mandatory. */
internal enum class VeilSocialLoginProfile(
    val packageName: String, val clientId: String, val callback: String,
    val callbackClass: String, val signerResource: String, val apiMount: String = "",
    val cookieIdName: String = "__Host-ynx-social-login-id",
    val cookieBindingName: String = "__Host-ynx-social-login-binding",
    val apiOrigin: String = "https://social.ynxweb4.com"
) {
M1_QA("com.ynx.social.m1qa", "ynx-social-v1-m1qa-sso-v1",
    "https://social.ynxweb4.com/sso/m1qa/callback",
    "com.ynx.social.matrix.VeilSocialQaLoginCallbackActivity", "ynx_social_m1qa_login_signer_sha256", "/m1qa",
    "__Host-ynx-social-m1qa-login-id", "__Host-ynx-social-m1qa-login-binding",
    apiOrigin = "https://127.0.0.1:18443"),
PRODUCTION(
"com.ynx.social", "ynx-social-v1-sso-v1",
        "https://social.ynxweb4.com/sso/callback",
        "com.ynx.social.matrix.VeilSocialLoginCallbackActivity", "ynx_social_login_signer_sha256"),
    PARALLEL_QA("com.ynx.social.veilqa", "ynx-social-v1-veilqa-sso-v1",
        "https://social.ynxweb4.com/sso/veilqa/callback",
        "com.ynx.social.matrix.VeilSocialQaLoginCallbackActivity", "ynx_social_qa_login_signer_sha256");

    companion object {
        fun forPackage(packageName: String): VeilSocialLoginProfile =
            entries.singleOrNull { it.packageName == packageName }
                ?: throw IllegalArgumentException("SOCIAL_LOGIN_PACKAGE_UNSUPPORTED")
    }

    // API transport is fixed per installed package. OAuth origin/client/callback
    // remain their existing signed identity, independent of this HTTPS endpoint.
    // M1 loopback candidate uses its explicit scoped QA CA and normal hostname verification.
    // Other profiles keep ordinary public DNS and system CA trust.
    internal fun transportDns(system: Dns = Dns.SYSTEM): Dns = system
}
