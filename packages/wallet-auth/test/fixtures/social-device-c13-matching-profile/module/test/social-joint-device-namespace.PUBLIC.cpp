#ifndef YNX_SOCIAL_JOINT_PUBLIC_CONTROLS
#error "PUBLIC namespace C13 boundary forbidden in production"
#endif
#define YNX_SOCIAL_TEST_REAL_DEVICE_NAMESPACE
#define main ExistingDeviceBoundaryMainNotExecuted
#include "social-joint-device-session.PUBLIC.cpp"
#undef main
#include "DeviceV4AccountNamespacePrivate.h"
#include <stdexcept>
#include <cstring>
namespace {
std::string directMode;
int directCalls=0;
void thin(const std::string&mode){
 directMode=mode;held=std::make_shared<Fixture>();ynx_auth_device_v4_view_v1 view{};
 AccountNamespace account{"PRIVATE-ISSUER","PRIVATE-SUBJECT"};if(mode=="empty-issuer")account.issuer.clear();
 ynx_auth_device_v4_failure_v1 original{1,999,77,123};
 auto r=matchQualifiedDeviceNamespace(mode=="null-view"?nullptr:&view,account,original);
 assert(directCalls==1);
 if(mode=="matched1")assert(r.ok()&&!original.present);
 else if(mode=="matched0")assert(r.error_present&&r.first==-41601&&!r.unknown&&!original.present);
 else if(mode=="nonbool")assert(r.first==-41602&&r.unknown&&!original.present);
 else if(mode=="invalid-present"||mode=="invalid-absent-fields")assert(r.first==-41602&&r.unknown&&original.origin==43);
 else if(mode=="throw")assert(r.first==-41606&&r.unknown&&!original.present&&original.code==0&&original.origin==0&&original.platform_code==0);
 else if(mode=="paired0"||mode=="paired0-nonbool")assert(raw0(r)&&!r.unknown&&original.present==1&&original.origin==43&&original.platform_code==9876543210LL);
 else if(mode=="paired-nonzero")assert(r.first==73123&&original.present==1&&original.origin==43&&original.platform_code==9876543210LL);
 else {assert((mode=="null-view"||mode=="empty-issuer")&&r.first==73002&&original.present==1);}
}
}
extern "C" ynx_auth_device_v4_namespace_match_v1 ynx_auth_device_v4_view_match_account_namespace_v1(
 ynx_auth_device_v4_view_v1*view,ynx_auth_device_v4_bytes_v1 issuer,ynx_auth_device_v4_bytes_v1 subject){
 identity();assert(subject.length==15&&!std::memcmp(subject.bytes,"PRIVATE-SUBJECT",15));
 if(directMode.empty()){
  assert(view&&issuer.length==14&&!std::memcmp(issuer.bytes,"PRIVATE-ISSUER",14));++held->matches;
  if(held->active()&&(held->mode=="issuer-mismatch"||held->mode=="init-issuer-mismatch"))return{{},0};
  if(held->active()&&held->mode=="matcher-late0")return{failed(),0};
  return{{},1};
 }
 ++directCalls;
 if(directMode=="throw")throw std::runtime_error("PUBLIC C13 exception");
 if(directMode=="null-view"||directMode=="empty-issuer"){assert(!view||!issuer.length);return{{1,73002,43,8},0};}
 assert(view&&issuer.length==14&&!std::memcmp(issuer.bytes,"PRIVATE-ISSUER",14));
 if(directMode=="matched0")return{{},0};if(directMode=="nonbool")return{{},2};
 if(directMode=="invalid-present")return{{2,0,43,8},1};
 if(directMode=="invalid-absent-fields")return{{0,0,43,8},1};
 if(directMode=="paired0"||directMode=="paired0-nonbool")return{failed(),directMode=="paired0"?1U:99U};
 if(directMode=="paired-nonzero"){auto f=failed();f.code=73123;return{f,1};}
 return{{},1};
}
int main(int argc,char**argv){assert(argc==2);const std::string mode=argv[1];if(mode.rfind("full:",0)==0)run(mode.substr(5));else thin(mode);std::cout<<"PASS "<<mode<<" actual DeviceNamespace CPP (+selected actualDevice fullpath); C13 PUBLIC supplier only, no Root\n";}
