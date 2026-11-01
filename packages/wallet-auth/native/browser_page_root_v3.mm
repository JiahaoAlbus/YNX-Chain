#include "browser_page_root_private_v3.h"
#include "browser_page_request_native_private_v2.hpp"
#import "browser_page_source_private.h"
#include <mutex>
#include <memory>
#include <chrono>
#include <algorithm>
#include <time.h>
namespace {
static uint64_t mono(){timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return uint64_t(t.tv_sec)*1000000000ULL+uint64_t(t.tv_nsec);}
struct Root {
 std::mutex mu,call;YNXAuthIdentitySourceAuthority*__strong source=nil;
 NSDictionary*__strong context=nil;NSError*__strong cause=nil;
 size_t active=0,children=0;bool retired=false,closed=false;int32_t first=0,closeCause=0;
 uint64_t until=0;
 ~Root(){if(source&&!closed)std::terminate();} // never silently drop Source debt
 int32_t fail(int32_t c,NSError*e=nil){std::lock_guard<std::mutex>l(mu);if(!first)first=c;
  if(!cause&&e)cause=e;retired=true;return first;}
 int32_t current(){
  {std::lock_guard<std::mutex>l(mu);if(first)return first;if(retired||closed||!source)return YNX_BROWSER_RETIRED;
   if(mono()>=until){first=YNX_BROWSER_RETIRED;retired=true;return first;}++active;}
  int32_t c=0;NSError*e=nil;
  try{@autoreleasepool{@try{
   std::lock_guard<std::mutex>serial(call);
   {std::lock_guard<std::mutex>l(mu);if(first||retired)c=first?:YNX_BROWSER_RETIRED;}
   // This original getter itself runs the actual full mathematical Current;
   // do not repeat the same network/crypto merely to construct a DATA copy.
   NSDictionary*now=c?nil:[source copyOriginalBrowserSelectedPagesContext:&e];
   if(!c&&(e||!now||![now[@"scope"]isEqual:context[@"scope"]]||![now[@"sourceId"]isEqual:context[@"sourceId"]]||
      ![now[@"instanceId"]isEqual:context[@"instanceId"]]||![now[@"subjectOwner"]isEqual:context[@"subjectOwner"]]||
      ![now[@"profileDigest"]isEqual:context[@"profileDigest"]]))c=YNX_BROWSER_MISMATCH;
  }@catch(NSException*){c=YNX_BROWSER_INVALID;}}}catch(...){c=YNX_BROWSER_INVALID;}
  {std::lock_guard<std::mutex>l(mu);--active;
   if(c&&!first)first=c;if(e&&!cause)cause=e;
   if(c||retired||mono()>=until){retired=true;if(!first)first=YNX_BROWSER_RETIRED;return first;}}
  return 0;
 }
};
class ActualParent final:public ynx::browser::page::OriginalParentCurrent {
 std::shared_ptr<Root>root;
public:
 explicit ActualParent(std::shared_ptr<Root>r):root(std::move(r)){}
 int32_t current_original()noexcept override{try{return root->current();}catch(...){return root->fail(YNX_BROWSER_INVALID);}}
 ~ActualParent(){[root->source releaseOriginalBrowserSelectedPagesParent];
  std::lock_guard<std::mutex>l(root->mu);--root->children;}
};
static bool ms(id v,uint64_t&n){if(![v isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)v)==CFBooleanGetTypeID())return false;
 double d=[v doubleValue];if(d<0||d>9007199254740991.0||d!=double([v unsignedLongLongValue]))return false;n=[v unsignedLongLongValue];return true;}
}
struct ynx_browser_page_root_v3{std::shared_ptr<Root>state;};
extern "C" int32_t ynx_browser_page_root_acquire_original_v3(ynx_browser_page_root_v3**out){
 if(!out)return YNX_BROWSER_INVALID;if(*out)return YNX_BROWSER_BUSY;
 try{@autoreleasepool{@try{
  auto s=std::make_shared<Root>();auto handle=new ynx_browser_page_root_v3{s};*out=handle;
  NSError*e=nil;s->source=[YNXAuthIdentitySourceAuthority acquireOriginalBrowserSelectedPagesSource:&e];
  if(e||!s->source)return s->fail(YNX_BROWSER_NOT_SUPPLIED,e);
  s->context=[s->source copyOriginalBrowserSelectedPagesContext:&e];
  if(e||!s->context)return s->fail(YNX_BROWSER_MISMATCH,e);
  uint64_t until=0,current=0,now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(!ms(s->context[@"scope"][@"untilMs"],until)||!ms(s->context[@"expiresAtMs"],current)||until<=now||current<=now)
   return s->fail(YNX_BROWSER_RETIRED);
  // Original finite observation; never refreshed by subsequent full math.
  s->until=mono()+1000000ULL*std::min({until-now,current-now,uint64_t(5000)});
  return s->current();
 }@catch(NSException*){if(*out)return (*out)->state->fail(YNX_BROWSER_INVALID);return YNX_BROWSER_INVALID;}}}
 catch(...){if(*out)return (*out)->state->fail(YNX_BROWSER_INVALID);return YNX_BROWSER_INVALID;}
}
extern "C" int32_t ynx_browser_page_root_current_v3(ynx_browser_page_root_v3*p){return p?p->state->current():YNX_BROWSER_INVALID;}
extern "C" int32_t ynx_browser_page_root_read_deadline_v3(ynx_browser_page_root_v3*p,uint64_t*out){
 if(!p||!out)return YNX_BROWSER_INVALID;
 uintptr_t a=(uintptr_t)out,b=(uintptr_t)p,s=(uintptr_t)p->state.get();
 if(sizeof(*out)>UINTPTR_MAX-a||(a<b+sizeof(*p)&&b<a+sizeof(*out))||
    (a<s+sizeof(Root)&&s<a+sizeof(*out)))return YNX_BROWSER_INVALID;
 int32_t c=p->state->current();if(c)return c;
 std::lock_guard<std::mutex>l(p->state->mu);
 if(p->state->first||p->state->retired||mono()>=p->state->until)return p->state->first?:YNX_BROWSER_RETIRED;
 *out=p->state->until;return 0;
}
NSDictionary*YNXCopyOriginalBrowserPageRootContextV3(ynx_browser_page_root_v3*p,NSError**error){
 if(!p)return nil;auto s=p->state;int32_t c=s->current();
 if(c){if(error)*error=s->cause?:[NSError errorWithDomain:@"YNXOriginalBrowserSource" code:c userInfo:nil];return nil;}
 NSDictionary*out=[s->context copy];c=s->current();
 if(c){if(error)*error=s->cause?:[NSError errorWithDomain:@"YNXOriginalBrowserSource" code:c userInfo:nil];return nil;}return out;
}
extern "C" int32_t ynx_browser_page_root_borrow_parent_v3(ynx_browser_page_root_v3*p,ynx_browser_page_parent_v2**out){
 if(!out||!p)return YNX_BROWSER_INVALID;
 uintptr_t a=(uintptr_t)out,b=(uintptr_t)p,r=(uintptr_t)p->state.get();
 if(sizeof(*out)>UINTPTR_MAX-a||(a<b+sizeof(*p)&&b<a+sizeof(*out))||
    (a<r+sizeof(Root)&&r<a+sizeof(*out)))return YNX_BROWSER_INVALID;
 if(*out)return YNX_BROWSER_BUSY;auto s=p->state;
 int32_t c=s->current();if(c)return c;
 try{@autoreleasepool{@try{
  std::lock_guard<std::mutex>serial(s->call);NSError*e=nil;
  NSDictionary*ctx=[s->source retainOriginalBrowserSelectedPagesParent:&e];
  if(!ctx)return s->fail(YNX_BROWSER_MISMATCH,e);
  // Adopt the actual counted Source loan before any late validation/error.
  {std::lock_guard<std::mutex>l(s->mu);++s->children;}
  std::shared_ptr<ActualParent>actual;
  try{actual=std::make_shared<ActualParent>(s);}catch(...){[s->source releaseOriginalBrowserSelectedPagesParent];
    {std::lock_guard<std::mutex>l(s->mu);--s->children;}return s->fail(YNX_BROWSER_INVALID);}
  *out=ynx::browser::page::retain_original_parent_for_request_data(actual);
  if(!*out)return s->fail(YNX_BROWSER_INVALID);
  if(e)return s->fail(YNX_BROWSER_MISMATCH,e);
  if(![ctx[@"scope"]isEqual:s->context[@"scope"]]||![ctx[@"profileDigest"]isEqual:s->context[@"profileDigest"]])return s->fail(YNX_BROWSER_MISMATCH);
 }@catch(NSException*){return s->fail(YNX_BROWSER_INVALID);}}}catch(...){return s->fail(YNX_BROWSER_INVALID);}
 return s->current();
}
extern "C" int32_t ynx_browser_page_root_retire_v3(ynx_browser_page_root_v3*p){if(!p)return YNX_BROWSER_INVALID;
 std::lock_guard<std::mutex>l(p->state->mu);p->state->retired=true;return 0;}
