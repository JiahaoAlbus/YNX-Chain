#import "desktop-grant-native-private.h"
#include "desktop-grant-qualification-private.hpp"
#include <atomic>
#include <chrono>
#include <mutex>
#include <vector>
#include <algorithm>
namespace ynx::auth::desktopgrant {
struct Qualification::Impl {
 YNXAuthIdentitySourceAuthority*__strong source=nil;
 NSDictionary*__strong context=nil;
 std::mutex mutex;std::atomic<bool>retired{false};std::atomic<int32_t>first{0};
 std::atomic<int64_t>deadline{0};bool closed=false,close_selected=false;std::string cause;
 static int64_t mono(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
 int32_t fail(const char*c){int32_t z=0;if(first.compare_exchange_strong(z,1))cause=c?c:"DESKTOP_GRANT_NATIVE_SOURCE_FAILURE";retired.store(true);return 1;}
 int32_t install(NSDictionary*c){if(first.load()||retired.load()||closed)return 1;
  if(!c||(context&&![context[@"scope"]isEqual:c[@"scope"]])||(context&&![context[@"sourceId"]isEqual:c[@"sourceId"]])||(context&&![context[@"instanceId"]isEqual:c[@"instanceId"]])||(context&&![context[@"profileDigest"]isEqual:c[@"profileDigest"]]))return fail("DESKTOP_GRANT_NATIVE_SCOPE_CHANGED");
  uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),until=[c[@"expiresAtMs"]unsignedLongLongValue];if(now>=until)return fail("DESKTOP_GRANT_NATIVE_SOURCE_EXPIRED");context=[c copy];deadline.store(mono()+(int64_t)std::min<uint64_t>(5000,until-now));return 0;
 }
};
Qualification::Qualification():impl_(std::make_unique<Impl>()){}
Qualification::~Qualification(){if(impl_&&!impl_->closed){impl_->retired.store(true);static auto*debt=new std::vector<std::unique_ptr<Impl>>;static auto*mutex=new std::mutex;std::lock_guard<std::mutex>l(*mutex);debt->push_back(std::move(impl_));}}
struct QualificationAccess {
 static Acquired acquire(const void*address)noexcept {Acquired out;try{@autoreleasepool{@try{
  out.owner=std::shared_ptr<Qualification>(new Qualification);auto&s=*out.owner->impl_;NSError*e=nil;s.source=[YNXAuthIdentitySourceAuthority acquireOriginalDesktopTaskGrantAuthoritySource:&e];
  if(e||!s.source||![s.source holdOriginalDesktopTaskGrantNativeAddress:address error:&e]||current(out.owner)){out.cause=e.localizedDescription.UTF8String?:"DESKTOP_GRANT_NATIVE_QUALIFICATION_NOT_SUPPLIED";s.fail(out.cause.c_str());return out;}out.error_present=false;return out;
 }@catch(NSException*){out.cause="DESKTOP_GRANT_NATIVE_QUALIFICATION_EXCEPTION";}}}catch(...){out.cause="DESKTOP_GRANT_NATIVE_QUALIFICATION_CPP_EXCEPTION";}if(out.owner)out.owner->impl_->fail(out.cause.c_str());return out;}
 static int32_t current(const std::shared_ptr<Qualification>&q)noexcept {if(!q)return 1;try{@autoreleasepool{@try{auto&s=*q->impl_;YNXAuthIdentitySourceAuthority*__strong source=nil;{std::lock_guard<std::mutex>l(s.mutex);if(s.first.load()||s.retired.load()||s.closed)return 1;source=s.source;}NSError*e=nil;NSDictionary*c=[source copyOriginalDesktopTaskGrantAuthorityContext:&e];{std::lock_guard<std::mutex>l(s.mutex);if(e||!c)return s.fail(e.localizedDescription.UTF8String?:"DESKTOP_GRANT_NATIVE_SOURCE_NOT_CURRENT");return s.install(c);}}@catch(NSException*){return q->impl_->fail("DESKTOP_GRANT_NATIVE_CURRENT_EXCEPTION");}}}catch(...){return q->impl_->fail("DESKTOP_GRANT_NATIVE_CURRENT_CPP_EXCEPTION");}}
 static int32_t observed(const std::shared_ptr<Qualification>&q)noexcept {if(!q)return 1;auto&s=*q->impl_;if(s.first.load()||s.retired.load()||Qualification::Impl::mono()>=s.deadline.load())return 1;return 0;}
 static int32_t json(const std::shared_ptr<Qualification>&q,const char*key,std::string&out)noexcept {if(!key||current(q))return 1;try{@autoreleasepool{@try{auto&s=*q->impl_;YNXAuthIdentitySourceAuthority*__strong source=nil;NSDictionary*__strong context=nil;{std::lock_guard<std::mutex>l(s.mutex);if(s.retired.load()||s.closed)return 1;source=s.source;context=s.context;}NSError*e=nil;NSDictionary*value=nil;std::string k(key);
  if(k=="scope")value=context[@"scope"];
  else if(k=="authority"){NSDictionary*c=context[@"scope"];value=@{@"sourceId":context[@"sourceId"],@"instanceId":context[@"instanceId"],@"authorityRef":c[@"authorityRef"],@"issuerAccount":c[@"issuerAccount"],@"issuerEpoch":c[@"issuerEpoch"],@"storeNamespace":c[@"storeNamespace"],@"storeResourceRef":c[@"storeResourceRef"],@"callerResourceRef":c[@"callerResourceRef"]};}
  else if(k=="caller")value=[source copyOriginalDesktopTaskGrantCallerRegistration:&e];
  else if(k=="link")value=[source copyOriginalDesktopTaskGrantLINKRegistration:&e];
  else if(k=="task-read-availability")value=[source copyOriginalDesktopTaskReadAvailability:&e];
  else if(k=="task-read-material")value=[source copyOriginalDesktopTaskReadMaterial:&e];
  else if(k=="task-read-peer")value=[source copyOriginalDesktopTaskReadPeer:&e];
  else if(k=="task-read-target")value=[source copyOriginalDesktopTaskReadTarget:&e];
  else return 1;
  NSData*raw=value?[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:&e]:nil;if(e||!raw||raw.length>65536)return s.fail("DESKTOP_GRANT_NATIVE_ORIGINAL_DATA_REQUIRED");std::string copy((const char*)raw.bytes,raw.length);if(current(q)||observed(q))return 1;out=std::move(copy);return 0;
 }@catch(NSException*){return q->impl_->fail("DESKTOP_GRANT_NATIVE_DATA_EXCEPTION");}}}catch(...){return q->impl_->fail("DESKTOP_GRANT_NATIVE_DATA_CPP_EXCEPTION");}}
 static int32_t module(const std::shared_ptr<Qualification>&q,bool link,std::string&out)noexcept {if(current(q))return 1;try{@autoreleasepool{@try{auto&s=*q->impl_;YNXAuthIdentitySourceAuthority*__strong source=nil;{std::lock_guard<std::mutex>l(s.mutex);if(s.retired.load()||s.closed)return 1;source=s.source;}NSError*e=nil;NSString*p=link?[source copyOriginalDesktopTaskGrantLINKModule:&e]:[source copyOriginalDesktopTaskGrantBootstrapModule:&e];if(e||!p.length||current(q))return s.fail("DESKTOP_GRANT_NATIVE_FIXED_MODULE_REQUIRED");out=p.UTF8String;return 0;}@catch(NSException*){return q->impl_->fail("DESKTOP_GRANT_NATIVE_MODULE_EXCEPTION");}}}catch(...){return q->impl_->fail("DESKTOP_GRANT_NATIVE_MODULE_CPP_EXCEPTION");}}
 static int32_t task_read_module(const std::shared_ptr<Qualification>&q,std::string&out)noexcept {if(current(q))return 1;try{@autoreleasepool{@try{auto&s=*q->impl_;YNXAuthIdentitySourceAuthority*__strong source=nil;{std::lock_guard<std::mutex>l(s.mutex);if(s.retired.load()||s.closed)return 1;source=s.source;}NSError*e=nil;NSString*p=[source copyOriginalDesktopTaskReadModule:&e];if(e||!p.length||current(q))return s.fail("DESKTOP_GRANT_NATIVE_FIXED_MODULE_REQUIRED");out=p.UTF8String;return 0;}@catch(NSException*){return q->impl_->fail("DESKTOP_GRANT_NATIVE_MODULE_EXCEPTION");}}}catch(...){return q->impl_->fail("DESKTOP_GRANT_NATIVE_MODULE_CPP_EXCEPTION");}}
 static int32_t task_read_continuation_module(const std::shared_ptr<Qualification>&q,std::string&out)noexcept {if(current(q))return 1;try{@autoreleasepool{@try{auto&s=*q->impl_;YNXAuthIdentitySourceAuthority*__strong source=nil;{std::lock_guard<std::mutex>l(s.mutex);if(s.retired.load()||s.closed)return 1;source=s.source;}NSError*e=nil;NSString*p=[source copyOriginalDesktopTaskReadContinuationModule:&e];if(e||!p.length)return 1;if(current(q))return 1;out=p.UTF8String;return 0;}@catch(NSException*){return q->impl_->fail("DESKTOP_GRANT_NATIVE_MODULE_EXCEPTION");}}}catch(...){return q->impl_->fail("DESKTOP_GRANT_NATIVE_MODULE_CPP_EXCEPTION");}}
 static void retire(const std::shared_ptr<Qualification>&q)noexcept {if(q){q->impl_->retired.store(true);@try{YNXAuthIdentitySourceAuthority*__strong source=nil;{std::lock_guard<std::mutex>l(q->impl_->mutex);source=q->impl_->source;}[source retire];}@catch(NSException*){}}}
 static int32_t join(const std::shared_ptr<Qualification>&q)noexcept {if(!q||!q->impl_->retired.load())return 1;NSError*e=nil;@try{YNXAuthIdentitySourceAuthority*__strong source=nil;{std::lock_guard<std::mutex>l(q->impl_->mutex);source=q->impl_->source;}return !source||[source join:&e]?0:1;}@catch(NSException*){return 1;}}
 static int32_t close(const std::shared_ptr<Qualification>&q)noexcept {if(!q)return 1;retire(q);if(join(q))return 1;auto&s=*q->impl_;try{@autoreleasepool{@try{YNXAuthIdentitySourceAuthority*__strong source=nil;{std::lock_guard<std::mutex>l(s.mutex);if(s.closed)return 0;if(s.close_selected)return 1;s.close_selected=true;source=s.source;}NSError*e=nil;if(source&&![source closeOriginalDesktopTaskGrantAuthority:&e])return 1;{std::lock_guard<std::mutex>l(s.mutex);s.source=nil;s.context=nil;s.closed=true;}return 0;}@catch(NSException*){return 1;}}}catch(...){return 1;}}
 static bool closed(const std::shared_ptr<Qualification>&q)noexcept {if(!q)return false;std::lock_guard<std::mutex>l(q->impl_->mutex);return q->impl_->closed;}
};
Acquired acquire_original_qualification(const void*a)noexcept{return QualificationAccess::acquire(a);}
int32_t qualification_current(const std::shared_ptr<Qualification>&q)noexcept{return QualificationAccess::current(q);}
int32_t qualification_observed_current(const std::shared_ptr<Qualification>&q)noexcept{return QualificationAccess::observed(q);}
int32_t qualification_json(const std::shared_ptr<Qualification>&q,const char*k,std::string&out)noexcept{return QualificationAccess::json(q,k,out);}
int32_t qualification_module(const std::shared_ptr<Qualification>&q,bool link,std::string&out)noexcept{return QualificationAccess::module(q,link,out);}
int32_t qualification_task_read_module(const std::shared_ptr<Qualification>&q,std::string&out)noexcept{return QualificationAccess::task_read_module(q,out);}
int32_t qualification_task_read_continuation_module(const std::shared_ptr<Qualification>&q,std::string&out)noexcept{return QualificationAccess::task_read_continuation_module(q,out);}
void qualification_retire(const std::shared_ptr<Qualification>&q)noexcept{QualificationAccess::retire(q);}
int32_t qualification_join(const std::shared_ptr<Qualification>&q)noexcept{return QualificationAccess::join(q);}
int32_t qualification_close(const std::shared_ptr<Qualification>&q)noexcept{return QualificationAccess::close(q);}
bool qualification_closed(const std::shared_ptr<Qualification>&q)noexcept{return QualificationAccess::closed(q);}
}
