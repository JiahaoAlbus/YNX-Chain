# JNI exports and C FindClass/GetMethodID calls require these exact names.
# Keep only the native product boundary and its private runtime collaborators.
-keep class com.ynx.social.veil.VeilNativeProductControllerBridge { *; }
-keep class com.ynx.social.matrix.VeilOwnKeyPrivateCommand { *; }
-keep class com.ynx.social.matrix.VeilLocalGenesisInput { *; }
-keep class com.ynx.social.matrix.VeilLocalRecoveryInput { *; }
-keep class com.ynx.social.matrix.VeilLocalGenesisJournalBinding { *; }
-keep class com.ynx.social.matrix.VeilOwnKeyLocalStoreCallbacks { *; }
-keep class com.ynx.social.matrix.VeilOwnKeyLocalStoreContext { *; }
-keep class com.ynx.social.matrix.VeilOwnKeyLocalStoreContext$* { *; }
-keep class com.ynx.social.pqauth.internal.VeilOwnKeyBootstrapPolicy { *; }
-keep class com.ynx.social.pqauth.internal.VeilOwnKeyPlatformProtector { *; }

# Cold recovery is invoked by exact JNI class and private callback names.
-keep class com.ynx.social.matrix.VeilOwnKeyColdRecoveryLease { *; }

# Same-Source records/originals/historical readers use exact Rust JNI exports.
# Preserve ABI 2 class and native method names for the normal shrinking build.
-keep class com.ynx.social.matrix.VeilNativeMatrixSourceJni { *; }

# P02-10 private sodium primitive JNI names in the same new carrier.
-keep class com.ynx.social.matrix.VeilSourceAttachmentCrypto { *; }
