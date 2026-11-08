#include "DeviceV4SourceBackendPrivate.hpp"
#include "DeviceV4AccountNamespacePrivate.h"
#include <algorithm>
#include <mutex>
#include <map>
#include <thread>
#include <atomic>
#include <limits>
namespace ynx::auth::devicev4 {
Failure localFailure(int32_t c)noexcept{return{1,c,2,0};}
namespace {
struct Owner{std::thread::id actor=std::this_thread::get_id();std::shared_ptr<Backend>backend;Failure first{};std::atomic_bool retired{false};size_t refs=1,views=0;bool backendSelected=false,closeSelected=false,closed=false,released=false;Drain closeResult{};Failure fail(Failure f){retired=true;if(!first.present)first=f;return first;}};
struct View{std::shared_ptr<Owner>parent;Snapshot snapshot;Failure first{};uint64_t floor=0,deadline=0;bool released=false;};
std::mutex mutex;uintptr_t next=1;std::map<uintptr_t,std::shared_ptr<Owner>>owners;std::map<uintptr_t,std::shared_ptr<View>>views;
template<class T>auto find(const std::map<uintptr_t,std::shared_ptr<T>>&map,void*p){std::lock_guard<std::mutex>lock(mutex);auto i=map.find(uintptr_t(p));return i==map.end()?std::shared_ptr<T>{}:i->second;}
template<class T>void*insert(std::map<uintptr_t,std::shared_ptr<T>>&map,std::shared_ptr<T>v){std::lock_guard<std::mutex>lock(mutex);if(next==UINTPTR_MAX)return nullptr;auto n=next++;map.emplace(n,std::move(v));return reinterpret_cast<void*>(n);}
bool actor(const std::shared_ptr<Owner>&o){return o&&o->actor==std::this_thread::get_id();}
Failure localPost(const std::shared_ptr<Owner>&o){if(o->retired||o->closed||o->released)return o->fail(localFailure(Retired));return{};}
Failure current(const std::shared_ptr<Owner>&o){if(!actor(o))return localFailure(WrongActor);if(o->first.present)return o->first;if(auto f=localPost(o);f.present)return f;if(!o->backend)return o->fail(localFailure(NotSupplied));auto f=o->backend->current();if(f.present)return o->fail(f);return localPost(o);}
bool same(const Snapshot&a,const Snapshot&b){return a.expected==b.expected&&a.nullMask==b.nullMask&&a.context==b.context&&a.registration==b.registration&&a.session==b.session&&a.accountNamespace==b.accountNamespace;}
Failure viewCurrent(const std::shared_ptr<View>&v){if(!v||!actor(v->parent))return localFailure(WrongActor);if(v->first.present)return v->first;if(v->released)return localFailure(Closed);auto reject=[&](Failure f){if(!v->first.present)v->first=f;return v->first;};auto now=wallNow(),mono=monoNow();if(now<v->floor)return reject(localFailure(ClockRollback));if(now>=uint64_t(v->snapshot.expires)||mono>=v->deadline)return reject(localFailure(Expired));if(auto f=current(v->parent);f.present)return reject(f);
 Snapshot fresh;auto f=v->parent->backend->snapshot(fresh);if(f.present)return reject(v->parent->fail(f));if(!same(fresh,v->snapshot))return reject(localFailure(Changed));now=wallNow();mono=monoNow();if(now<v->floor)return reject(localFailure(ClockRollback));if(now>=uint64_t(v->snapshot.expires)||now>=uint64_t(fresh.expires)||mono>=v->deadline)return reject(localFailure(Expired));if(auto f=localPost(v->parent);f.present)return reject(f);v->floor=now;return{};}
Drain pending(const std::shared_ptr<Owner>&o){return{o->first.present?o->first:localFailure(Pending),0,0};}
}
ynx_auth_device_v4_acquisition_v1 reserveOriginalNativeOwner()noexcept{try{auto o=std::make_shared<Owner>();auto*p=(ynx_auth_device_v4_source_v1*)insert(owners,o);return{p,p?Failure{}:localFailure(Capacity)};}catch(...){return{nullptr,localFailure(Exception)};}}
ynx_auth_device_v4_acquisition_v1 completeOriginalNativeOwner(ynx_auth_device_v4_source_v1*p,BackendAcquisition a)noexcept{auto o=find(owners,p);if(!actor(o)||o->backendSelected||o->released||o->retired)return{nullptr,localFailure(Arguments)};o->backendSelected=true;o->backend=a.owner;o->first=a.failure;if(!a.owner&&!o->first.present)o->first=localFailure(NotSupplied);o->retired=o->first.present;return{p,o->first};}
}
using namespace ynx::auth::devicev4;
extern "C" ynx_auth_device_v4_acquisition_v1 ynx_auth_device_v4_source_acquire_original_v1(){auto r=reserveOriginalNativeOwner();if(!r.owner)return r;return completeOriginalNativeOwner(r.owner,acquireOriginalBackend());}
extern "C" ynx_auth_device_v4_acquisition_v1 ynx_auth_device_v4_source_retain_v1(ynx_auth_device_v4_source_v1*p){auto o=find(owners,p);if(!actor(o)||o->released||o->refs==SIZE_MAX)return{nullptr,localFailure(Reference)};++o->refs;return{p,o->first};}
extern "C" ynx_auth_device_v4_reference_release_v1 ynx_auth_device_v4_source_release_reference_v1(ynx_auth_device_v4_source_v1*p){auto o=find(owners,p);if(!actor(o)||o->released||o->refs<2)return{localFailure(Reference),0};--o->refs;return{o->first,1};}
extern "C" ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_source_current_v1(ynx_auth_device_v4_source_v1*p){return current(find(owners,p));}
extern "C" ynx_auth_device_v4_view_acquisition_v1 ynx_auth_device_v4_source_open_view_v1(ynx_auth_device_v4_source_v1*p){auto o=find(owners,p);if(auto f=current(o);f.present)return{nullptr,f};ynx_auth_device_v4_view_v1*token=nullptr;std::shared_ptr<View>v;try{if(o->views>=256)return{nullptr,localFailure(Capacity)};v=std::make_shared<View>();v->parent=o;token=(ynx_auth_device_v4_view_v1*)insert(views,v);if(!token)return{nullptr,localFailure(Capacity)};++o->views;
 auto f=o->backend->snapshot(v->snapshot);if(f.present){v->first=o->fail(f);return{token,v->first};}const auto now=wallNow(),mono=monoNow();if(v->snapshot.issued<0||v->snapshot.expires<=v->snapshot.issued||now<uint64_t(v->snapshot.issued)||now>=uint64_t(v->snapshot.expires)||uint64_t(v->snapshot.expires)-now>UINT64_MAX-mono){v->first=localFailure(Expired);return{token,v->first};}v->floor=now;v->deadline=mono+uint64_t(v->snapshot.expires)-now;f=viewCurrent(v);return{token,f};
 }catch(...){const auto f=localFailure(Exception);if(token&&v)v->first=o->fail(f);return{token,f};}}