extern "C" ynx_browser_page_drain_v2 ynx_browser_page_root_close_v3(ynx_browser_page_root_v3*p){
 if(!p)return{YNX_BROWSER_INVALID,0};auto s=p->state;(void)ynx_browser_page_root_retire_v3(p);
 {std::lock_guard<std::mutex>l(s->mu);if(s->closed)return{s->first?:s->closeCause,1};
  if(s->active||s->children){if(!s->closeCause)s->closeCause=YNX_BROWSER_PENDING;return{s->first?:s->closeCause,0};}}
 try{@try{std::lock_guard<std::mutex>serial(s->call);NSError*e=nil;BOOL done=!s->source||[s->source closeOriginalBrowserSelectedPagesSource:&e];
  {std::lock_guard<std::mutex>l(s->mu);if(e&&!s->cause)s->cause=e;if(!done&&!s->closeCause)s->closeCause=YNX_BROWSER_PENDING;
   if(done)s->closed=true;return{s->first?:s->closeCause,done?1u:0u};}
 }@catch(NSException*){std::lock_guard<std::mutex>l(s->mu);if(!s->closeCause)s->closeCause=YNX_BROWSER_INVALID;return{s->first?:s->closeCause,0};}}
 catch(...){std::lock_guard<std::mutex>l(s->mu);if(!s->closeCause)s->closeCause=YNX_BROWSER_INVALID;return{s->first?:s->closeCause,0};}
}
extern "C" int32_t ynx_browser_page_root_destroy_v3(ynx_browser_page_root_v3**p){if(!p)return YNX_BROWSER_INVALID;if(!*p)return 0;
 {std::lock_guard<std::mutex>l((*p)->state->mu);if(!(*p)->state->closed||(*p)->state->active||(*p)->state->children)return YNX_BROWSER_PENDING;}
 delete *p;*p=nullptr;return 0;
}
