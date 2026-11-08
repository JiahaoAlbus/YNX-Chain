#ifndef YNX_SOCIAL_JOINT_PUBLIC_CONTROLS
#error "PUBLIC original Source boundary only; no Root qualification"
#endif
#include "OriginalServices.hpp"
#include "DeviceNamespace.hpp"
#include "DeviceV4SourceDarwinPrivate.hpp"
#include "DeviceV4AccountNamespacePrivate.h"
#include <cassert>
#include <chrono>
#include <thread>
#include <iostream>
namespace n=ynx::social::joint::original;
namespace a=ynx::auth::devicev4;
// Derived only from Auth's existing controls/namespace_public_source.mm Source
// method definitions. No old cases or fake Clock implementation are reused.
static std::string scenario;static std::uint64_t beginTime=0,endTime=0;
static unsigned captures=0,currents=0,closes=0,namespaceCopies=0,duringMatch=0;
static bool matching=false;
@implementation YNXAuthIdentitySourceAuthority {id _token;BOOL _closed;}
+(instancetype)acquireOriginalProductSessionDeviceV4Source:(NSError**)e{++captures;if(e)*e=nil;return[self new];}
-(BOOL)assertOriginalProductSessionDeviceV4SourceCurrent:(NSError**)e{
 ++currents;if(e)*e=nil;if(matching){++duringMatch;
  if(scenario=="actual-late0"&&duringMatch==4){if(e)*e=[NSError errorWithDomain:@"PUBLIC" code:0 userInfo:nil];return YES;}
  if(scenario=="actual-tail-expiry"&&duringMatch==3)endTime=a::wallNow()-1;
 }return YES;
}
-(id)reserveOriginalDeviceV4NativeReadLoan:(NSError**)e{if(e)*e=nil;_token=[NSObject new];return _token;}
-(BOOL)releaseOriginalDeviceV4NativeReadLoan:(id)t released:(BOOL*)out error:(NSError**)e{if(e)*e=nil;if(t!=_token)return NO;_token=nil;if(out)*out=YES;return YES;}
-(NSDictionary*)copyOriginalDeviceV4NativeReadSnapshot:(id)t notBefore:(uint64_t*)begin expires:(uint64_t*)end error:(NSError**)e{
 if(e)*e=nil;if(t!=_token)return nil;NSMutableDictionary*x=[NSMutableDictionary new];
 for(NSString*k in @[@"networkId",@"canonicalOwner",@"account",@"sessionBinding",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"deviceId",@"generation",@"registrationId",@"revision",@"registrationDigest"])x[k]=@"PUBLIC";
 x[@"packageId"]=NSNull.null;NSMutableDictionary*context=[NSMutableDictionary new];for(unsigned i=0;i<12;++i)context[[NSString stringWithFormat:@"PUBLIC%u",i]]=@"DATA";
 if(begin)*begin=beginTime;if(end)*end=endTime;return @{@"version":@"4",@"expected":x,@"context":context,@"registrationOriginal":@"{\"PUBLIC\":\"registration\"}",@"sessionOriginal":@"{\"PUBLIC\":\"session\"}"};
}
-(NSDictionary*)copyOriginalDeviceV4AccountNamespaceForNativeRead:(id)t error:(NSError**)e{
 if(e)*e=nil;if(t!=_token)return nil;++namespaceCopies;if(scenario=="actual-no-namespace"||scenario=="device-no-namespace")return nil;
 return @{@"purpose":@"product-session-device-source-v4",@"sourceId":matching&&scenario=="actual-same-source-swap"?@"OTHER":@"PUBLIC-source",@"instanceId":@"PUBLIC-instance",@"generation":@1,@"accountIssuer":@"https://wallet-auth.ynxweb4.com",@"accountSubject":@"PUBLIC"};
}
-(void)retire{}
-(BOOL)join:(NSError**)e{if(e)*e=nil;return _token==nil;}
-(BOOL)close:(NSError**)e{if(e)*e=nil;++closes;_closed=YES;return YES;}
-(BOOL)originalDeviceV4NativePhysicalClosed{return _closed;}
@end
namespace {
n::Result bad(){return{true,0,false,false};}
struct S final:n::Source {bool revoked=false;int checks=0;n::Result current()noexcept override{++checks;return revoked?bad():n::Result{};}n::Window window()const noexcept override{return{static_cast<int64_t>(beginTime),static_cast<int64_t>(endTime)};}n::Result matchCurrentOriginals(const n::SourceInput&)noexcept override{return{};}n::Result matchBinding(n::SocialHolder&,n::DeviceHolder&)noexcept override{return{};}n::Result inspectOriginalBodyDATA(n::SocialHolder&,n::DeviceHolder&,const n::Bytes&)noexcept override{return{};}void role(n::SocialHolder&,n::DeviceHolder&,const n::Resource&,const n::Resource&,std::uint32_t,const n::Bytes&,const n::Bytes&,std::shared_ptr<n::Role>&,n::Result&)noexcept override{assert(false);}n::Result close()noexcept override{assert(false);return{};}};
struct M final:n::SocialHolder {int checks=0;n::Result current()noexcept override{++checks;return{};}void view(std::shared_ptr<n::SocialView>&,n::Result&)noexcept override{assert(false);}n::Result close()noexcept override{assert(false);return{};}};
unsigned mainNamespaces=0;
void standalone(){auto owner=ynx_auth_device_v4_source_acquire_original_v1();assert(owner.owner&&!owner.failure.present);auto view=ynx_auth_device_v4_source_open_view_v1(owner.owner);assert(view.owner&&!view.failure.present);n::AccountNamespace account{"https://wallet-auth.ynxweb4.com","PUBLIC"};if(scenario=="actual-wrong-issuer")account.issuer="https://other.invalid";if(scenario=="actual-wrong-subject")account.subject="OTHER";
 if(scenario=="actual-deadline")std::this_thread::sleep_for(std::chrono::milliseconds(600));
 matching=true;ynx_auth_device_v4_failure_v1 original{};n::Result r;
 if(scenario=="actual-foreign-actor"){std::thread t([&]{r=n::matchQualifiedDeviceNamespace(view.owner,account,original);});t.join();assert(r.error_present&&original.code==a::WrongActor);}
 else{r=n::matchQualifiedDeviceNamespace(view.owner,account,original);
  if(scenario=="actual-positive")assert(r.ok()&&!original.present&&duringMatch>=6);
  else if(scenario=="actual-wrong-issuer"||scenario=="actual-wrong-subject"){assert(r.first==-41601&&!original.present);matching=false;assert(!ynx_auth_device_v4_view_current_v1(view.owner).present);}
  else if(scenario=="actual-late0")assert(r.error_present&&r.first==0&&original.present==1&&original.code==0&&original.origin==1&&original.platform_code==0);
  else if(scenario=="actual-no-namespace")assert(r.error_present&&original.code==a::NotSupplied);
  else if(scenario=="actual-same-source-swap")assert(r.error_present&&original.code==a::Changed);
  else assert(r.error_present&&original.code==a::Expired);
 }
 matching=false;assert(!ynx_auth_device_v4_source_close_v1(owner.owner).physical_done&&closes==0);assert(ynx_auth_device_v4_view_release_v1(view.owner).physical_done);assert(ynx_auth_device_v4_source_join_v1(owner.owner).physical_done);assert(ynx_auth_device_v4_source_close_v1(owner.owner).physical_done&&closes==1);assert(ynx_auth_device_v4_source_release_closed_v1(owner.owner).physical_done);assert(captures==1);
}
void fullDevice(){S source;M main;n::Resource resource{};std::shared_ptr<n::DeviceHolder>device;n::Result r;n::acquireRegisteredDeviceSession(source,main,resource,device,r);assert(device&&mainNamespaces==1&&captures==1);
 if(scenario=="device-no-namespace")assert(r.error_present&&r.first==a::NotSupplied);
 else{assert(r.ok());std::shared_ptr<n::DeviceView>view;if(scenario=="device-source-post0")source.revoked=true;device->view(view,r);assert(view);
  if(scenario=="device-source-post0")assert(r.error_present&&r.first==0);
  else assert(r.ok()&&view->data().expected[2]=="PUBLIC"&&view->data().null_mask==(1U<<9));
  assert(view->release().physical_done);
 }
 const auto sourceChecks=source.checks,mainChecks=main.checks;auto closed=device->close();assert(closed.physical_done&&closes==1&&captures==1&&source.checks==sourceChecks&&main.checks==mainChecks);if(scenario=="device-source-post0")assert(closed.error_present&&closed.first==0);
}
}
namespace ynx::social::joint::original {
void copyOriginalCommittedPairAccountNamespace(SocialHolder&s,AccountNamespace&out,Result&)noexcept{assert(dynamic_cast<M*>(&s));++mainNamespaces;assert(captures==0);out={"https://wallet-auth.ynxweb4.com","PUBLIC"};}
}
int main(int argc,char**argv){@autoreleasepool{assert(argc==2);scenario=argv[1];const auto now=a::wallNow();beginTime=now-5000;endTime=now+(scenario=="actual-deadline"?500:10000);if(scenario.rfind("device-",0)==0)fullDevice();else standalone();std::cout<<"PASS "<<scenario<<" actual Native wrapper/Device +Auth C13 inventory/Darwin backend/realClock, PUBLIC Source getter only; no Root/math/keys/network\n";}}
