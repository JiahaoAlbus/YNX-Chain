#include "AIMobileBinding.h"
#include <DefaultTurboModuleManagerDelegate.h>
#include <jni.h>
#include <mutex>
namespace {
std::once_flag registration;
}
extern "C" JNIEXPORT void JNICALL Java_com_ynx_wallet_ai_YNXOriginalAIMobileV6Registration_registerBeforeReactHost(JNIEnv*,jclass){
 std::call_once(registration,[]{
  auto previous=facebook::react::DefaultTurboModuleManagerDelegate::cxxModuleProvider;
  facebook::react::DefaultTurboModuleManagerDelegate::cxxModuleProvider=[previous](const std::string&name,const std::shared_ptr<facebook::react::CallInvoker>&invoker){
   if(name==ynx::mobileai::moduleName)return ynx::mobileai::makeOriginalAIMobileV6Module(invoker);
   return previous?previous(name,invoker):nullptr;
  };
 });
}
extern "C" JNIEXPORT void JNICALL Java_com_ynx_wallet_ai_YNXOriginalAIMobileV6Registration_requestRetireBeforeReactHostInvalidation(JNIEnv*,jclass){ynx::mobileai::requestRetireOriginalAIMobileV6();}
extern "C" JNIEXPORT jboolean JNICALL Java_com_ynx_wallet_ai_YNXOriginalAIMobileV6Registration_drainOnNativeTeardownExecutor(JNIEnv*,jclass){return ynx::mobileai::drainOriginalAIMobileV6()?JNI_TRUE:JNI_FALSE;}
