#include "MobileInstalledApplicationOriginalPrivate.hpp"
#include "MobileAITaskPlatformPrivate.h"
#include <jni.h>
#include <dlfcn.h>
#include <atomic>
#include <mutex>
#include <thread>
#include <array>

extern "C" void Java_com_ynx_wallet_ai_YNXOriginalAIMobileV6Registration_registerBeforeReactHost(JNIEnv*,jclass);
namespace ynx::sdk::mobileapplication {
namespace {
constexpr int32_t unavailable=-68201,invalid=-68202,wrongActor=-68204,retired=-68205,io=-68206;
std::mutex bindingMutex;JavaVM*machine=nullptr;jclass originalClass=nullptr;
struct Environment {
 JNIEnv*env=nullptr;bool attached=false;
 Environment(){if(!machine)return;auto rc=machine->GetEnv(reinterpret_cast<void**>(&env),JNI_VERSION_1_6);
  if(rc==JNI_EDETACHED){attached=machine->AttachCurrentThread(&env,nullptr)==JNI_OK;if(!attached)env=nullptr;}
  else if(rc!=JNI_OK)env=nullptr;
 }
 ~Environment(){if(attached)machine->DetachCurrentThread();}
 bool clear(){if(env&&env->ExceptionCheck()){env->ExceptionClear();return true;}return false;}
};
std::string text(JNIEnv*env,jstring value){
 if(!value)return {};auto chars=env->GetStringUTFChars(value,nullptr);if(!chars)return {};
 std::string result;try{result=chars;}catch(...){env->ReleaseStringUTFChars(value,chars);throw;}
 env->ReleaseStringUTFChars(value,chars);return result;
}
jmethodID method(Environment&e,const char*name,const char*signature){
 if(!e.env||!originalClass)return nullptr;auto id=e.env->GetStaticMethodID(originalClass,name,signature);if(e.clear())return nullptr;return id;
}
Failure pair(Environment&e,const char*name,jlong id,bool*physical=nullptr){
 if(physical)*physical=false;auto m=method(e,name,"(J)[I");if(!m)return {true,unavailable};
 auto raw=static_cast<jintArray>(e.env->CallStaticObjectMethod(originalClass,m,id));
 if(e.clear()||!raw){if(raw)e.env->DeleteLocalRef(raw);return {true,io};}
 const jsize expected=physical?3:2;if(e.env->GetArrayLength(raw)!=expected){e.env->DeleteLocalRef(raw);return {true,invalid};}
 std::array<jint,3>values{};e.env->GetIntArrayRegion(raw,0,expected,values.data());e.env->DeleteLocalRef(raw);
 if(e.clear()||(values[0]!=0&&values[0]!=1)||(physical&&values[2]!=0&&values[2]!=1))return {true,invalid};
 if(physical)*physical=values[2]==1;return {values[0]==1,values[1]};
}
bool loadedPaths(std::array<std::string,2>&out){
 const void*symbols[]={reinterpret_cast<const void*>(&ynx_ai_mobile_application_acquire_v6),reinterpret_cast<const void*>(&Java_com_ynx_wallet_ai_YNXOriginalAIMobileV6Registration_registerBeforeReactHost)};
 for(size_t i=0;i<2;++i){Dl_info info{};if(!dladdr(symbols[i],&info)||!info.dli_fname)return false;out[i]=info.dli_fname;}
 return out[0]==out[1]&&!out[0].empty();
}
}
// Normal App-only class binding: no Context/path/hash/Root or provider argument.
// It never replaces JNI_OnLoad and cannot change the selected process class.
extern "C" JNIEXPORT void JNICALL Java_com_ynxweb4_ai_NativeInstalledApplication_bindNativeClass(JNIEnv*env,jclass actual){
 try{
  std::lock_guard<std::mutex>lock(bindingMutex);
  if(originalClass){if(!env->IsSameObject(originalClass,actual)){auto type=env->FindClass("java/lang/IllegalStateException");if(type)env->ThrowNew(type,"AI_ORIGINAL_INSTALL_CLASS_CHANGED");}return;}
  JavaVM*vm=nullptr;if(env->GetJavaVM(&vm)!=JNI_OK)return;
  auto held=static_cast<jclass>(env->NewGlobalRef(actual));if(!held)return;
  machine=vm;originalClass=held;
 }catch(...){auto type=env->FindClass("java/lang/IllegalStateException");if(type)env->ThrowNew(type,"AI_ORIGINAL_INSTALL_BIND_FAILED");}
}
struct InstalledApplicationOriginal::Storage {
 std::thread::id actor=std::this_thread::get_id();std::atomic<bool>retired{false};
 std::atomic<jlong>original{0};bool closed=false,closeUncertain=false;Failure first{},closeFailure{};std::array<std::string,2>images;
 Failure fail(Failure f){if(f.present&&!first.present)first=f;return first;}
 Failure check(){
  if(actor!=std::this_thread::get_id())return {true,wrongActor};
  if(first.present)return first;if(retired||closed)return {true,::ynx::sdk::mobileapplication::retired};
  std::array<std::string,2>now;if(!loadedPaths(now)||now!=images)return fail({true,invalid});
  Environment e;return fail(pair(e,"currentNative",original));
 }
};
InstalledApplicationOriginal::InstalledApplicationOriginal():storage_(new Storage){}
InstalledApplicationOriginal::~InstalledApplicationOriginal()=default;
Failure InstalledApplicationOriginal::acquire(std::unique_ptr<InstalledApplicationOriginal>&out)noexcept {
 if(out)return {true,invalid};
 try{
  out=std::unique_ptr<InstalledApplicationOriginal>(new InstalledApplicationOriginal);auto&s=*out->storage_;
  // Acquisition is ordered after the actual normal App class bind. Synchronize
  // publication only; never hold this mutex through Java/OS or Root calls.
  {std::lock_guard<std::mutex>lock(bindingMutex);if(!originalClass||!machine)return s.fail({true,unavailable});}
  if(!loadedPaths(s.images))return s.fail({true,unavailable});Environment e;
  auto m=method(e,"captureNative","(Ljava/lang/String;Ljava/lang/String;)J");if(!m)return s.fail({true,unavailable});
  auto a=e.env->NewStringUTF(s.images[0].c_str());auto b=e.env->NewStringUTF(s.images[1].c_str());
  if(e.clear()||!a||!b){if(a)e.env->DeleteLocalRef(a);if(b)e.env->DeleteLocalRef(b);return s.fail({true,io});}
  s.original=e.env->CallStaticLongMethod(originalClass,m,a,b); // retain partial ID before failure inspection
  e.env->DeleteLocalRef(a);e.env->DeleteLocalRef(b);
  if(e.clear())return s.fail({true,io});if(s.original<=0)return s.fail({true,unavailable});
  auto failure=pair(e,"failureNative",s.original);if(failure.present)return s.fail(failure);return s.check();
 }catch(...){return out?out->storage_->fail({true,io}):Failure{true,io};}
}
Failure InstalledApplicationOriginal::readCaptured(Capture&out)noexcept {
 try{
  auto&s=*storage_;auto f=s.check();if(f.present)return f;Environment e;auto m=method(e,"readNative","(J)[Ljava/lang/String;");if(!m)return s.fail({true,unavailable});
  auto values=static_cast<jobjectArray>(e.env->CallStaticObjectMethod(originalClass,m,s.original.load()));
  if(e.clear()||!values){if(values)e.env->DeleteLocalRef(values);return s.fail({true,io});}
  if(e.env->GetArrayLength(values)!=6){e.env->DeleteLocalRef(values);return s.fail({true,invalid});}
  std::array<std::string,6>strings;
  for(size_t i=0;i<strings.size();++i){auto item=static_cast<jstring>(e.env->GetObjectArrayElement(values,static_cast<jsize>(i)));strings[i]=text(e.env,item);if(item)e.env->DeleteLocalRef(item);}
  e.env->DeleteLocalRef(values);if(e.clear())return s.fail({true,io});
  if(strings[0]!="android"||strings[1]!="com.ynxweb4.ai")return s.fail({true,invalid});
  for(size_t i=2;i<6;++i)if(strings[i].size()!=64||strings[i].find_first_not_of("0123456789abcdef")!=std::string::npos)return s.fail({true,invalid});
  out={strings[0],strings[1],strings[2],strings[3],strings[4],strings[5]};return s.check();
 }catch(...){return storage_->fail({true,io});}
}
Failure InstalledApplicationOriginal::current()noexcept {try{return storage_->check();}catch(...){return storage_->fail({true,io});}}
void InstalledApplicationOriginal::retire()noexcept {
 storage_->retired=true;
 try{if(!storage_->original)return;Environment e;auto m=method(e,"retireNative","(J)V");if(m)e.env->CallStaticVoidMethod(originalClass,m,storage_->original.load());e.clear();}catch(...){}
}
Failure InstalledApplicationOriginal::close(bool&physicalDone)noexcept {
 physicalDone=false;auto&s=*storage_;
 if(s.actor!=std::this_thread::get_id())return {true,wrongActor};s.retired=true;
 if(s.closeUncertain)return s.closeFailure;if(s.closed){physicalDone=true;return {};}
 if(s.original==0){s.closed=true;physicalDone=true;return {};}
 try{Environment e;auto f=pair(e,"closeNative",s.original,&physicalDone);
  if(physicalDone){s.closed=true;s.original=0;return f;}
  s.closeUncertain=true;s.closeFailure=f.present?f:Failure{true,io};return s.closeFailure;
 }catch(...){s.closeUncertain=true;s.closeFailure={true,io};return s.closeFailure;}
}
}
