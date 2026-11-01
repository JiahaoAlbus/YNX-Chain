#pragma once
#ifdef __ANDROID__
#include <jni.h>
namespace ynx::mobilepq::os43 { bool bindAndroid(JNIEnv*); }
#endif
