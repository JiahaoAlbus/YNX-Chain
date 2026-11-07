#include "SourceParentProfileCPrivate.h"
#include "SourceParentOriginalProfilePrivate.hpp"
#include <mutex>
#include <map>
#include <thread>
#include <cstring>
namespace {using namespace ynx::auth::sourceparent;struct Entry{std::thread::id actor=std::this_thread::get_id();std::shared_ptr<OriginalSourceParentImageProfile>owner;ProfileFailure first{};bool released=false;};std::mutex mutex;std::map<uintptr_t,std::shared_ptr<Entry>>inventory;uintptr_t next=1;
ynx_sourceparent_profile_failure_v1 output(ProfileFailure f){return{f.present?1u:0u,f.code,f.systemError};}
std::shared_ptr<Entry>get(ynx_sourceparent_profile_owner_v1*o){std::lock_guard<std::mutex>lock(mutex);auto i=inventory.find(uintptr_t(o));if(i==inventory.end()||i->second->released||i->second->actor!=std::this_thread::get_id())return{};return i->second;}
template<class F>ynx_sourceparent_profile_acquisition_v1 capture(F call){ynx_sourceparent_profile_acquisition_v1 out{};std::shared_ptr<Entry>e;try{e=std::make_shared<Entry>();{std::lock_guard<std::mutex>lock(mutex);if(next==UINTPTR_MAX)return{nullptr,{1,int32_t(ProfileCode::Pending),0}};auto token=next++;inventory.emplace(token,e);out.owner=reinterpret_cast<ynx_sourceparent_profile_owner_v1*>(token);}auto a=call();e->owner=a.owner;e->first=a.failure;out.failure=output(a.failure);return out;}catch(...){out.failure={1,int32_t(ProfileCode::IO),0};if(e)e->first={true,out.failure.code,0};return out;}}
ynx_sourceparent_profile_failure_v1 invalid(){return{1,int32_t(ProfileCode::WrongActor),0};}
}
extern "C" ynx_sourceparent_profile_acquisition_v1 ynx_sourceparent_profile_acquire_parent_original_v1(){return capture(ynx::auth::sourceparent::acquireOriginalSourceParentParentProfile);}
extern "C" ynx_sourceparent_profile_acquisition_v1 ynx_sourceparent_profile_acquire_core_original_v1(){return capture(ynx::auth::sourceparent::acquireOriginalSourceParentCoreProfile);}
extern "C" ynx_sourceparent_profile_acquisition_v1 ynx_sourceparent_profile_acquire_native_original_v1(){return capture(ynx::auth::sourceparent::acquireOriginalSourceParentNativeProfile);}
extern "C" ynx_sourceparent_profile_failure_v1 ynx_sourceparent_profile_current_original_v1(ynx_sourceparent_profile_owner_v1*o){auto e=get(o);if(!e)return invalid();if(e->first.present)return output(e->first);if(!e->owner)return invalid();auto f=e->owner->current();if(f.present)e->first=f;return output(f);}
extern "C" ynx_sourceparent_profile_failure_v1 ynx_sourceparent_profile_read_original_v1(ynx_sourceparent_profile_owner_v1*o,ynx_sourceparent_profile_images_v1*out){auto e=get(o);if(!e||!out||out->version!=1||out->size!=sizeof(*out))return invalid();if(e->first.present)return output(e->first);ProfileImages images;auto f=e->owner->readOriginalImagesDATA(images);if(f.present){e->first=f;return output(f);}auto candidate=*out;std::memcpy(candidate.images[0],images.parentCreator.data(),32);std::memcpy(candidate.images[1],images.coreChild.data(),32);std::memcpy(candidate.images[2],images.nativeChild.data(),32);*out=candidate;return{};}
extern "C" void ynx_sourceparent_profile_retire_original_v1(ynx_sourceparent_profile_owner_v1*o){auto e=get(o);if(e&&e->owner)e->owner->retire();}
extern "C" ynx_sourceparent_profile_drain_v1 ynx_sourceparent_profile_close_original_v1(ynx_sourceparent_profile_owner_v1*o){auto e=get(o);if(!e)return{invalid(),0};if(!e->owner)return{output(e->first),1};bool done=false;auto f=e->owner->close(done);if(!e->first.present&&f.present)e->first=f;return{output(e->first),done?1u:0u};}
extern "C" ynx_sourceparent_profile_failure_v1 ynx_sourceparent_profile_release_closed_original_v1(ynx_sourceparent_profile_owner_v1*o){auto e=get(o);if(!e)return invalid();if(e->owner&&!e->owner->isClosed())return{1,int32_t(ProfileCode::Pending),0};e->owner.reset();std::lock_guard<std::mutex>lock(mutex);e->released=true;return{};}// token tombstone never reused
