#include "SelectedAppDirectoryPrivate.h"
#include "AndroidSelectedAppDirectoryBind.h"
#include <mutex>
namespace ynx::mobilepq::directories {
namespace {
JavaVM*machine=nullptr;jclass contextClass=nullptr;jmethodID directoryMethod=nullptr;
std::mutex contextMutex;
struct Environment {
 JNIEnv*env=nullptr;bool attached=false;
 Environment(){if(!machine)return;auto rc=machine->GetEnv(reinterpret_cast<void**>(&env),JNI_VERSION_1_6);
  if(rc==JNI_EDETACHED)attached=machine->AttachCurrentThread(&env,nullptr)==JNI_OK;
  else if(rc!=JNI_OK)env=nullptr;
 }
 ~Environment(){if(attached)machine->DetachCurrentThread();}
 bool clear(){if(env&&env->ExceptionCheck()){env->ExceptionClear();return true;}return false;}
};
}
bool bindAndroidApplicationDirectory(JNIEnv*env)noexcept{
 try{
  std::lock_guard<std::mutex>lock(contextMutex);if(contextClass)return true;
  JavaVM*vm=nullptr;if(!env||env->GetJavaVM(&vm)!=JNI_OK)return false;
  auto local=env->FindClass("com/ynx/wallet/pq/NativeSelectedAppContext");
  if(!local){env->ExceptionClear();return false;}
  auto method=env->GetStaticMethodID(local,"originalApplicationDirectory","()Ljava/lang/String;");
  if(!method||env->ExceptionCheck()){env->ExceptionClear();env->DeleteLocalRef(local);return false;}
  auto held=static_cast<jclass>(env->NewGlobalRef(local));env->DeleteLocalRef(local);
  if(!held||env->ExceptionCheck()){env->ExceptionClear();if(held)env->DeleteGlobalRef(held);return false;}
  machine=vm;directoryMethod=method;contextClass=held;return true;
 }catch(...){return false;}
}
int32_t platformApplicationDirectory(std::string&out)noexcept{
 try{
  // Process Application is immutable; no second provider/context is selected.
  std::lock_guard<std::mutex>lock(contextMutex);
  if(!contextClass||!machine||!directoryMethod)return notSupplied;
  Environment scope;if(!scope.env)return io;
  auto value=static_cast<jstring>(scope.env->CallStaticObjectMethod(contextClass,directoryMethod));
  if(scope.clear()||!value){if(value)scope.env->DeleteLocalRef(value);return notSupplied;}
  auto chars=scope.env->GetStringUTFChars(value,nullptr);
  const bool failed=scope.clear();
  if(!chars||failed){if(chars)scope.env->ReleaseStringUTFChars(value,chars);scope.env->DeleteLocalRef(value);return io;}
  // Android OS app-data components are fixed UTF-8 package/user paths. No
  // account, filename, Root selector or JS string is an argument to this call.
  try{out.assign(chars);}catch(...){scope.env->ReleaseStringUTFChars(value,chars);scope.env->DeleteLocalRef(value);return io;}
  scope.env->ReleaseStringUTFChars(value,chars);scope.env->DeleteLocalRef(value);return scope.clear()?io:0;
 }catch(...){return io;}
}
}
