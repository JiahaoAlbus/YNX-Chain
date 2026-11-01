#include "original-http-v5-registered-private.h"
#include <pthread.h>
#include <thread>
#include <stdexcept>
namespace ynx_auth_private {
struct OriginalHTTPV5RegisteredReadLease::State{
 YNXAuthIdentitySourceAuthority*__strong source=nil;NSDictionary*__strong original=nil;
 HTTPV5RegisteredOriginalView view;std::thread::id actor=std::this_thread::get_id();
 bool counted=false,retired=false,closed=false,closeSelected=false,closeResult=false,failed=false;
};
static std::string HTTPV5Text(id v){if(![v isKindOfClass:NSString.class])throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_STRING");NSData*b=[v dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||b.length>65536)throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_BOUND");return std::string((const char*)b.bytes,b.length);}
static unsigned HTTPV5Nibble(char c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_HEX");}
OriginalHTTPV5RegisteredReadLease::OriginalHTTPV5RegisteredReadLease(YNXAuthIdentitySourceAuthority*s):state_(std::make_unique<State>()){state_->source=s;}
void OriginalHTTPV5RegisteredReadLease::assertCurrent(){auto&s=*state_;try{@try{if(s.failed||s.retired||s.closed||!pthread_main_np()||s.actor!=std::this_thread::get_id()||[s.source class]!=YNXAuthIdentitySourceAuthority.class)throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_RETIRED");NSError*e=nil;if(![s.source assertOriginalProductSessionHTTPProofV5SourceCurrent:&e]||e)throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_CURRENT");NSDictionary*c=[s.source copyOriginalProductSessionHTTPProofV5RegisteredContext:&e];if(!c||e||(s.original&&![s.original isEqual:c]))throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_CHANGED");if(!s.original){s.original=c;s.view.registrationOriginal=HTTPV5Text(c[@"registrationOriginal"]);s.view.sessionOriginal=HTTPV5Text(c[@"sessionOriginal"]);s.view.context=c[@"context"];s.view.expiresAtMs=[c[@"scope"][@"expiresAtMs"]unsignedLongLongValue];auto&i=s.view.sameItem;i.network=HTTPV5Text(c[@"scope"][@"networkId"]);i.persistentRef=HTTPV5Text(c[@"persistentRef"]);i.osIdentity=HTTPV5Text(c[@"osIdentity"]);i.account=HTTPV5Text(c[@"sameItemAccount"]);i.operation=HTTPV5Text(c[@"sameItemOperation"]);i.metadata=HTTPV5Text(c[@"sameItemMetadata"]);auto a=HTTPV5Text(c[@"scope"][@"pkA"]),b=HTTPV5Text(c[@"scope"][@"pkB"]);if(a.size()!=i.publicPair.pa.size()*2||b.size()!=i.publicPair.pb.size()*2)throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_PAIR");for(size_t n=0;n<i.publicPair.pa.size();n++)i.publicPair.pa[n]=(HTTPV5Nibble(a[n*2])<<4)|HTTPV5Nibble(a[n*2+1]);for(size_t n=0;n<i.publicPair.pb.size();n++)i.publicPair.pb[n]=(HTTPV5Nibble(b[n*2])<<4)|HTTPV5Nibble(b[n*2+1]);}if(![s.source assertOriginalProductSessionHTTPProofV5SourceCurrent:&e]||e)throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_POST_CURRENT");return;}@catch(id){throw std::runtime_error("HTTP_V5_NATIVE_REGISTERED_EXCEPTION");}}catch(...){s.failed=true;throw;}}
const HTTPV5RegisteredOriginalView&OriginalHTTPV5RegisteredReadLease::readOriginalRegisteredView(){assertCurrent();return state_->view;}
void OriginalHTTPV5RegisteredReadLease::retire()noexcept{state_->retired=true;}
bool OriginalHTTPV5RegisteredReadLease::close()noexcept{auto&s=*state_;s.retired=true;if(s.closed)return s.closeResult;if(s.closeSelected)return false;s.closeSelected=true;if(!pthread_main_np()||s.actor!=std::this_thread::get_id())return false;@try{if(s.counted){[s.source releaseOriginalHTTPV5RegisteredChild];s.counted=false;}s.source=nil;s.original=nil;s.view=HTTPV5RegisteredOriginalView{};s.closed=true;return s.closeResult=true;}@catch(id){return false;}}
OriginalHTTPV5RegisteredReadLease::~OriginalHTTPV5RegisteredReadLease(){if(!close()){static thread_local std::vector<std::unique_ptr<State>>debts;debts.push_back(std::move(state_));}}
std::shared_ptr<OriginalHTTPV5RegisteredReadLease>borrowOriginalHTTPV5RegisteredReadLease(YNXAuthIdentitySourceAuthority*source,NSError**error){
 // Retain typed partial BEFORE admission/OS/current calls. On failure caller
 // owns this nonnull child and its no-IO close even if NSError is nonnull.
 auto p=std::shared_ptr<OriginalHTTPV5RegisteredReadLease>(new OriginalHTTPV5RegisteredReadLease(source));
 try{@try{NSError*e=nil;if([source class]!=YNXAuthIdentitySourceAuthority.class||![source retainOriginalHTTPV5RegisteredChild:&e]||e){if(error)*error=e?:[NSError errorWithDomain:@"YNXHTTPV5NativeRegistered" code:1 userInfo:@{NSLocalizedDescriptionKey:@"HTTP_V5_NATIVE_REGISTERED_SOURCE_REQUIRED"}];return p;}p->state_->counted=true;p->assertCurrent();return p;}@catch(id){}}
 catch(...){ }p->state_->failed=true;if(error&&!*error)*error=[NSError errorWithDomain:@"YNXHTTPV5NativeRegistered" code:1 userInfo:@{NSLocalizedDescriptionKey:@"HTTP_V5_NATIVE_REGISTERED_NOT_CURRENT"}];return p;
}
}
