# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# Private native DEVICE journal bridge resolves these methods by descriptor.
-keep class com.ynxweb4.wallet.DeviceApprovalJournal {
    boolean enter(java.lang.String, byte[]);
    boolean claimKeyAttempt(java.lang.String, byte[]);
    void recordReceipt(java.lang.String, byte[], byte[]);
    void retain(java.lang.String, byte[], byte[], byte[]);
    void commitVerified(java.lang.String, byte[], byte[], byte[], byte[], byte[]);
    byte[][] readCommitted(java.lang.String, byte[]);
    byte[][] readSnapshot(java.lang.String, byte[]);
}

-keep class com.ynxweb4.wallet.DeviceApprovalOriginalReview {
    void acknowledgeInsertedClaim();
    boolean originalPreSignCurrent(java.lang.String, byte[]);
    boolean originalClaimCurrent(java.lang.String, byte[]);
}
