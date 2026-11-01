#include <jni.h>
#include <ReactCommon/CallInvokerHolder.h>
#include <fbjni/fbjni.h>
#include "CustodyJSI.h"
#include "PublicStatus.h"
#include "AndroidOS43Bind.h"
#include "auth-ordinary/AndroidOrdinaryBind.h"
extern "C" JNIEXPORT jboolean JNICALL
Java_com_ynx_wallet_pq_YNXPQCustodyModule_nativeInstall(JNIEnv* env,jobject,jlong runtime,jobject invoker,jlongArray adopted){
 uint64_t binding=0;bool installed=false;
 if(!runtime||!invoker||!adopted||env->GetArrayLength(adopted)!=1)return JNI_FALSE;
 try{
#if defined(__ANDROID__)
  if(!ynx::mobilepq::os43::bindAndroid(env))return JNI_FALSE;
  if(!ynx::auth::android_ordinary::bindAndroidOrdinary(env))return JNI_FALSE;
#else
  (void)env;
#endif
  auto holder=facebook::jni::alias_ref<facebook::react::CallInvokerHolder::javaobject>(reinterpret_cast<facebook::react::CallInvokerHolder::javaobject>(invoker));
  auto callInvoker=holder->cthis()->getCallInvoker();
  installed=ynx::mobilepq::install(*reinterpret_cast<facebook::jsi::Runtime*>(runtime),callInvoker,&binding);
 }catch(...){/* Partial binding must reach the owning Native module. */}
 // Java allocates this slot BEFORE install; no result-array allocation after
 // adopting a partial worker/runtime. Its finally block retains this binding.
 const jlong selected=static_cast<jlong>(binding);env->SetLongArrayRegion(adopted,0,1,&selected);
 return !env->ExceptionCheck()&&installed?JNI_TRUE:JNI_FALSE;
}
extern "C" JNIEXPORT jboolean JNICALL
Java_com_ynx_wallet_pq_YNXPQCustodyModule_nativeInvalidate(JNIEnv*,jobject,jlong binding){
 try{return binding>0&&ynx::mobilepq::invalidate(static_cast<uint64_t>(binding))?JNI_TRUE:JNI_FALSE;}catch(...){return JNI_FALSE;}
}
extern "C" JNIEXPORT jboolean JNICALL
Java_com_ynx_wallet_pq_YNXPQCustodyModule_nativeRequestInvalidate(JNIEnv*,jobject,jlong binding){
 try{return binding>0&&ynx::mobilepq::requestInvalidate(static_cast<uint64_t>(binding))?JNI_TRUE:JNI_FALSE;}catch(...){return JNI_FALSE;}
}
extern "C" JNIEXPORT jintArray JNICALL
Java_com_ynx_wallet_pq_YNXPQCustodyModule_nativeReadPublicStatus(JNIEnv* env,jobject){
 try{
  const auto status=ynx::mobilepq::readPublicStatus();const auto& h=status.held;
  const jint values[]={1,static_cast<jint>(status.runtime),static_cast<jint>(h.heldOperations),static_cast<jint>(h.heldCoreUncertain),
   static_cast<jint>(h.heldOSUncertain),static_cast<jint>(h.heldOSRecorded),static_cast<jint>(h.heldCleanupFaults),h.workerBusy?1:0};
  auto out=env->NewIntArray(8);if(!out)return nullptr;env->SetIntArrayRegion(out,0,8,values);return env->ExceptionCheck()?nullptr:out;
 }catch(...){return nullptr;}
}
