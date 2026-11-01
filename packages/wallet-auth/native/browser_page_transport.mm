#import "browser_page_transport_private.h"
#import "browser_page_borrow_private.h"
#import "BrowserOriginalPageReadoutIPC.h"
#import <Security/Security.h>
#include <time.h>
#include <unistd.h>
#include <mutex>
#include <condition_variable>
#include <memory>
#include <chrono>

// Uses the actual original P05 header, not a new frame/portable codec.

static uint64_t mono() { struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t);
    return uint64_t(t.tv_sec)*1000000000ULL+uint64_t(t.tv_nsec); }
struct Flight { std::mutex mu; std::condition_variable cv; bool done=false;
    int32_t code=YNX_BROWSER_PENDING; __strong NSData *body=nil;
    void finish(int32_t c,NSData *b) { std::lock_guard<std::mutex> l(mu);
        if(done)return; code=c; body=b?[b copy]:nil; done=true; cv.notify_all(); }
};
struct State { std::mutex mu; bool retired=false, invalidated=false, closed=false, invalidateSelected=false;
    int32_t first=0; size_t active=0; uint64_t deadline=0; pid_t pid=0; uid_t uid=0;
    __strong NSData *request=nil; __strong NSString *requirement=nil;
    __strong NSXPCConnection *connection=nil; std::shared_ptr<Flight> flight;
    void failLocked(int32_t c) { if(!first)first=c; retired=true; }
};
struct Activity { std::shared_ptr<State>s; bool entered=false;
    explicit Activity(std::shared_ptr<State>q):s(q){std::lock_guard<std::mutex>l(s->mu);
        if(!s->retired&&!s->closed){++s->active;entered=true;}}
    ~Activity(){if(entered){std::lock_guard<std::mutex>l(s->mu);--s->active;}}
};
@interface YNXBrowserPageTransport () { std::shared_ptr<State> _state; }
@end

static int32_t peerCurrent(const std::shared_ptr<State>&s) {
    // Per-message requirement is additionally enforced by NSXPC. Dynamic code
    // lookup is exact registered incarnation, not an identifier supplied by DATA.
    NSDictionary *attrs=@{(__bridge NSString*)kSecGuestAttributePid:@(s->pid)};
    SecCodeRef code=nullptr; SecRequirementRef req=nullptr;
    OSStatus a=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)attrs,
        kSecCSDefaultFlags,&code);
    OSStatus b=SecRequirementCreateWithString((__bridge CFStringRef)s->requirement,
        kSecCSDefaultFlags,&req);
    OSStatus c=(a==errSecSuccess&&b==errSecSuccess&&code&&req)?
        SecCodeCheckValidity(code,kSecCSStrictValidate,req):errSecCSInvalidObjectRef;
    if(req)CFRelease(req); if(code)CFRelease(code);
    if(c!=errSecSuccess)return YNX_BROWSER_MISMATCH;
    // pid/uid of the actual endpoint connection is rechecked once connected;
    // the dynamic guest check above is not itself proof of endpoint ownership.
    pid_t p=s->connection.processIdentifier;
    if(p!=0&&(p!=s->pid||s->connection.effectiveUserIdentifier!=s->uid))
        return YNX_BROWSER_MISMATCH;
    return YNX_BROWSER_OK;
}

