#include <jni.h>
#include "MobileAIProtectedReviewPrivate.hpp"
#include "MobileAISigningCapturePairedPrivate.hpp"
#include "MobileAISigningCaptureSourceFencePrivate.hpp"
#include "MobileRegisteredAccountPhasePrivate.h"
#include "MobileInstalledApplicationOriginalPrivate.hpp"
#include <array>
#include <atomic>
#include <condition_variable>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>
namespace ynx::platform::ai::review {
namespace {
constexpr int32_t invalid=-68301,pending=-68302,rejected=-68303,cancelled=-68304,wrongActor=-68305;
using Bytes=std::vector<uint8_t>;using Snapshot=std::array<Bytes,6>;
enum Decision{waiting=0,approved=1,denied=2,cancel=3};
}
struct OriginalReview {
 std::thread::id actor=std::this_thread::get_id();YNXAIMobileSigningCapture*capture=nullptr;
 std::unique_ptr<ynx::sdk::mobileapplication::InstalledApplicationOriginal>installation;
 YNXMobilePQSelectedOriginal*account=nullptr;std::vector<std::string>accountOriginal;Snapshot originals;
 std::atomic<int>decision{waiting};std::atomic<bool>retired{false},uiDone{true},dismissRequested{false};std::atomic<uint32_t>uiWork{0};
 std::mutex waitMutex;std::condition_variable wake;Failure first{},cleanup{};
 bool claimSelected=false,closeSelected=false,accountClosed=false,accountReleased=false,installationClosed=false,closed=false;
 std::atomic<bool>showOutstanding{false};uint64_t id=0;std::string presentation;
};
namespace {
std::mutex ownersMutex;std::map<OriginalReview*,std::shared_ptr<OriginalReview>>owners;uint64_t nextID=1;
std::shared_ptr<OriginalReview>known(OriginalReview*p){std::lock_guard<std::mutex>lock(ownersMutex);auto i=owners.find(p);return i==owners.end()?nullptr:i->second;}
Failure note(OriginalReview&p,Failure f){if(f.present&&!p.first.present)p.first=f;return p.first;}
Failure cleanup(OriginalReview&p,Failure f){if(f.present&&!p.cleanup.present)p.cleanup=f;return f;}
std::string bytesText(const uint8_t*b,size_t n){if(!b||!n||n>16384)throw invalid;std::string text(reinterpret_cast<const char*>(b),n);if(text.find('\0')!=std::string::npos)throw invalid;return text;}
Failure snapshot(OriginalReview&p,Snapshot&out){
 auto r=ynx::auth::ai::mobile::readOriginalProtectedReviewDATA(p.capture);
 if(r.failure.present)return {true,r.failure.code};if(r.status)return {true,r.status};
 const YNXAIMobileSpanV6 parts[]={r.originals.unsignedOriginal,r.originals.messageOriginal,r.originals.bodyOriginal,r.originals.scopeOriginal,r.originals.requestDigest,r.originals.agentExpectedOriginal};
 const size_t caps[]={16384,16384,1048576,65536,64,65536};Snapshot copy;
 for(size_t i=0;i<copy.size();++i){if(parts[i].bytes>caps[i]||(!parts[i].data&&parts[i].bytes)||(i!=2&&!parts[i].bytes))return {true,invalid};if(parts[i].bytes)copy[i].assign(parts[i].data,parts[i].data+parts[i].bytes);}
 if(auto rc=ynx::auth::ai::mobile::signingCaptureSourceCurrentOriginal(p.capture))return {true,rc};
 auto late=ynx::auth::ai::mobile::signingCaptureSourceFailureOriginal(p.capture);if(late.present)return {true,late.code};out=std::move(copy);return {};
}
Failure phase(YNXMobileRegisteredPhaseV2 s){
 if(s.failure.present)return {true,s.failure.code};if(s.version!=2||s.size!=sizeof(s)||s.phase!=YNX_MOBILE_REGISTERED_READY_V2)return {true,pending};return {};
}
Failure accountSnapshot(OriginalReview&p,std::vector<std::string>&out){
 auto f=phase(ynx_mobile_pq_registered_account_current_v2(p.account));if(f.present)return f;
 YNXMobilePQSelectedOriginalDATA d{};d.version=1;d.size=sizeof(d);f=phase(ynx_mobile_pq_registered_account_read_v2(p.account,&d));if(f.present)return f;
 if(d.version!=1||d.size!=sizeof(d)||d.mode!=2)return {true,invalid};
 const YNXMobileSelectedPublicSpan values[]={d.reference,d.original_operation_id,d.network_id,d.account,d.platform,d.application_id,d.protected_resource_ref,d.native_chain_id,d.vault_revision,d.registration_digest,d.key_version,d.execution_height,d.nonce,d.spending_budget_original_digest};
 std::vector<std::string>copy;for(auto v:values)copy.push_back(v.length?bytesText(v.bytes,v.length):std::string());
 if(copy[2].empty()||copy[3].empty()||copy[4]!="android"||copy[5]!="com.ynxweb4.ai"||copy[10].empty())return {true,invalid};
 f=phase(ynx_mobile_pq_registered_account_current_v2(p.account));if(!f.present)out=std::move(copy);return f;
}
Failure current(OriginalReview&p,YNXAIMobileSigningCapture*c,bool needApproved){
 if(p.actor!=std::this_thread::get_id())return {true,wrongActor};if(p.first.present)return p.first;
 if(p.capture!=c||p.retired||p.closed)return note(p,{true,cancelled});
 auto installed=p.installation->current();if(installed.present)return note(p,{true,installed.code});
 Snapshot now;auto f=snapshot(p,now);if(f.present)return note(p,f);if(now!=p.originals)return note(p,{true,invalid});
 std::vector<std::string>account;f=accountSnapshot(p,account);if(f.present)return note(p,f);if(account!=p.accountOriginal)return note(p,{true,invalid});
 const auto choice=p.decision.load();if(choice==denied)return note(p,{true,rejected});if(choice==cancel)return note(p,{true,cancelled});
 if(needApproved&&choice!=approved)return {true,pending};return {};
}
std::string display(OriginalReview&);
bool isUIThread();
void choose(const std::shared_ptr<OriginalReview>&p,Decision choice){int expected=waiting;p->decision.compare_exchange_strong(expected,choice);p->wake.notify_all();}
void showUI(const std::shared_ptr<OriginalReview>&);
void dismissUI(const std::shared_ptr<OriginalReview>&);
Result drain(OriginalReview&p){
 if(p.actor!=std::this_thread::get_id())return {{true,wrongActor},false};
 if(!p.uiDone||p.uiWork.load())return {p.first.present?p.first:p.cleanup,false};
 if(p.account&&!p.accountClosed){auto r=ynx_mobile_pq_registered_account_join_v2(p.account);if(r.first_failure.present)note(p,{true,r.first_failure.code});if(r.cleanup_failure.present)cleanup(p,{true,r.cleanup_failure.code});p.accountClosed=r.physical_done==1;}
 if(p.account&&!p.accountClosed)return {p.first.present?p.first:p.cleanup,false};
 if(p.account&&!p.accountReleased){auto f=ynx_mobile_pq_registered_account_release_closed_v2(p.account);if(f.present){cleanup(p,{true,f.code});return {p.cleanup,false};}p.accountReleased=true;p.account=nullptr;}
 if(p.installation&&!p.installationClosed){bool done=false;auto f=p.installation->close(done);if(f.present)cleanup(p,{true,f.code});p.installationClosed=done;}
 if(p.installation&&!p.installationClosed)return {p.first.present?p.first:p.cleanup,false};
 p.closed=true;return {p.first.present?p.first:p.cleanup,true};
}
}
Acquisition acquireOriginalProtectedReview(YNXAIMobileSigningCapture*c)noexcept {
 std::shared_ptr<OriginalReview>p;try{
  p=std::make_shared<OriginalReview>();p->capture=c;{std::lock_guard<std::mutex>lock(ownersMutex);if(owners.size()>=32||nextID==UINT64_MAX)return {nullptr,{true,pending}};p->id=nextID++;owners.emplace(p.get(),p);}
  if(isUIThread())return {p.get(),note(*p,{true,wrongActor})};
  auto installed=ynx::sdk::mobileapplication::InstalledApplicationOriginal::acquire(p->installation);if(installed.present)return {p.get(),note(*p,{true,installed.code})};if(!p->installation)return {p.get(),note(*p,{true,invalid})};
  auto f=snapshot(*p,p->originals);if(f.present)return {p.get(),note(*p,f)};
  auto initial=ynx_mobile_pq_registered_account_acquire_v2(&p->account);f=phase(initial);if(!p->account&&!f.present)f={true,invalid};if(f.present)return {p.get(),note(*p,f)};
  f=accountSnapshot(*p,p->accountOriginal);if(f.present)return {p.get(),note(*p,f)};p->presentation=display(*p);
  p->uiDone=false;showUI(p);
  while(p->decision.load()==waiting&&!p->retired){std::unique_lock<std::mutex>lock(p->waitMutex);p->wake.wait_for(lock,std::chrono::milliseconds(250));lock.unlock();f=current(*p,c,false);if(f.present){choose(p,cancel);dismissUI(p);return {p.get(),f};}}
  f=current(*p,c,true);return {p.get(),f};
 }catch(...){return {p.get(),p?note(*p,{true,invalid}):Failure{true,invalid}};}
}
Failure currentOriginalProtectedReview(OriginalReview*raw,YNXAIMobileSigningCapture*c)noexcept {try{auto p=known(raw);return p?current(*p,c,true):Failure{true,invalid};}catch(...){return {true,invalid};}}
Failure claimOriginalProtectedReview(OriginalReview*raw,YNXAIMobileSigningCapture*c)noexcept {try{auto p=known(raw);if(!p)return {true,invalid};if(p->actor!=std::this_thread::get_id())return {true,wrongActor};if(p->claimSelected)return {true,invalid};p->claimSelected=true;return current(*p,c,true);}catch(...){return {true,invalid};}}
void retireOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p)return;p->retired=true;choose(p,cancel);if(!p->uiDone&&!p->dismissRequested.exchange(true))dismissUI(p);}catch(...){}}
Result closeOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p)return {{true,invalid},false};if(p->actor!=std::this_thread::get_id())return {{true,wrongActor},false};
 if(!p->closeSelected){p->closeSelected=true;retireOriginalProtectedReview(raw);if(p->account){auto f=ynx_mobile_pq_registered_account_retire_v2(p->account);if(f.present)cleanup(*p,{true,f.code});auto d=ynx_mobile_pq_registered_account_close_v2(p->account);if(d.first_failure.present)note(*p,{true,d.first_failure.code});if(d.cleanup_failure.present)cleanup(*p,{true,d.cleanup_failure.code});p->accountClosed=d.physical_done==1;}}
 return drain(*p);}catch(...){return {{true,invalid},false};}}
