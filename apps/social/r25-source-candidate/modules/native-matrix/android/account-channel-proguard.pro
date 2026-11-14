-keep class com.ynx.social.matrix.VeilNativeAccountChannel { *; }
-keepclassmembers class com.ynx.social.matrix.VeilSocialLoginClient$AccountChannelBorrow {
    private void requireCurrent();
    private long revisionForNative();
    private byte[] cookieForNative();
    private byte[] issuerForNative();
    private byte[] targetForNative();
    private byte[] bodyForNative();
}
# Exact selected Rust JNI names and result fields; sole libsignal provider.
-keep class org.rustls.platformverifier.CertificateVerifier { *; }
-keep class org.rustls.platformverifier.VerificationResult { *; }
-keep class org.rustls.platformverifier.StatusCode { *; }

# Native F06 DialogHolder uses these exact class/method descriptors through JNI.
# Keeping names and members preserves the ABI; it grants no confirmation/Source.
-keep class com.ynx.social.matrix.VeilDeviceRevocationConfirmation$Current { *; }
-keep class com.ynx.social.matrix.VeilDeviceRevocationConfirmation$Binding { *; }
-keep interface com.ynx.social.matrix.VeilDeviceRevocationConfirmation$HeldReview { *; }
-keep class com.ynx.social.matrix.VeilDeviceRevocationConfirmation$DialogReceipt { *; }

# Exact independent DEVICE provisioning review callback names for Main JNI.
# A kept class or Java event is never Source/purpose authorization.
-keep class com.ynx.social.matrix.VeilDeviceProvisioningConfirmation$Current { *; }
-keep class com.ynx.social.matrix.VeilDeviceProvisioningConfirmation$Binding { *; }
-keep interface com.ynx.social.matrix.VeilDeviceProvisioningConfirmation$HeldReview { *; }
-keep class com.ynx.social.matrix.VeilDeviceProvisioningConfirmation$DialogReceipt { *; }

-keep class com.ynx.social.matrix.VeilDeviceProvisioningNativeBridge { *; }

# Receipt is part of fixed Native method descriptors as well as the concrete event.
-keep interface com.ynx.social.matrix.VeilDeviceProvisioningConfirmation$Receipt { *; }

-keep class com.ynx.social.matrix.VeilWalletDeviceApprovalClient$Result$Approved {
    byte[] getApproval();
    byte[] getPolicy();
    byte[] getRequest();
}

# Native checks this original review before continuing after a window cancellation.
-keepclassmembers class com.ynx.social.matrix.VeilDeviceProvisioningNativeCoordinator$Review {
    public boolean isOriginalWindowInvalidated();
}
