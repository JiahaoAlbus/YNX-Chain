#include "NativeBackupFormat.h"
#include "AndroidOrdinaryBind.h"
#include <mutex>
#include <algorithm>
namespace ynx::auth::android_ordinary {
namespace {
std::mutex bindMutex;JavaVM*vm=nullptr;jclass api=nullptr;jmethodID openMethod=nullptr;
struct Env{
 JNIEnv*e=nullptr;bool attached=false;
 Env(){if(!vm)return;auto r=vm->GetEnv(reinterpret_cast<void**>(&e),JNI_VERSION_1_6);if(r==JNI_EDETACHED){
#ifdef __ANDROID__
  attached=vm->AttachCurrentThread(&e,nullptr)==JNI_OK;
#else
  attached=vm->AttachCurrentThread(reinterpret_cast<void**>(&e),nullptr)==JNI_OK;
#endif
  if(!attached)e=nullptr;
 }else if(r!=JNI_OK)e=nullptr;}
 ~Env(){if(attached)vm->DetachCurrentThread();}
 bool exception(){if(e&&e->ExceptionCheck()){e->ExceptionClear();return true;}return false;}
};
struct Array{
 JNIEnv*e; jbyteArray value=nullptr;bool secret=false;
 Array(JNIEnv*v,const uint8_t*p,size_t n,bool s=false):e(v),secret(s){if(n>196608)throw Failure(2);value=e->NewByteArray(jsize(n));if(!value||e->ExceptionCheck()){e->ExceptionClear();if(value)e->DeleteLocalRef(value);value=nullptr;throw Failure(5);}e->SetByteArrayRegion(value,0,jsize(n),reinterpret_cast<const jbyte*>(p));if(e->ExceptionCheck()){e->ExceptionClear();e->DeleteLocalRef(value);value=nullptr;throw Failure(5);}}
 ~Array(){if(!value)return;if(secret){auto n=e->GetArrayLength(value);uint8_t zeros[256]={};for(jsize at=0;at<n;){auto count=std::min<jsize>(256,n-at);e->SetByteArrayRegion(value,at,count,reinterpret_cast<const jbyte*>(zeros));at+=count;}}e->DeleteLocalRef(value);}
};
}
bool bindAndroidOrdinary(JNIEnv*e){
 if(!e)return false;std::lock_guard<std::mutex>lock(bindMutex);if(api)return true;
 JavaVM*machine=nullptr;if(e->GetJavaVM(&machine)!=JNI_OK)return false;
 auto local=e->FindClass("com/ynx/wallet/pq/NativeOrdinaryBackupCrypto");
 if(!local){e->ExceptionClear();return false;}
 auto method=e->GetStaticMethodID(local,"open","([B[B[B[B[B)[B");
 if(!method||e->ExceptionCheck()){e->ExceptionClear();e->DeleteLocalRef(local);return false;}
 auto global=static_cast<jclass>(e->NewGlobalRef(local));e->DeleteLocalRef(local);if(!global){e->ExceptionClear();return false;}
 vm=machine;openMethod=method;api=global;return true;
}
Secret decryptOriginalBackup(const Secret&password,const std::vector<uint8_t>&salt,const std::vector<uint8_t>&nonce,const std::string&aad,const std::vector<uint8_t>&ciphertext){
 Env scope;if(!scope.e||!api||!openMethod)throw Failure(5);auto e=scope.e;
 Array p(e,password.bytes.data(),password.bytes.size(),true),s(e,salt.data(),salt.size()),n(e,nonce.data(),nonce.size()),a(e,reinterpret_cast<const uint8_t*>(aad.data()),aad.size()),c(e,ciphertext.data(),ciphertext.size());
 auto result=static_cast<jbyteArray>(e->CallStaticObjectMethod(api,openMethod,p.value,s.value,n.value,a.value,c.value));
 if(scope.exception()||!result){if(result)e->DeleteLocalRef(result);throw Failure(5);}
 auto count=e->GetArrayLength(result);if(count<=0||count>196608){e->DeleteLocalRef(result);throw Failure(2);}
 Secret plain(static_cast<size_t>(count));e->GetByteArrayRegion(result,0,count,reinterpret_cast<jbyte*>(plain.bytes.data()));
 // Wipe the returned Java mutable plaintext before releasing its local ref.
 uint8_t zeros[256]={};for(jsize at=0;at<count;){auto chunk=std::min<jsize>(256,count-at);e->SetByteArrayRegion(result,at,chunk,reinterpret_cast<const jbyte*>(zeros));at+=chunk;}
 e->DeleteLocalRef(result);if(scope.exception())throw Failure(5);return plain;
}
}
