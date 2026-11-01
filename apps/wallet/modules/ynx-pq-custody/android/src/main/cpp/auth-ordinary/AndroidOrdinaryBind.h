#pragma once
#include <jni.h>
namespace ynx::auth::android_ordinary {
// Invoke once at the original Native module's existing nativeInstall, on its
// classloader thread. No global key, key service or second JavaVM is created.
bool bindAndroidOrdinary(JNIEnv*);
}
