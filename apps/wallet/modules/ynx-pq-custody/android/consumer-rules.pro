# Fixed JNI names; none of these methods is a React/Hermes credential API.
-keep class com.ynx.wallet.pq.NativeSecure43 { *; }
-keep class com.ynx.wallet.pq.NativeSecure43$Result { *; }
-keep class com.ynx.wallet.pq.NativeOrdinaryBackupCrypto { *; }
-keepclassmembers class com.ynx.wallet.pq.YNXPQCustodyModule { native <methods>; }
