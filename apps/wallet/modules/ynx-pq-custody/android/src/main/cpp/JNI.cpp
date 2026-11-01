#include <jni.h>
#include <ReactCommon/CallInvokerHolder.h>
#include <fbjni/fbjni.h>
#include "CustodyJSI.h"
extern "C" JNIEXPORT jboolean JNICALL
Java_com_ynx_wallet_pq_YNXPQCustodyModule_nativeInstall(JNIEnv*,jobject,jlong runtime,jobject invoker){
 if(!runtime||!invoker)return JNI_FALSE;
 try{
  auto holder=facebook::jni::alias_ref<facebook::react::CallInvokerHolder::javaobject>(reinterpret_cast<facebook::react::CallInvokerHolder::javaobject>(invoker));
  auto callInvoker=holder->cthis()->getCallInvoker();
  return ynx::mobilepq::install(*reinterpret_cast<facebook::jsi::Runtime*>(runtime),callInvoker)?JNI_TRUE:JNI_FALSE;
 }catch(...){return JNI_FALSE;}
}
extern "C" JNIEXPORT jboolean JNICALL
Java_com_ynx_wallet_pq_YNXPQCustodyModule_nativeInvalidate(JNIEnv*,jobject){
 try{return ynx::mobilepq::invalidate()?JNI_TRUE:JNI_FALSE;}catch(...){return JNI_FALSE;}
}