@implementation YNXBrowserPageTransport
- (instancetype)initWithOriginalEndpoint:(NSXPCListenerEndpoint *)endpoint
    process:(pid_t)pid user:(uid_t)uid identifier:(NSString *)identifier
    codeDirectoryHash:(NSString *)cdhash originalRequest:(NSData *)request
    monotonicDeadline:(uint64_t)deadline {
    self=[super init]; if(!self)return nil;
    _state=std::make_shared<State>(); auto s=_state;
    s->pid=pid;s->uid=uid;s->deadline=deadline;s->request=[request copy];
    NSRegularExpression *idRE=[NSRegularExpression regularExpressionWithPattern:
        @"^[A-Za-z0-9][A-Za-z0-9.-]{1,191}$" options:0 error:nil];
    NSRegularExpression *hashRE=[NSRegularExpression regularExpressionWithPattern:
        @"^([a-f0-9]{40}|[a-f0-9]{64})$" options:0 error:nil];
    if(!endpoint||pid<=1||uid!=geteuid()||!identifier||!cdhash||
       ![idRE numberOfMatchesInString:identifier options:0 range:NSMakeRange(0,identifier.length)]||
       ![hashRE numberOfMatchesInString:cdhash options:0 range:NSMakeRange(0,cdhash.length)]||
       !request.length||request.length>32768||deadline<=mono()||deadline-mono()>5000000000ULL){
        s->failLocked(YNX_BROWSER_INVALID);return self;
    }
    s->requirement=[NSString stringWithFormat:@"identifier \"%@\" and cdhash H\"%@\"",identifier,cdhash];
    s->connection=[[NSXPCConnection alloc]initWithListenerEndpoint:endpoint];
    s->connection.remoteObjectInterface=[NSXPCInterface interfaceWithProtocol:@protocol(YNXBrowserOriginalPageReadoutIPC)];
    [s->connection setCodeSigningRequirement:s->requirement];
    std::weak_ptr<State> weak=s;
    s->connection.invalidationHandler=^{if(auto q=weak.lock()){
        std::shared_ptr<Flight> f; {std::lock_guard<std::mutex>l(q->mu);
            q->invalidated=true;q->failLocked(YNX_BROWSER_TRANSPORT); f=q->flight;}
        if(f)f->finish(YNX_BROWSER_TRANSPORT,nil);
    }};
    s->connection.interruptionHandler=^{if(auto q=weak.lock()){
        {std::lock_guard<std::mutex>l(q->mu);q->failLocked(YNX_BROWSER_TRANSPORT);}
        [q->connection invalidate];
    }};
    [s->connection resume]; return self;
}
- (int32_t)current {
    auto s=_state; if(!s)return YNX_BROWSER_INVALID;
    Activity activity(s);if(!activity.entered){std::lock_guard<std::mutex>l(s->mu);return s->first?:YNX_BROWSER_RETIRED;}
    {std::lock_guard<std::mutex>l(s->mu);
        if(s->retired||s->closed)return s->first?:YNX_BROWSER_RETIRED;
        if(mono()>=s->deadline){s->failLocked(YNX_BROWSER_RETIRED);return s->first;}}
    int32_t c=peerCurrent(s);
    {std::lock_guard<std::mutex>l(s->mu);
        if(c)s->failLocked(c);
        if(s->retired||mono()>=s->deadline){s->failLocked(YNX_BROWSER_RETIRED);return s->first;}}
    return 0;
}
- (int32_t)copyOriginalRequest:(NSData **)out {
    if(!out)return YNX_BROWSER_INVALID; int32_t c=[self current];if(c)return c;
    NSData *copy=[_state->request copy]; c=[self current];if(c)return c;
    *out=copy;return 0;
}
- (int32_t)readOriginal:(NSData *)request result:(NSData **)out {
    if(!out||!request||!request.length||request.length>32768)return YNX_BROWSER_INVALID;
    auto s=_state;Activity activity(s);if(!activity.entered)return YNX_BROWSER_RETIRED;
    int32_t c=[self current];if(c)return c;
    auto f=std::make_shared<Flight>();
    {std::lock_guard<std::mutex>l(s->mu);
        if(s->retired)return s->first?:YNX_BROWSER_RETIRED;
        if(![request isEqualToData:s->request])return YNX_BROWSER_MISMATCH;
        if(s->flight)return YNX_BROWSER_BUSY;s->flight=f;}
    auto finish=[s,f](int32_t code,NSData *body){f->finish(code,body);};
    id<YNXBrowserOriginalPageReadoutIPC> proxy=[s->connection remoteObjectProxyWithErrorHandler:^(NSError *e){
        (void)e; finish(YNX_BROWSER_TRANSPORT,nil);
    }];
    [proxy readOriginalBrowserPageReadout:[request copy] withReply:^(NSData *body,NSString *error){
        if(error||!body.length){finish(YNX_BROWSER_TRANSPORT,nil);return;}
        if(body.length>262144){finish(YNX_BROWSER_LIMIT,nil);return;}
        finish(0,body);
    }];
    NSData *result=nil;
    {std::unique_lock<std::mutex>l(f->mu);
        while(!f->done&&mono()<s->deadline){f->cv.wait_for(l,std::chrono::milliseconds(10));}
        if(f->done){c=f->code;result=[f->body copy];}else c=YNX_BROWSER_PENDING;
    }
    if(c==YNX_BROWSER_PENDING){{std::lock_guard<std::mutex>l(s->mu);s->failLocked(c);}[self retire];return c;}
    {std::lock_guard<std::mutex>l(s->mu);if(s->flight==f)s->flight.reset();}
    if(c){{std::lock_guard<std::mutex>l(s->mu);s->failLocked(c);}[self retire];return c;}
    // No usable body on source expiry, revoke, retire or peer drift after reply.
    c=[self current];if(c)return c;
    if(s->connection.processIdentifier!=s->pid||s->connection.effectiveUserIdentifier!=s->uid){
        [self retire];return YNX_BROWSER_MISMATCH;}
    *out=result;return 0;
}
- (int32_t)retire {auto s=_state;if(!s)return YNX_BROWSER_INVALID;
    bool select=false;
    {std::lock_guard<std::mutex>l(s->mu);s->failLocked(YNX_BROWSER_RETIRED);
        if(!s->connection)s->invalidated=true;
        if(!s->invalidateSelected){s->invalidateSelected=true;select=true;}}
    if(select)[s->connection invalidate];return 0;}
