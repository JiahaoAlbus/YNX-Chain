#include "DeviceV4SourceDarwinPrivate.hpp"
#include "DeviceV4AccountNamespacePrivate.h"
#include <string>
#include <thread>
#include <cstdio>
#include <cstdlib>
using namespace ynx::auth::devicev4;
static uint64_t wall=100000,mono=1000;static std::string scenario;static unsigned calls=0,closes=0,duringMatch=0;static bool ready=true,matching=false;
namespace ynx::auth::devicev4 {uint64_t wallNow()noexcept{return wall;}uint64_t monoNow()noexcept{return mono;}}
// PUBLIC original-Source boundary ONLY, no real registry/math/profile/OS/key.
// The actual Darwin backend and C inventory under test are unmodified.
@implementation YNXAuthIdentitySourceAuthority {id _token;BOOL _closed;}
+(instancetype)acquireOriginalProductSessionDeviceV4Source:(NSError**)e{if(e)*e=nil;return[self new];}
-(BOOL)assertOriginalProductSessionDeviceV4SourceCurrent:(NSError**)e{++calls;if(matching&&++duringMatch==3){if(scenario=="namespace-tail-expiry")wall=100501;if(scenario=="namespace-tail-rollback")wall=99999;}if(e)*e=nil;if(!ready){if(e)*e=[NSError errorWithDomain:@"PUBLIC" code:0 userInfo:nil];return YES;}return YES;}
-(id)reserveOriginalDeviceV4NativeReadLoan:(NSError**)e{_token=[NSObject new];if(e)*e=nil;if(scenario=="partial-zero"&&e)*e=[NSError errorWithDomain:@"PUBLIC" code:0 userInfo:nil];return _token;}
-(BOOL)releaseOriginalDeviceV4NativeReadLoan:(id)t released:(BOOL*)r error:(NSError**)e{if(e)*e=nil;if(t!=_token)return NO;_token=nil;if(r)*r=YES;return YES;}
-(NSDictionary*)copyOriginalDeviceV4NativeReadSnapshot:(id)t notBefore:(uint64_t*)begin expires:(uint64_t*)end error:(NSError**)e{
 if(e)*e=nil;if(t!=_token)return nil;NSMutableDictionary*x=[NSMutableDictionary new];for(NSString*k in @[@"networkId",@"canonicalOwner",@"account",@"sessionBinding",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"deviceId",@"generation",@"registrationId",@"revision",@"registrationDigest"])x[k]=@"PUBLIC";x[@"packageId"]=NSNull.null;if(scenario=="bad-null")x[@"account"]=NSNull.null;
 NSMutableDictionary*c=[NSMutableDictionary new];for(unsigned i=0;i<12;++i)c[[NSString stringWithFormat:@"PUBLIC%u",i]]=@"DATA";if(begin)*begin=100000;if(end)*end=100500;
 if(scenario=="late")wall=100501;
 return @{@"version":@"4",@"expected":x,@"context":c,@"registrationOriginal":@"{\"PUBLIC\":\"registration\"}",@"sessionOriginal":@"{\"PUBLIC\":\"session\"}"};}
