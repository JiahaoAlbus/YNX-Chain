#include "DeviceV4SourceDarwinPrivate.hpp"
#include <thread>
#include <limits>
#include <cstdlib>
#include <pthread.h>
#include <cmath>
namespace ynx::auth::devicev4 {
namespace {
Failure cause(NSError*e,int32_t fallback){if(!e)return localFailure(fallback);const auto n=(int64_t)e.code;return{1,n>=INT32_MIN&&n<=INT32_MAX?(int32_t)n:Exception,1,n};}
Bytes bytes(NSData*b){const auto*p=(const uint8_t*)b.bytes;return b.length?Bytes(p,p+b.length):Bytes{};}
bool text(id v,Bytes&out,size_t cap){if(![v isKindOfClass:NSString.class])return false;NSData*b=[v dataUsingEncoding:NSUTF8StringEncoding];if(!b||!b.length||b.length>cap)return false;out=bytes(b);return true;}
}
struct Backend::Impl {YNXAuthIdentitySourceAuthority*__strong source=nil;id __strong token=nil;bool owned=true,tokenReleaseSelected=false,tokenReleased=false,closeSelected=false,closed=false;Failure first{};Drain closedResult{};Failure fail(Failure f){if(!first.present)first=f;return first;}};
Backend::Backend():p_(new Impl){}Backend::~Backend(){if(!p_->closed)std::abort();}
Failure Backend::current()noexcept{if(p_->first.present)return p_->first;if(p_->closed||p_->tokenReleaseSelected||!p_->source||!p_->token)return p_->fail(localFailure(Retired));try{@try{NSError*e=nil;BOOL ok=[p_->source assertOriginalProductSessionDeviceV4SourceCurrent:&e];if(!ok||e)return p_->fail(cause(e,NotSupplied));return{};}@catch(id){return p_->fail(localFailure(Exception));}}catch(...){return p_->fail(localFailure(Exception));}}
Failure Backend::snapshot(Snapshot&out)noexcept{if(auto f=current();f.present)return f;try{@try{NSError*e=nil;uint64_t begin=0,end=0;NSDictionary*s=[p_->source copyOriginalDeviceV4NativeReadSnapshot:p_->token notBefore:&begin expires:&end error:&e];if(!s||e)return p_->fail(cause(e,Unavailable));
 Snapshot copy;NSDictionary*x=s[@"expected"],*c=s[@"context"];if(![s isKindOfClass:NSDictionary.class]||s.count!=5||![s[@"version"]isEqual:@"4"]||![x isKindOfClass:NSDictionary.class]||x.count!=17||![c isKindOfClass:NSDictionary.class]||c.count!=12||begin>INT64_MAX||end>INT64_MAX||end<=begin)return p_->fail(localFailure(Changed));
 const char*keys[]={"networkId","canonicalOwner","account","sessionBinding","productId","clientId","platform","applicationId","bundleId","packageId","origin","callback","deviceId","generation","registrationId","revision","registrationDigest"};
 for(unsigned i=0;i<17;++i){id v=x[[NSString stringWithUTF8String:keys[i]]];if(v==NSNull.null){if(i!=8&&i!=9)return p_->fail(localFailure(Changed));copy.nullMask|=1u<<i;}else if(!text(v,copy.expected[i],2048))return p_->fail(localFailure(Capacity));}
 NSData*context=[NSJSONSerialization dataWithJSONObject:c options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:&e];if(e||!context.length||context.length>16384||!text(s[@"registrationOriginal"],copy.registration,16384)||!text(s[@"sessionOriginal"],copy.session,16384))return p_->fail(cause(e,Capacity));copy.context=bytes(context);copy.issued=(int64_t)begin;copy.expires=(int64_t)end;
 NSDictionary*n=[p_->source copyOriginalDeviceV4AccountNamespaceForNativeRead:p_->token error:&e];if(e)return p_->fail(cause(e,Unavailable));if(n){auto&v=copy.accountNamespace;if(![n isKindOfClass:NSDictionary.class]||n.count!=6||![n[@"purpose"]isEqual:@"product-session-device-source-v4"]||!text(n[@"accountIssuer"],v.issuer,2048)||!text(n[@"accountSubject"],v.subject,2048)||!text(n[@"sourceId"],v.sourceId,512)||!text(n[@"instanceId"],v.instanceId,512)||![n[@"generation"]isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)n[@"generation"])==CFBooleanGetTypeID())return p_->fail(localFailure(Changed));double generation=[n[@"generation"]doubleValue];if(!std::isfinite(generation)||generation!=std::floor(generation)||generation<1||generation>9007199254740991.0||v.subject!=copy.expected[2])return p_->fail(localFailure(Changed));v.generation=(uint64_t)generation;v.present=true;}
 if(auto f=current();f.present)return f;out=std::move(copy);return{};}@catch(id){return p_->fail(localFailure(Exception));}}catch(...){return p_->fail(localFailure(Exception));}}