extern "C" ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_view_current_v1(ynx_auth_device_v4_view_v1*p){return viewCurrent(find(views,p));}
extern "C" ynx_auth_device_v4_namespace_match_v1 ynx_auth_device_v4_view_match_account_namespace_v1(ynx_auth_device_v4_view_v1*p,ynx_auth_device_v4_bytes_v1 issuer,ynx_auth_device_v4_bytes_v1 subject){
 if(!issuer.bytes||!subject.bytes||!issuer.length||issuer.length>2048||!subject.length||subject.length>2048||std::find(issuer.bytes,issuer.bytes+issuer.length,0)!=issuer.bytes+issuer.length||std::find(subject.bytes,subject.bytes+subject.length,0)!=subject.bytes+subject.length)return{localFailure(Arguments),0};
 auto v=find(views,p);if(auto f=viewCurrent(v);f.present)return{f,0};const auto&n=v->snapshot.accountNamespace;if(!n.present||n.issuer.empty()||n.subject.empty()||n.sourceId.empty()||n.instanceId.empty()||!n.generation)return{localFailure(NotSupplied),0};
 bool matches=issuer.length==n.issuer.size()&&subject.length==n.subject.size()&&std::equal(n.issuer.begin(),n.issuer.end(),issuer.bytes)&&std::equal(n.subject.begin(),n.subject.end(),subject.bytes);
 if(auto f=viewCurrent(v);f.present)return{f,0};return{{},matches?1u:0u};
}
extern "C" ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_view_read_original_v1(ynx_auth_device_v4_view_v1*p,ynx_auth_device_v4_view_data_v1*out){auto v=find(views,p);if(!out||out->version!=1||out->size!=sizeof(*out))return localFailure(Arguments);if(auto f=viewCurrent(v);f.present)return f;ynx_auth_device_v4_view_data_v1 candidate{};candidate.version=1;candidate.size=sizeof(candidate);const auto&s=v->snapshot;candidate.null_mask=s.nullMask;for(unsigned i=0;i<17;++i)candidate.expected[i]={s.expected[i].data(),s.expected[i].size()};candidate.context_original={s.context.data(),s.context.size()};candidate.registration_original={s.registration.data(),s.registration.size()};candidate.session_original={s.session.data(),s.session.size()};candidate.not_before_ms=s.issued;candidate.expires_ms=s.expires;if(auto f=viewCurrent(v);f.present)return f;*out=candidate;return{};}
extern "C" ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_view_release_v1(ynx_auth_device_v4_view_v1*p){auto v=find(views,p);if(!v||!actor(v->parent))return{localFailure(WrongActor),0,0};if(!v->released){v->released=true;--v->parent->views;v->snapshot={};}return{v->first,0,1};}
extern "C" void ynx_auth_device_v4_source_request_retire_v1(ynx_auth_device_v4_source_v1*p){auto o=find(owners,p);if(o)o->retired=true;}
extern "C" ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_join_v1(ynx_auth_device_v4_source_v1*p){auto o=find(owners,p);if(!actor(o)||o->released)return{localFailure(WrongActor),0,0};o->retired=true;if(o->refs!=1||o->views)return pending(o);if(!o->backend)return{o->first,0,1};auto d=o->backend->join();if(d.failure.present&&!o->first.present)o->first=d.failure;d.failure=o->first;return d;}
extern "C" ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_close_v1(ynx_auth_device_v4_source_v1*p){auto o=find(owners,p);if(!actor(o)||o->released)return{localFailure(WrongActor),0,0};o->retired=true;if(o->closeSelected)return o->closeResult;if(o->refs!=1||o->views)return pending(o);auto j=ynx_auth_device_v4_source_join_v1(p);if(!j.physical_done)return j;o->closeSelected=true;auto d=o->backend?o->backend->close():Drain{o->first,0,1};if(d.failure.present&&!o->first.present)o->first=d.failure;d.failure=o->first;o->closed=d.physical_done;o->closeResult=d;return d;}
extern "C" ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_release_closed_v1(ynx_auth_device_v4_source_v1*p){auto o=find(owners,p);if(!actor(o)||o->released||!o->closed||o->refs!=1||o->views)return{localFailure(Pending),0,0};o->backend.reset();o->released=true;return{o->first,0,1};}
