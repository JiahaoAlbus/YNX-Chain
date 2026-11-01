#include "browser_page_request_native_private_v2.hpp"
#import "browser_page_transport_private.h"
#include <mutex>
#include <cstring>
#include <array>
#include <new>

namespace {
struct Parent { std::mutex mu,call; std::shared_ptr<ynx::browser::page::OriginalParentCurrent> original;
    size_t active=0,children=0; int32_t first=0; bool released=false;
};
struct Request { std::mutex mu; std::shared_ptr<Parent> parent;
    __strong YNXBrowserPageTransport *child=nil;
    __strong NSData *raw=nil,*preparation=nil,*profile=nil;
    size_t active=0; int32_t first=0; bool retired=false,joined=false,closed=false;
};
static int32_t remember(const std::shared_ptr<Request>&s,int32_t e){
    if(e){std::lock_guard<std::mutex>l(s->mu);if(!s->first)s->first=e;}return e;
}
static int32_t parentCurrent(const std::shared_ptr<Parent>&p){
    if(!p)return YNX_BROWSER_INVALID;
    {std::lock_guard<std::mutex>l(p->mu);if(p->first)return p->first;
        if(p->released||!p->original)return YNX_BROWSER_RETIRED;++p->active;}
    int32_t code;{std::lock_guard<std::mutex>serial(p->call);
        {std::lock_guard<std::mutex>l(p->mu);code=p->first;}
        if(!code)code=p->original->current_original();}
    {std::lock_guard<std::mutex>l(p->mu);--p->active;
        if(code&&!p->first)p->first=code;
        if(p->first)return p->first;if(p->released)return YNX_BROWSER_RETIRED;}
    return 0;
}
struct Activity {std::shared_ptr<Request>s;bool admitted=false;
    explicit Activity(std::shared_ptr<Request>r):s(r){std::lock_guard<std::mutex>l(s->mu);
        if(!s->retired&&!s->closed&&!s->first){++s->active;admitted=true;}}
    ~Activity(){if(admitted){std::lock_guard<std::mutex>l(s->mu);--s->active;}}
};
static int32_t current(const std::shared_ptr<Request>&s){
    {std::lock_guard<std::mutex>l(s->mu);if(s->first)return s->first;
        if(s->retired||s->closed)return YNX_BROWSER_RETIRED;}
    int32_t c=parentCurrent(s->parent);if(c)return remember(s,c);
    c=[s->child current];if(c)return remember(s,c);
    c=parentCurrent(s->parent);if(c)return remember(s,c);
    {std::lock_guard<std::mutex>l(s->mu);if(s->first)return s->first;
        if(s->retired||s->closed)return YNX_BROWSER_RETIRED;}
    return 0;
}
struct Span{uintptr_t start;size_t size;};
static bool overlaps(Span a,Span b){return a.start<b.start+b.size&&b.start<a.start+a.size;}
static bool valid(Span a){return a.start&&a.size&&a.size<=UINTPTR_MAX-a.start;}
static bool ownedOutput(const std::shared_ptr<Request>&s,Span a){
    std::array<Span,5>owned={Span{(uintptr_t)s.get(),sizeof(Request)},
        Span{(uintptr_t)s->parent.get(),sizeof(Parent)},Span{(uintptr_t)s->raw.bytes,s->raw.length},
        Span{(uintptr_t)s->preparation.bytes,s->preparation.length},Span{(uintptr_t)s->profile.bytes,s->profile.length}};
    for(Span o:owned)if(o.size&&overlaps(a,o))return true;return false;
}
static int32_t outputSpans(const ynx_browser_page_request_output_v2 *o,
    const void *owner,size_t ownerSize,const std::shared_ptr<Request>&s){
    if(!o||!o->raw_cap||o->raw_cap>32768||!o->preparation_cap||o->preparation_cap>1024||
        !o->profile_cap||o->profile_cap>1024)return YNX_BROWSER_INVALID;
    std::array<Span,6>a={Span{(uintptr_t)o->raw,o->raw_cap},Span{(uintptr_t)o->preparation,o->preparation_cap},
        Span{(uintptr_t)o->profile,o->profile_cap},Span{(uintptr_t)o->raw_written,sizeof(size_t)},
        Span{(uintptr_t)o->preparation_written,sizeof(size_t)},Span{(uintptr_t)o->profile_written,sizeof(size_t)}};
    Span descriptor{(uintptr_t)o,sizeof(*o)},inventory{(uintptr_t)owner,ownerSize};
    for(size_t i=0;i<a.size();i++){if(!valid(a[i])||overlaps(a[i],descriptor)||overlaps(a[i],inventory)||ownedOutput(s,a[i]))return YNX_BROWSER_INVALID;
        for(size_t j=0;j<i;j++)if(overlaps(a[i],a[j]))return YNX_BROWSER_INVALID;}
    return 0;
}
static NSData *identifier(NSString *s){
    if(![s isKindOfClass:NSString.class]||!s.length||
        [s rangeOfCharacterFromSet:[NSCharacterSet characterSetWithRange:NSMakeRange(0,1)]].location!=NSNotFound)return nil;
    NSData*b=[s dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
    return b.length&&b.length<=1024?[b copy]:nil;
}
}
struct ynx_browser_page_parent_v2{std::shared_ptr<Parent> state;};
struct ynx_browser_page_request_v2{std::shared_ptr<Request> state;};

namespace ynx::browser::page {
ynx_browser_page_parent_v2 *retain_original_parent_for_request_data(std::shared_ptr<OriginalParentCurrent>p)noexcept{
    if(!p)return nullptr;
    try{auto s=std::make_shared<Parent>();s->original=std::move(p);return new ynx_browser_page_parent_v2{s};}
    catch(...){return nullptr;}
}
int32_t assemble_original_request_data(ynx_browser_page_parent_v2*p,YNXBrowserPageTransport*child,
    NSData*raw,NSString*prep,NSString*profile,ynx_browser_page_request_v2**out)noexcept{
    if(!out)return YNX_BROWSER_INVALID;
    *out=nullptr;if(!child)return YNX_BROWSER_INVALID;
    try{
        auto s=std::make_shared<Request>();s->parent=p?p->state:nullptr;s->child=child;
        auto owned=new ynx_browser_page_request_v2{s};
        if(s->parent){std::lock_guard<std::mutex>l(s->parent->mu);++s->parent->children;}
        *out=owned; // adopt actual child/parent BEFORE validating any later value
        if(!s->parent)return remember(s,YNX_BROWSER_NOT_SUPPLIED);
        int32_t c=parentCurrent(s->parent);if(c)return remember(s,c);
        if(![raw isKindOfClass:NSData.class]||!raw.length||raw.length>32768||
            ![[NSString alloc]initWithData:raw encoding:NSUTF8StringEncoding])return remember(s,YNX_BROWSER_INVALID);
        s->raw=[raw copy];s->preparation=identifier(prep);s->profile=identifier(profile);
        if(!s->preparation||!s->profile)return remember(s,YNX_BROWSER_INVALID);
        NSData*childRaw=nil;c=[child copyOriginalRequest:&childRaw];if(c)return remember(s,c);
        if(![childRaw isEqualToData:s->raw])return remember(s,YNX_BROWSER_MISMATCH);
        return remember(s,current(s));
    }catch(...){if(*out)return remember((*out)->state,YNX_BROWSER_INVALID);return YNX_BROWSER_INVALID;}
}
}
extern "C" int32_t ynx_browser_page_capture_original_v2(ynx_browser_page_request_v2**out,ynx_browser_page_parent_v2**parent){
    if(!out||!parent||reinterpret_cast<void*>(out)==reinterpret_cast<void*>(parent))return YNX_BROWSER_INVALID;
    *out=nullptr;*parent=nullptr;return YNX_BROWSER_NOT_SUPPLIED;
}
extern "C" int32_t ynx_browser_page_parent_current_v2(ynx_browser_page_parent_v2*p){return p?parentCurrent(p->state):YNX_BROWSER_INVALID;}
extern "C" int32_t ynx_browser_page_parent_destroy_v2(ynx_browser_page_parent_v2**p){
    if(!p)return YNX_BROWSER_INVALID;if(!*p)return 0;
    {std::lock_guard<std::mutex>l((*p)->state->mu);if((*p)->state->active||(*p)->state->children)return YNX_BROWSER_PENDING;
        (*p)->state->released=true;}
    delete *p;*p=nullptr;return 0;
}
extern "C" int32_t ynx_browser_page_request_current_v2(ynx_browser_page_request_v2*p){
    if(!p)return YNX_BROWSER_INVALID;Activity a(p->state);if(!a.admitted){std::lock_guard<std::mutex>l(p->state->mu);return p->state->first?:YNX_BROWSER_RETIRED;}
    return current(p->state);
}
extern "C" int32_t ynx_browser_page_original_request_data_v2(ynx_browser_page_request_v2*p,const ynx_browser_page_request_output_v2*output){
    if(!p)return YNX_BROWSER_INVALID;int32_t c=outputSpans(output,p,sizeof(*p),p->state);if(c)return c;
    const auto o=*output;auto s=p->state;Activity a(s);if(!a.admitted){std::lock_guard<std::mutex>l(s->mu);return s->first?:YNX_BROWSER_RETIRED;}
    c=current(s);if(c)return c;
    NSData*raw=[s->raw copy],*prep=[s->preparation copy],*profile=[s->profile copy];
    if(raw.length>o.raw_cap||prep.length>o.preparation_cap||profile.length>o.profile_cap)return YNX_BROWSER_LIMIT;
    c=current(s);if(c)return c;
    std::lock_guard<std::mutex>l(s->mu);if(s->retired||s->closed||s->first)return s->first?:YNX_BROWSER_RETIRED;
    memcpy(o.raw,raw.bytes,raw.length);memcpy(o.preparation,prep.bytes,prep.length);memcpy(o.profile,profile.bytes,profile.length);
    *o.raw_written=raw.length;*o.preparation_written=prep.length;*o.profile_written=profile.length;return 0;
}
extern "C" int32_t ynx_browser_page_request_read_v2(ynx_browser_page_request_v2*p,const uint8_t*raw,size_t bytes,uint8_t*out,size_t cap,size_t*written){
    if(!p||!raw||!bytes||bytes>32768||!out||!cap||cap>262144||!written)return YNX_BROWSER_INVALID;
    Span r{(uintptr_t)raw,bytes},o{(uintptr_t)out,cap},w{(uintptr_t)written,sizeof(*written)},i{(uintptr_t)p,sizeof(*p)};
    if(!valid(r)||!valid(o)||!valid(w)||overlaps(r,o)||overlaps(r,w)||overlaps(o,w)||overlaps(o,i)||overlaps(w,i)||ownedOutput(p->state,o)||ownedOutput(p->state,w))return YNX_BROWSER_INVALID;
    auto s=p->state;Activity a(s);if(!a.admitted){std::lock_guard<std::mutex>l(s->mu);return s->first?:YNX_BROWSER_RETIRED;}
    int32_t c=current(s);if(c)return c;
    NSData*request=[NSData dataWithBytes:raw length:bytes];if(![request isEqualToData:s->raw])return YNX_BROWSER_MISMATCH;
    NSData*result=nil;c=[s->child readOriginal:request result:&result];if(c)return remember(s,c);
    if(result.length>cap)return YNX_BROWSER_LIMIT;c=current(s);if(c)return c;
    std::lock_guard<std::mutex>l(s->mu);if(s->retired||s->closed||s->first)return s->first?:YNX_BROWSER_RETIRED;
    memcpy(out,result.bytes,result.length);*written=result.length;return 0;
}
extern "C" int32_t ynx_browser_page_request_retire_v2(ynx_browser_page_request_v2*p){
    if(!p)return YNX_BROWSER_INVALID;bool select=false;auto s=p->state;
    {std::lock_guard<std::mutex>l(s->mu);if(!s->retired){s->retired=true;select=true;}}
    if(select){int32_t c=[s->child retire];if(c)return remember(s,c);}return 0;
}
extern "C" ynx_browser_page_drain_v2 ynx_browser_page_request_join_v2(ynx_browser_page_request_v2*p){
    if(!p)return{YNX_BROWSER_INVALID,0};auto s=p->state;
    {std::lock_guard<std::mutex>l(s->mu);if(s->active)return{s->first,0};if(s->joined)return{s->first,1};}
    int32_t c=[s->child join];std::lock_guard<std::mutex>l(s->mu);
    if(c==YNX_BROWSER_PENDING)return{s->first,0};if(c&&!s->first)s->first=c;
    if(!c)s->joined=true;return{s->first,s->joined?1u:0u};
}
extern "C" ynx_browser_page_drain_v2 ynx_browser_page_request_close_v2(ynx_browser_page_request_v2*p){
    if(!p)return{YNX_BROWSER_INVALID,0};(void)ynx_browser_page_request_retire_v2(p);
    auto joined=ynx_browser_page_request_join_v2(p);if(!joined.completed)return joined;
    auto s=p->state;{std::lock_guard<std::mutex>l(s->mu);if(s->closed)return{s->first,1};}
    int32_t c=[s->child close];std::lock_guard<std::mutex>l(s->mu);
    if(c==YNX_BROWSER_PENDING)return{s->first,0};if(c&&!s->first)s->first=c;
    if(!c)s->closed=true;return{s->first,s->closed?1u:0u};
}
extern "C" int32_t ynx_browser_page_request_destroy_v2(ynx_browser_page_request_v2**p){
    if(!p)return YNX_BROWSER_INVALID;if(!*p)return 0;auto s=(*p)->state;
    {std::lock_guard<std::mutex>l(s->mu);if(!s->closed||s->active)return YNX_BROWSER_PENDING;}
    if(s->parent){std::lock_guard<std::mutex>l(s->parent->mu);--s->parent->children;}
    delete *p;*p=nullptr;return 0;
}
