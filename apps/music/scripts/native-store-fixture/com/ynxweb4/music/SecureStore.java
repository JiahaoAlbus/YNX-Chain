package com.ynxweb4.music;
import android.content.Context;
// Host-only session custody fixture. The shipped Android AES/Keystore code is compiled separately.
final class SecureStore {
 static String binding=""; static RuntimeException failure;
 static String get(Context context){if(failure!=null)throw failure;return binding;}
 static void put(Context context,String value){binding=value;}
 static void clear(Context context){binding="";}
}
