#include "NativeAccountPicker.h"
#include "AndroidAccountPickerBind.h"
#include <mutex>
namespace ynx::mobilepq::picker {
namespace {
JavaVM*vm=nullptr;jclass api=nullptr;jmethodID showMethod=nullptr,dismissMethod=nullptr;std::mutex bindMutex;
struct Env {
 JNIEnv*e=nullptr;bool attached=false;
 Env(){if(!vm)return;auto r=vm->GetEnv(reinterpret_cast<void**>(&e),JNI_VERSION_1_6);if(r==JNI_EDETACHED)attached=vm->AttachCurrentThread(&e,nullptr)==JNI_OK;else if(r!=JNI_OK)e=nullptr;}
 ~Env(){if(attached)vm->DetachCurrentThread();}
 bool clear(){if(e&&e->ExceptionCheck()){e->ExceptionClear();return true;}return false;}
};
}
bool bindAndroid(JNIEnv*e)noexcept{try{
 std::lock_guard<std::mutex>lock(bindMutex);if(api)return true;JavaVM*machine=nullptr;if(!e||e->GetJavaVM(&machine)!=JNI_OK)return false;
 auto cls=e->FindClass("com/ynx/wallet/pq/NativeSelectedAccountUI");if(!cls){e->ExceptionClear();return false;}
 auto show=e->GetStaticMethodID(cls,"showOriginal","(J[Ljava/lang/String;)V");
 if(!show||e->ExceptionCheck()){e->ExceptionClear();e->DeleteLocalRef(cls);return false;}
 auto dismiss=e->GetStaticMethodID(cls,"dismissOriginal","(J)V");
 if(!dismiss||e->ExceptionCheck()){e->ExceptionClear();e->DeleteLocalRef(cls);return false;}
 auto held=static_cast<jclass>(e->NewGlobalRef(cls));e->DeleteLocalRef(cls);if(!held||e->ExceptionCheck()){e->ExceptionClear();if(held)e->DeleteGlobalRef(held);return false;}
 vm=machine;showMethod=show;dismissMethod=dismiss;api=held;return true;
}catch(...){return false;}}
int32_t platformShow(uint64_t token,const std::vector<std::string>&rows)noexcept{bool entered=false;try{
 std::lock_guard<std::mutex>lock(bindMutex);Env s;if(!s.e||!api)return unavailable;
 auto cls=s.e->FindClass("java/lang/String");if(!cls){s.clear();return unavailable;}
 auto values=s.e->NewObjectArray(jsize(rows.size()),cls,nullptr);s.e->DeleteLocalRef(cls);if(!values){s.clear();return unavailable;}
 for(size_t i=0;i<rows.size();++i){auto value=s.e->NewStringUTF(rows[i].c_str());if(!value||s.clear()){if(value)s.e->DeleteLocalRef(value);s.e->DeleteLocalRef(values);s.clear();return unavailable;}s.e->SetObjectArrayElement(values,jsize(i),value);s.e->DeleteLocalRef(value);if(s.clear()){s.e->DeleteLocalRef(values);return unavailable;}}
 entered=true;s.e->CallStaticVoidMethod(api,showMethod,jlong(token),values);s.e->DeleteLocalRef(values);
 // A Java exception after entering show cannot prove that nothing was posted.
 // Keep the original UI child pending, request dismissal and await its ACK.
 if(s.clear()){selected(token,0,unavailable);s.e->CallStaticVoidMethod(api,dismissMethod,jlong(token));s.clear();}
 return 0;
}catch(...){if(entered){selected(token,0,unavailable);platformDismiss(token);return 0;}return unavailable;}}
void platformDismiss(uint64_t token)noexcept{try{std::lock_guard<std::mutex>lock(bindMutex);Env s;if(!s.e||!api)return;s.e->CallStaticVoidMethod(api,dismissMethod,jlong(token));s.clear();}catch(...){}}
}
extern "C" JNIEXPORT jboolean JNICALL Java_com_ynx_wallet_pq_NativeSelectedAccountUI_nativeCurrent(JNIEnv*,jobject,jlong t){return t>0&&ynx::mobilepq::picker::presentationCurrent(uint64_t(t))?JNI_TRUE:JNI_FALSE;}
extern "C" JNIEXPORT jboolean JNICALL Java_com_ynx_wallet_pq_NativeSelectedAccountUI_nativeSelected(JNIEnv*,jobject,jlong t,jint i,jint r){return t>0&&ynx::mobilepq::picker::selected(uint64_t(t),uint32_t(i),r)?JNI_TRUE:JNI_FALSE;}
extern "C" JNIEXPORT void JNICALL Java_com_ynx_wallet_pq_NativeSelectedAccountUI_nativeClosed(JNIEnv*,jobject,jlong t){if(t>0)ynx::mobilepq::picker::presentationClosed(uint64_t(t));}