-(void)retire{}
-(BOOL)join:(NSError**)e{if(e)*e=nil;return _token==nil;}
-(BOOL)close:(NSError**)e{++closes;_closed=scenario!="close-unknown";if(e)*e=nil;if(scenario=="close-first-zero"||scenario=="close-unknown"){if(e)*e=[NSError errorWithDomain:@"PUBLIC" code:0 userInfo:nil];return NO;}return YES;}
-(BOOL)originalDeviceV4NativePhysicalClosed{return _closed;}
-(NSDictionary*)copyOriginalDeviceV4AccountNamespaceForNativeRead:(id)t error:(NSError**)e{if(e)*e=nil;if(t!=_token)return nil;if(scenario=="no-namespace")return nil;if(scenario=="namespace-swap"&&matching)return @{@"purpose":@"product-session-device-source-v4",@"sourceId":@"OTHER",@"instanceId":@"PUBLIC-instance",@"generation":@1,@"accountIssuer":@"https://wallet-auth.ynxweb4.com",@"accountSubject":@"PUBLIC"};return @{@"purpose":@"product-session-device-source-v4",@"sourceId":@"PUBLIC-source",@"instanceId":@"PUBLIC-instance",@"generation":@1,@"accountIssuer":@"https://wallet-auth.ynxweb4.com",@"accountSubject":@"PUBLIC"};}
@end
static void need(bool b,const char*s){if(!b){fprintf(stderr,"FAIL %s\n",s);std::_Exit(3);}}
int main(int argc,char**argv){@autoreleasepool{need(argc==2,"case");scenario=argv[1];if(scenario=="deadline-overflow")mono=UINT64_MAX-100;auto a=ynx_auth_device_v4_source_acquire_original_v1();need(a.owner,"adopt Source");
 if(scenario=="partial-zero"){need(a.failure.present&&a.failure.code==0&&a.failure.platform_code==0,"rawzero capture");}
 else{need(!a.failure.present,"normal PUBLIC Source");
  if(scenario=="wrong-actor"){Failure f{};std::thread t([&]{f=ynx_auth_device_v4_source_current_v1(a.owner);});t.join();need(f.present&&f.code==WrongActor,"foreign actor");}
  auto v=ynx_auth_device_v4_source_open_view_v1(a.owner);need(v.owner,"adopt View");
  if(scenario.rfind("namespace-",0)==0||scenario=="no-namespace"){
   need(!v.failure.present,"namespace fixture captured");std::string issuer="https://wallet-auth.ynxweb4.com",subject="PUBLIC";if(scenario=="namespace-wrong-issuer")issuer="https://wrong.invalid";if(scenario=="namespace-wrong-subject")subject="wrong";if(scenario=="namespace-nul")issuer.push_back('\0');if(scenario=="namespace-retire")ynx_auth_device_v4_source_request_retire_v1(a.owner);if(scenario=="namespace-expired")mono=2000;if(scenario=="namespace-late")ready=false;
   matching=true;auto match=ynx_auth_device_v4_view_match_account_namespace_v1(v.owner,{(const uint8_t*)issuer.data(),issuer.size()},{(const uint8_t*)subject.data(),subject.size()});
   if(scenario=="namespace-positive")need(!match.failure.present&&match.matched,"same genuine view comparison");
   else if(scenario=="namespace-wrong-issuer"||scenario=="namespace-wrong-subject"){need(!match.failure.present&&!match.matched,"exact mismatch");need(!ynx_auth_device_v4_view_current_v1(v.owner).present,"comparison not Root grant or source poison");}
   else if(scenario=="no-namespace"){need(match.failure.present&&match.failure.code==NotSupplied&&!match.matched,"legacy source no implicit namespace");need(!ynx_auth_device_v4_view_current_v1(v.owner).present,"old v1 read unaffected");}
   else {need(match.failure.present&&!match.matched,"current/argument/same-source reject");if(scenario=="namespace-late")need(match.failure.code==0,"late raw first0");}
   need(!ynx_auth_device_v4_source_close_v1(a.owner).physical_done,"view debt");need(ynx_auth_device_v4_view_release_v1(v.owner).physical_done,"drop same view afterfailure");auto close=ynx_auth_device_v4_source_close_v1(a.owner);need(close.physical_done,"physicalclose");need(ynx_auth_device_v4_source_release_closed_v1(a.owner).physical_done,"release actualclosed");puts("PASS namespace");return 0;
  }
  if(scenario=="late"||scenario=="bad-null"||scenario=="deadline-overflow"){need(v.failure.present,"late/bad scope/overflow reject");}
  else{need(!v.failure.present,"actual view");ynx_auth_device_v4_view_data_v1 d{};d.version=1;d.size=sizeof(d);need(!ynx_auth_device_v4_view_read_original_v1(v.owner,&d).present,"actual read");need(d.null_mask==(1u<<9)&&d.registration_original.length>0&&d.context_original.length>0,"typed originals and null");
   if(scenario=="revoke"){ready=false;auto f=ynx_auth_device_v4_view_current_v1(v.owner);need(f.present&&f.code==0,"late Rootfirstzero");}
   if(scenario=="rollback"){wall=99999;need(ynx_auth_device_v4_view_current_v1(v.owner).code==ClockRollback,"rollback");}
   if(scenario=="expired"){mono=2000;need(ynx_auth_device_v4_view_current_v1(v.owner).code==Expired,"mono expiry");}
   if(scenario=="retain"){auto r=ynx_auth_device_v4_source_retain_v1(a.owner);need(r.owner==a.owner,"same owner");need(!ynx_auth_device_v4_source_close_v1(a.owner).physical_done,"ref+view debt");need(ynx_auth_device_v4_source_release_reference_v1(a.owner).reference_released,"drop extra ref");}
   if(scenario=="cancel"){std::thread t([&]{ynx_auth_device_v4_source_request_retire_v1(a.owner);});t.join();need(ynx_auth_device_v4_view_current_v1(v.owner).present,"async revoke");}
  }
  need(!ynx_auth_device_v4_source_close_v1(a.owner).physical_done&&closes==0,"no early parent close");
  need(ynx_auth_device_v4_view_release_v1(v.owner).physical_done,"view release afterfailure");
 }
 auto d=ynx_auth_device_v4_source_close_v1(a.owner);if(scenario=="close-unknown"){need(!d.physical_done&&d.failure.present&&d.failure.code==0&&closes==1,"UNKNOWN close");auto q=ynx_auth_device_v4_source_close_v1(a.owner);need(!q.physical_done&&closes==1,"sticky no retry");puts("PASS UNKNOWN debt retained");std::_Exit(0);}
 need(d.physical_done,"physical closed");if(scenario=="close-first-zero")need(d.failure.present&&d.failure.code==0,"close first0 independent done");need(ynx_auth_device_v4_source_release_closed_v1(a.owner).physical_done,"release closed");need(ynx_auth_device_v4_source_current_v1(a.owner).present,"tombstone");printf("PASS %s calls=%u\n",scenario.c_str(),calls);return 0;}}