Result joinOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p)return {{true,invalid},false};if(!p->closeSelected)return closeOriginalProtectedReview(raw);return drain(*p);}catch(...){return {{true,invalid},false};}}
Result releaseClosedOriginalProtectedReview(OriginalReview*raw)noexcept {try{auto p=known(raw);if(!p||p->actor!=std::this_thread::get_id())return {{true,invalid},false};if(!p->closed||!p->uiDone||p->uiWork.load())return {p->first.present?p->first:p->cleanup,false};auto result=Result{p->first.present?p->first:p->cleanup,true};{std::lock_guard<std::mutex>lock(ownersMutex);owners.erase(raw);}return result;}catch(...){return {{true,invalid},false};}}
}

namespace ynx::platform::ai::review {namespace {
JavaVM*machine=nullptr;jclass viewClass=nullptr;std::mutex bindMutex;
struct Environment {
 JNIEnv*env=nullptr;bool attached=false,frame=false;
 Environment(){std::lock_guard<std::mutex>lock(bindMutex);if(!machine||!viewClass)return;auto rc=machine->GetEnv(reinterpret_cast<void**>(&env),JNI_VERSION_1_6);if(rc==JNI_EDETACHED){attached=machine->AttachCurrentThread(&env,nullptr)==JNI_OK;if(!attached)env=nullptr;}else if(rc!=JNI_OK)env=nullptr;if(env){frame=env->PushLocalFrame(32)==JNI_OK;if(!frame){if(env->ExceptionCheck())env->ExceptionClear();if(attached)machine->DetachCurrentThread();attached=false;env=nullptr;}}}
 ~Environment(){if(frame&&env)env->PopLocalFrame(nullptr);if(attached)machine->DetachCurrentThread();}
 bool error(){if(env&&env->ExceptionCheck()){env->ExceptionClear();return true;}return false;}
 jmethodID method(const char*name,const char*signature){if(!env)return nullptr;auto m=env->GetStaticMethodID(viewClass,name,signature);return error()?nullptr:m;}
};
bool isUIThread(){Environment e;auto m=e.method("isUIThreadNative","()Z");if(!m)throw invalid;auto result=e.env->CallStaticBooleanMethod(viewClass,m);if(e.error())throw invalid;return result==JNI_TRUE;}
std::string display(OriginalReview&p){
 Environment e;auto m=e.method("presentationNative","([[B)Ljava/lang/String;");if(!m)throw invalid;
 auto type=e.env->FindClass("[B");if(e.error()||!type)throw invalid;auto values=e.env->NewObjectArray(9,type,nullptr);e.env->DeleteLocalRef(type);if(e.error()||!values)throw invalid;
 std::array<Bytes,9>fields={p.originals[0],p.originals[2],p.originals[4],p.originals[5]};
 const size_t indices[]={3,10,2,5,4};for(size_t i=0;i<5;++i)fields[4+i].assign(p.accountOriginal[indices[i]].begin(),p.accountOriginal[indices[i]].end());
 bool failed=false;for(size_t i=0;i<fields.size();++i){auto b=e.env->NewByteArray(static_cast<jsize>(fields[i].size()));if(e.error()||!b){failed=true;break;}if(!fields[i].empty())e.env->SetByteArrayRegion(b,0,static_cast<jsize>(fields[i].size()),reinterpret_cast<const jbyte*>(fields[i].data()));e.env->SetObjectArrayElement(values,static_cast<jsize>(i),b);e.env->DeleteLocalRef(b);if(e.error()){failed=true;break;}}
 if(failed){e.env->DeleteLocalRef(values);throw invalid;}auto result=static_cast<jstring>(e.env->CallStaticObjectMethod(viewClass,m,values));e.env->DeleteLocalRef(values);if(e.error()||!result){if(result)e.env->DeleteLocalRef(result);throw invalid;}
 // This private presentation string is round-tripped in JNI modified UTF-8.
 // Signed originals/digests remain the byte-exact Snapshot, never this text.
 auto chars=e.env->GetStringUTFChars(result,nullptr);if(e.error()||!chars){e.env->DeleteLocalRef(result);throw invalid;}
 std::string text;try{text=chars;}catch(...){e.env->ReleaseStringUTFChars(result,chars);e.env->DeleteLocalRef(result);throw;}e.env->ReleaseStringUTFChars(result,chars);e.env->DeleteLocalRef(result);return text;
}
void showUI(const std::shared_ptr<OriginalReview>&p){
 Environment e;auto m=e.method("showNative","(JLjava/lang/String;)V");if(!m)throw invalid;auto text=e.env->NewStringUTF(p->presentation.c_str());if(e.error()||!text)throw invalid;
 p->uiWork++;p->showOutstanding=true;e.env->CallStaticVoidMethod(viewClass,m,static_cast<jlong>(p->id),text);e.env->DeleteLocalRef(text);
 if(e.error()){if(p->showOutstanding.exchange(false))p->uiWork--;p->uiDone=true;choose(p,cancel);throw invalid;}
}
void dismissUI(const std::shared_ptr<OriginalReview>&p){Environment e;auto m=e.method("dismissNative","(J)V");if(!m)return;e.env->CallStaticVoidMethod(viewClass,m,static_cast<jlong>(p->id));e.error();}
}}
extern "C" JNIEXPORT void JNICALL Java_com_ynxweb4_ai_NativeProtectedReview_bindNativeClass(JNIEnv*env,jclass actual){
 using namespace ynx::platform::ai::review;
 std::lock_guard<std::mutex>lock(bindMutex);if(viewClass){if(!env->IsSameObject(viewClass,actual)){auto error=env->FindClass("java/lang/IllegalStateException");if(error)env->ThrowNew(error,"AI_PROTECTED_REVIEW_CLASS_CHANGED");}return;}
 JavaVM*vm=nullptr;if(env->GetJavaVM(&vm)!=JNI_OK)return;auto held=static_cast<jclass>(env->NewGlobalRef(actual));if(!held)return;machine=vm;viewClass=held;
}
extern "C" JNIEXPORT void JNICALL Java_com_ynxweb4_ai_NativeProtectedReview_recordNativeEvent(JNIEnv*,jclass,jlong id,jint event){
 using namespace ynx::platform::ai::review;std::shared_ptr<OriginalReview>p;
 {std::lock_guard<std::mutex>lock(ownersMutex);for(const auto&entry:owners)if(entry.second->id==static_cast<uint64_t>(id)){p=entry.second;break;}}
 if(!p)return;
 if(event==4||event==5){if(p->showOutstanding.exchange(false))p->uiWork--;}
 if(event==1&&!p->retired)choose(p,approved);else if(event==2)choose(p,denied);else if(event==3)choose(p,cancel);
 else if(event==5){choose(p,cancel);p->uiDone=true;}p->wake.notify_all();
}
