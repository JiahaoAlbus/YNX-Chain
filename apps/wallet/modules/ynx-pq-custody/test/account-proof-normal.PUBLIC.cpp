// Actual Native purpose8 + Reader8 + Auth Host + P09 normal captured holder.
// ONLY Source/profile qualification is PUBLIC. No Core proof/sign/Root grant.
#include "../native/account-proof/NativeAccountPurposeChild.h"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <thread>
#include <unistd.h>
namespace normal=ynx::network::normalnative;
namespace launch=ynx::network::current4launch;
namespace auth=ynx::auth::mobile::receipt;
static launch::IndependentImages pins;
static const char*mode="normal";
static bool parse(const char*s,std::array<uint8_t,32>&out){
 if(strlen(s)!=64)return false;
 for(size_t k=0;k<32;++k){auto h=[](char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;};auto a=h(s[2*k]),b=h(s[2*k+1]);if(a<0||b<0)return false;out[k]=uint8_t(a*16+b);}return true;
}
namespace ynx::auth::mobile::receipt {
struct OriginalEngineSource {
 std::thread::id actor=std::this_thread::get_id();size_t getters=0,borrows=0,releases=0;
 EngineSelection selection{1,"PUBLIC-macos","PUBLIC-engine-DATA-only","PUBLIC-chain",
 "0x0000000000000000000000000000000000000001","PUBLIC-source","PUBLIC-instance",41,1893456000000ULL};
};
static OriginalEngineSource*inventory=nullptr;
ynx::core::mobile::registered::Failure originalEngineSourceCurrent(OriginalEngineSource*s)noexcept{
 return s==inventory&&s->actor==std::this_thread::get_id()?ynx::core::mobile::registered::Failure{}:ynx::core::mobile::registered::Failure{true,11901};
}
ynx::core::mobile::registered::Failure readOriginalEngineSelection(OriginalEngineSource*s,EngineSelection&out)noexcept{
 auto f=originalEngineSourceCurrent(s);if(f.present)return f;
 // First real Auth wrapper getter succeeds; actual P09 inner getter sees the
 // original paired failure0 after retaining its own Source loan.
 if(++s->getters>1&&strcmp(mode,"normal")==0)return{true,0};out=s->selection;return{};
}
ynx::core::mobile::registered::Failure retainOriginalEngineSource(OriginalEngineSource*s)noexcept{
 auto f=originalEngineSourceCurrent(s);if(!f.present){++s->borrows;
  if(s->borrows==2&&strcmp(mode,"auth-retire")==0)assert(!normal::retireOriginalNormalNativeBackend().failed());
 }return f;
}
ynx::core::mobile::registered::Failure releaseOriginalEngineSource(OriginalEngineSource*s)noexcept{
 if(s!=inventory||!s->borrows||s->actor!=std::this_thread::get_id())return{true,11902};--s->borrows;++s->releases;return{};
}
}
namespace ynx::network::normalnative::qualified {
Outcome readOriginalNormalHostProfile(Profile&out)noexcept{
 out.independentlyExpectedImages=pins;
 if(strcmp(mode,"profile-retire")==0)assert(!retireOriginalNormalNativeBackend().failed());
 return{};
}
int runOriginalNativeAccountHost()noexcept{return 0;}
}
int main(int argc,char**argv){
 if(argc!=6||!parse(argv[2],pins.parentCreator)||!parse(argv[3],pins.coreChild)||!parse(argv[4],pins.nativeChild))return 91;
 mode=argv[5];
 if(strcmp(argv[1],"core")==0){
  auto c=launch::captureOriginalLaunch(launch::Role::CoreProducer,pins,std::chrono::steady_clock::now()+std::chrono::seconds(8));
  if(!c.owner||c.failure!=launch::Failure::None)return 92;sleep(4);return 0;
 }
 assert(!normal::borrowOriginalNormalNativeBackend().owner);
 auto started=normal::startupOriginalNormalNativeBackend();
 if(strcmp(mode,"profile-retire")==0){
  assert(started.failure==normal::Failure::Retired&&!normal::borrowOriginalNormalNativeBackend().owner);
  assert(!normal::closeOriginalNormalNativeBackend().failed());
  puts("ACTUAL_NORMAL_PROFILE_RETIRE_BEFORE_CAPTURE_NOT_ROOT");
  puts("PUBLIC_NORMAL_STARTUP_ONCE_SOURCE_PARTIAL_TYPED_SETTLE_PENDING_CUSTODY_NOT_ROOT");fflush(stdout);sleep(1);return 0;
 }
 assert(!started.failed());
 assert(normal::startupOriginalNormalNativeBackend().failure==normal::Failure::AlreadyStarted);
 auth::OriginalEngineSource source;auth::inventory=&source;
 auto acquired=auth::acquireOriginalAccountProofHost(&source);
 if(strcmp(mode,"ready-guard")==0){
  assert(acquired.owner&&!acquired.failure.present&&source.borrows==2);
  ynx::sdk::mobile::accountproof::HostPort*host=nullptr;
  assert(!auth::readOriginalAccountProofHost(acquired.owner,&source,host).present&&host);
  auto*child=ynx::native::accountproof::originalChildForAccountProofHostPort(host);assert(child);
  auto*foreign=reinterpret_cast<ynx::sdk::mobile::accountproof::Reader*>(uintptr_t(999));
  assert(child->attachReader(foreign,&source).present);
  child->releaseReader(foreign); // cannot settle or create any Reader debt
  assert(normal::closeOriginalNormalNativeBackend().failure==normal::Failure::Pending);
  assert(!auth::closeOriginalAccountProofHost(acquired.owner).present&&auth::originalAccountProofHostClosed(acquired.owner));
  assert(source.borrows==0&&source.releases==2);
  assert(!auth::releaseClosedOriginalAccountProofHost(acquired.owner).present);
  assert(!ynx::native::accountproof::originalChildForAccountProofHostPort(host));
  assert(!normal::closeOriginalNormalNativeBackend().failed());
  puts("ACTUAL_NATIVE_HOST_REJECTS_FOREIGN_READER_AND_DRAINS_ORIGINAL_SOURCE_NOT_ROOT");
  puts("PUBLIC_NORMAL_STARTUP_ONCE_SOURCE_PARTIAL_TYPED_SETTLE_PENDING_CUSTODY_NOT_ROOT");fflush(stdout);sleep(1);return 0;
 }
 assert(acquired.owner&&acquired.failure.present);
 if(strcmp(mode,"normal")==0)assert(acquired.failure.code==0);
 assert(source.borrows==2&&source.getters==2);
 assert(normal::closeOriginalNormalNativeBackend().failure==normal::Failure::Pending);
 auto f=auth::closeOriginalAccountProofHost(acquired.owner);
 assert(f.present&&auth::originalAccountProofHostClosed(acquired.owner));
 if(strcmp(mode,"normal")==0)assert(f.code==0);
 assert(source.borrows==0&&source.releases==2);
 assert(!auth::releaseClosedOriginalAccountProofHost(acquired.owner).present);
 assert(!normal::closeOriginalNormalNativeBackend().failed());
 assert(!normal::borrowOriginalNormalNativeBackend().owner);
 puts("ACTUAL_NATIVE_PURPOSE8_AUTH_HOST_P09_NORMAL_PARTIAL0_DRAIN_NOT_ROOT");
 // Existing P09 interop harness marker denotes local process custody ONLY.
 puts("PUBLIC_NORMAL_STARTUP_ONCE_SOURCE_PARTIAL_TYPED_SETTLE_PENDING_CUSTODY_NOT_ROOT");
 fflush(stdout);sleep(1);return 0;
}
