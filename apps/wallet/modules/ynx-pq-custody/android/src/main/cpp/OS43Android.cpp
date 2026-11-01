#include "OS43Private.h"
#include "AndroidOS43Bind.h"
#include "Wrapped43Record.h"
#include <jni.h>
#include <algorithm>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <mutex>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>
namespace ynx::mobilepq::os43 {
namespace {
JavaVM* machine=nullptr;jclass api=nullptr;std::mutex bindingMutex;
struct Environment {
 JNIEnv* env=nullptr;bool attached=false;
 Environment(){if(!machine)return;auto code=machine->GetEnv(reinterpret_cast<void**>(&env),JNI_VERSION_1_6);
  if(code==JNI_EDETACHED){
#if defined(__ANDROID__)
   attached=machine->AttachCurrentThread(&env,nullptr)==JNI_OK;
#else
   attached=machine->AttachCurrentThread(reinterpret_cast<void**>(&env),nullptr)==JNI_OK;
#endif
  }else if(code!=JNI_OK)env=nullptr;
 }
 ~Environment(){if(attached)machine->DetachCurrentThread();}
 bool clear(){if(env&&env->ExceptionCheck()){env->ExceptionClear();return true;}return false;}
};
struct Result {
 int32_t code=unsupported;uint32_t level=0;bool possible=false;std::vector<uint8_t> bytes;
 ~Result(){wipe(bytes.data(),bytes.size());}
 Result()=default;Result(const Result&)=delete;Result&operator=(const Result&)=delete;
 Result(Result&&)=default;
};
jbyteArray array(JNIEnv* e,const uint8_t* p,size_t n){if(n>65536)return nullptr;auto a=e->NewByteArray(jsize(n));if(a&&n)e->SetByteArrayRegion(a,0,jsize(n),reinterpret_cast<const jbyte*>(p));return a;}
void clearArray(JNIEnv* e,jbyteArray a){if(!a)return;auto n=e->GetArrayLength(a);std::vector<jbyte> zero(size_t(n),0);if(n)e->SetByteArrayRegion(a,0,n,zero.data());e->DeleteLocalRef(a);}
Result unpack(Environment& scope,jobject object){
 Result out;auto e=scope.env;if(!object||scope.clear())return out;
 auto type=e->GetObjectClass(object);auto code=e->GetMethodID(type,"getCode","()I"),level=e->GetMethodID(type,"getProtection","()I"),possible=e->GetMethodID(type,"getPossible","()Z"),bytes=e->GetMethodID(type,"getBytes","()[B");
 if(!code||!level||!possible||!bytes||scope.clear()){e->DeleteLocalRef(type);e->DeleteLocalRef(object);return out;}
 out.code=e->CallIntMethod(object,code);out.level=uint32_t(e->CallIntMethod(object,level));out.possible=e->CallBooleanMethod(object,possible);
 auto data=static_cast<jbyteArray>(e->CallObjectMethod(object,bytes));
 if(scope.clear()){out.code=denied;}else if(data){auto n=e->GetArrayLength(data);if(n<0||n>65536)out.code=bounds;else{out.bytes.resize(size_t(n));if(n)e->GetByteArrayRegion(data,0,n,reinterpret_cast<jbyte*>(out.bytes.data()));}clearArray(e,data);}
 e->DeleteLocalRef(type);e->DeleteLocalRef(object);return out;
}
std::string alias(const YNXMobileOS43Descriptor& d){return "com.ynx.wallet.pq43.v1."+itemID(d);}
Result inspect(const YNXMobileOS43Descriptor& d){
 Environment s;if(!s.env||!api)return {};auto method=s.env->GetStaticMethodID(api,"inspect","(Ljava/lang/String;)Lcom/ynx/wallet/pq/NativeSecure43$Result;");
 if(!method||s.clear())return {};auto a=s.env->NewStringUTF(alias(d).c_str());auto o=s.env->CallStaticObjectMethod(api,method,a);s.env->DeleteLocalRef(a);return unpack(s,o);
}

}
bool bindAndroid(JNIEnv* e){std::lock_guard<std::mutex> lock(bindingMutex);if(api)return true;if(e->GetJavaVM(&machine)!=JNI_OK)return false;auto local=e->FindClass("com/ynx/wallet/pq/NativeSecure43");if(!local){e->ExceptionClear();return false;}api=static_cast<jclass>(e->NewGlobalRef(local));e->DeleteLocalRef(local);return api!=nullptr;}
int32_t platformSHA256(const uint8_t* p,size_t n,uint8_t* out){
 Environment s;if(!s.env||!api||!p||!n||n>65536||!out)return unsupported;
 auto method=s.env->GetStaticMethodID(api,"digest","([B)[B");if(!method||s.clear())return denied;
 auto input=array(s.env,p,n);auto output=static_cast<jbyteArray>(s.env->CallStaticObjectMethod(api,method,input));clearArray(s.env,input);
 if(s.clear()||!output||s.env->GetArrayLength(output)!=32){if(output)clearArray(s.env,output);return denied;}
 s.env->GetByteArrayRegion(output,0,32,reinterpret_cast<jbyte*>(out));clearArray(s.env,output);return 0;
}
int32_t platformInput(const YNXMobileOS43Descriptor& d,Credential& out){
 Environment s;if(!s.env||!api)return unsupported;auto method=s.env->GetStaticMethodID(api,"inputOriginal","(I)Lcom/ynx/wallet/pq/NativeSecure43$Result;");if(!method||s.clear())return denied;
 auto result=unpack(s,s.env->CallStaticObjectMethod(api,method,jint(d.ui_timeout_ms)));if(result.code)return result.code;if(result.bytes.size()!=43)return invalid;std::copy(result.bytes.begin(),result.bytes.end(),out.begin());return 0;
}
int32_t platformRead(const YNXMobileOS43Descriptor& d,Credential& out,YNXMobileOS43Protection& protection){
 std::vector<uint8_t> record;auto code=storage_only::readRecord(d,record);if(code)return code;
 Environment s;if(!s.env||!api)return unsupported;auto method=s.env->GetStaticMethodID(api,"unwrap","(Ljava/lang/String;[B[BII)Lcom/ynx/wallet/pq/NativeSecure43$Result;");if(!method||s.clear())return denied;
 auto a=s.env->NewStringUTF(alias(d).c_str());auto wrapped=array(s.env,record.data()+88,71);auto aad=array(s.env,record.data(),88);
 auto result=unpack(s,s.env->CallStaticObjectMethod(api,method,a,wrapped,aad,jint(d.minimum_protection),jint(d.ui_timeout_ms)));
 s.env->DeleteLocalRef(a);clearArray(s.env,wrapped);clearArray(s.env,aad);if(result.code)return result.code;if(result.bytes.size()!=43)return invalid;
 code=platformSHA256(record.data(),record.size(),protection.item_identity);if(code)return code;
 protection.platform=2;protection.protection=result.level;protection.user_presence=1;std::copy(result.bytes.begin(),result.bytes.end(),out.begin());return 0;
}
int32_t platformCurrent(const YNXMobileOS43Descriptor& d,const YNXMobileOS43Protection& p){
 std::vector<uint8_t> record;auto code=storage_only::readRecord(d,record);if(code)return code;uint8_t digest[32];code=platformSHA256(record.data(),record.size(),digest);if(code)return code;
 if(p.platform!=2||memcmp(digest,p.item_identity,32))return changed;auto result=inspect(d);return result.code?result.code:result.level!=p.protection||result.level<d.minimum_protection?denied:ok;
}
Effect platformImportAbsent(const YNXMobileOS43Descriptor& d,const Credential& c){
 auto lock=storage_only::lockDirectory(d);if(!lock.valid())return {denied,false};std::vector<uint8_t> record;auto existing=storage_only::readRecord(d,record);if(existing!=missing)return {existing==0?exists:existing,false};
 Environment s;if(!s.env||!api)return {unsupported,false};auto method=s.env->GetStaticMethodID(api,"sealAbsent","(Ljava/lang/String;[B[BII)Lcom/ynx/wallet/pq/NativeSecure43$Result;");if(!method||s.clear())return {denied,false};
 auto a=s.env->NewStringUTF(alias(d).c_str());auto value=array(s.env,c.data(),43);auto aad=metadata(d);auto context=array(s.env,aad.data(),aad.size());
 auto result=unpack(s,s.env->CallStaticObjectMethod(api,method,a,value,context,jint(d.minimum_protection),jint(d.ui_timeout_ms)));
 s.env->DeleteLocalRef(a);clearArray(s.env,value);clearArray(s.env,context);if(result.code)return {result.code,result.possible};if(result.bytes.size()!=71||result.level<d.minimum_protection)return {denied,true};
 record.assign(aad.begin(),aad.end());record.insert(record.end(),result.bytes.begin(),result.bytes.end());
 auto written=storage_only::writeAbsent(d,lock,record);return {written.code,true};

}
Effect platformRemoveExact(const YNXMobileOS43Descriptor& d){
 auto lock=storage_only::lockDirectory(d);if(!lock.valid())return {denied,false};std::vector<uint8_t> record;storage_only::Identity original{};auto present=storage_only::readRecord(d,record,&original);if(present!=ok&&present!=missing)return {present,false};
 Environment s;if(!s.env||!api)return {unsupported,false};auto method=s.env->GetStaticMethodID(api,"removeExact","(Ljava/lang/String;I)Lcom/ynx/wallet/pq/NativeSecure43$Result;");if(!method||s.clear())return {denied,false};auto a=s.env->NewStringUTF(alias(d).c_str());
 auto result=unpack(s,s.env->CallStaticObjectMethod(api,method,a,jint(d.ui_timeout_ms)));s.env->DeleteLocalRef(a);if(result.code)return {result.code,result.possible};
 if(present==ok){auto removed=storage_only::removeExact(d,lock,original);if(removed)return {unknown,true};}
 return {ok,result.possible||present==ok};
}
}