Drain Backend::join()noexcept{if(p_->closed)return p_->closedResult;try{@try{
 if(!p_->tokenReleaseSelected){p_->tokenReleaseSelected=true;if(p_->owned)[p_->source retire];if(p_->token){NSError*e=nil;BOOL released=NO,ok=[p_->source releaseOriginalDeviceV4NativeReadLoan:p_->token released:&released error:&e];p_->tokenReleased=released;if(!ok||e)p_->fail(cause(e,Pending));if(released)p_->token=nil;}else p_->tokenReleased=true;}
 if(!p_->tokenReleased)return{p_->first.present?p_->first:localFailure(Pending),1,0};
 if(!p_->owned||!p_->source)return{p_->first,0,1};NSError*e=nil;BOOL ok=[p_->source join:&e];if(e)p_->fail(cause(e,Pending));return{p_->first.present?p_->first:ok?Failure{}:localFailure(Pending),0,ok?1u:0u};
 }@catch(id){return{p_->fail(localFailure(Exception)),1,0};}}catch(...){return{p_->fail(localFailure(Exception)),1,0};}}
Drain Backend::close()noexcept{if(p_->closeSelected)return p_->closedResult;auto joined=join();if(!joined.physical_done)return joined;p_->closeSelected=true;try{@try{NSError*e=nil;if(p_->owned&&p_->source){BOOL ok=[p_->source close:&e];if(!ok||e)p_->fail(cause(e,Pending));p_->closed=[p_->source originalDeviceV4NativePhysicalClosed];}else p_->closed=true;
 p_->closedResult={p_->first,p_->closed?0u:1u,p_->closed?1u:0u};if(p_->closed)p_->source=nil;return p_->closedResult;}@catch(id){p_->closedResult={p_->fail(localFailure(Exception)),1,0};return p_->closedResult;}}catch(...){p_->closedResult={p_->fail(localFailure(Exception)),1,0};return p_->closedResult;}}
struct BackendFactory {static BackendAcquisition capture(YNXAuthIdentitySourceAuthority*borrowed,bool owned)noexcept{BackendAcquisition a;try{a.owner=std::shared_ptr<Backend>(new Backend);auto&p=*a.owner->p_;p.owned=owned;
 @try{if(!pthread_main_np()){a.failure=p.fail(localFailure(WrongActor));return a;}NSError*e=nil;p.source=owned?[YNXAuthIdentitySourceAuthority acquireOriginalProductSessionDeviceV4Source:&e]:borrowed;
 if(e||!p.source||[p.source class]!=YNXAuthIdentitySourceAuthority.class){a.failure=p.fail(cause(e,NotSupplied));return a;}
 p.token=[p.source reserveOriginalDeviceV4NativeReadLoan:&e]; // adopt token before NSError
 if(e||!p.token)a.failure=p.fail(cause(e,NotSupplied));else a.failure=a.owner->current();return a;}@catch(id){a.failure=p.fail(localFailure(Exception));return a;}
 }catch(...){a.failure=localFailure(Exception);if(a.owner)a.owner->p_->fail(a.failure);return a;}}};
BackendAcquisition acquireOriginalBackend()noexcept{return BackendFactory::capture(nil,true);}
BackendAcquisition borrowRecognizedSource(YNXAuthIdentitySourceAuthority*s)noexcept{return BackendFactory::capture(s,false);}
}