- (int32_t)join {auto s=_state;if(!s)return YNX_BROWSER_INVALID;
    std::lock_guard<std::mutex>l(s->mu);
    if(s->active)return YNX_BROWSER_PENDING;
    if(s->flight){auto owned=s->flight;std::lock_guard<std::mutex>f(owned->mu);
        if(!owned->done)return YNX_BROWSER_PENDING;s->flight.reset();}
    return s->invalidated?0:YNX_BROWSER_PENDING;}
- (int32_t)close { [self retire];int32_t c=[self join];if(c)return c;
    auto s=_state;std::lock_guard<std::mutex>l(s->mu);s->closed=true;
    return 0;}
- (void)dealloc { [self retire]; }
@end

// This transport is NOT promoted to Source via a constructor/setter. The normal
// capture is deliberately closed until original Browser math+endpoint giver
// exists; no AI-mobile / IDE / Wallet namespace is substituted.
struct ynx_browser_page_borrow { __strong YNXBrowserPageTransport *child;
    bool closed=false; explicit ynx_browser_page_borrow(YNXBrowserPageTransport *c):child(c){} };
ynx_browser_page_borrow *YNXBrowserPageAdoptTransportChild(YNXBrowserPageTransport *child){
    return child?new ynx_browser_page_borrow(child):nullptr;}
extern "C" int32_t ynx_browser_page_borrow_capture_original_v1(ynx_browser_page_borrow **out){
    if(!out)return YNX_BROWSER_INVALID;*out=nullptr;return YNX_BROWSER_NOT_SUPPLIED;}
extern "C" int32_t ynx_browser_page_borrow_current_v1(ynx_browser_page_borrow *p){return p?[p->child current]:YNX_BROWSER_INVALID;}
static int32_t outputSpan(uint8_t*out,size_t cap,size_t*n){
    if(!out||!n||!cap||cap>262144)return YNX_BROWSER_LIMIT;
    uintptr_t a=(uintptr_t)out,b=(uintptr_t)n;
    if(cap>UINTPTR_MAX-a||sizeof(*n)>UINTPTR_MAX-b|| (a<b+sizeof(*n)&&b<a+cap))return YNX_BROWSER_INVALID;
    return 0;
}
static int32_t publish(NSData *d,uint8_t*out,size_t cap,size_t*n){
    int32_t c=outputSpan(out,cap,n);if(c)return c;
    if(d.length>cap)return YNX_BROWSER_LIMIT;
    memcpy(out,d.bytes,d.length);*n=d.length;return 0;}
extern "C" int32_t ynx_browser_page_borrow_request_v1(ynx_browser_page_borrow *p,uint8_t*out,size_t cap,size_t*n){
    if(!p)return YNX_BROWSER_INVALID;int32_t c=outputSpan(out,cap,n);if(c)return c;
    NSData*d=nil;c=[p->child copyOriginalRequest:&d];
    return c?c:publish(d,out,cap,n);}
extern "C" int32_t ynx_browser_page_borrow_read_v1(ynx_browser_page_borrow *p,const uint8_t*r,size_t z,uint8_t*out,size_t cap,size_t*n){
    if(!p||!r||!z||z>32768)return YNX_BROWSER_INVALID;
    int32_t c=outputSpan(out,cap,n);if(c)return c;
    uintptr_t a=(uintptr_t)r,b=(uintptr_t)out,w=(uintptr_t)n;
    if(z>UINTPTR_MAX-a||(a<b+cap&&b<a+z)||(a<w+sizeof(*n)&&w<a+z))return YNX_BROWSER_INVALID;
    NSData*d=nil;c=[p->child readOriginal:[NSData dataWithBytes:r length:z] result:&d];
    return c?c:publish(d,out,cap,n);}
extern "C" int32_t ynx_browser_page_borrow_retire_v1(ynx_browser_page_borrow *p){return p?[p->child retire]:YNX_BROWSER_INVALID;}
extern "C" int32_t ynx_browser_page_borrow_join_v1(ynx_browser_page_borrow *p){return p?[p->child join]:YNX_BROWSER_INVALID;}
extern "C" int32_t ynx_browser_page_borrow_close_v1(ynx_browser_page_borrow *p){
    if(!p)return YNX_BROWSER_INVALID;int32_t c=[p->child close];if(!c)p->closed=true;return c;}
extern "C" int32_t ynx_browser_page_borrow_destroy_v1(ynx_browser_page_borrow **p){
    if(!p)return YNX_BROWSER_INVALID;if(!*p)return 0;
    if(!(*p)->closed)return YNX_BROWSER_PENDING;delete *p;*p=nullptr;return 0;}
