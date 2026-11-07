// Actual Native Context inventory/deadline code; PUBLIC C17 DATA source only.
#include "AIMobileProducerState.h"
#include <CommonCrypto/CommonDigest.h>
#include <cassert>
#include <chrono>
#include <cstring>
#include <iostream>
using namespace ynx::mobileai;
namespace {uint64_t expiry=0;bool lateZero=false,sourceZero=false;unsigned copies=0;auto source=reinterpret_cast<YNXAuthAIMobileOwnerV6*>(1);uint64_t now(){return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());}}
namespace ynx::mobilepq::os43 {int32_t platformSHA256(const uint8_t*p,size_t n,uint8_t*out){return CC_SHA256(p,CC_LONG(n),out)?0:9102;}}
namespace ynx::mobileai::producer {bool closeTransport(const std::shared_ptr<Producer>&)noexcept{return true;}void cancelTransport(const std::shared_ptr<Producer>&)noexcept{}Failure joinTransport(const std::shared_ptr<Producer>&)noexcept{return {};}void releaseClosedTransportData(const std::shared_ptr<Producer>&)noexcept{}}
extern "C" {
int32_t ynx_auth_ai_mobile_is_original_source_v6(YNXAuthAIMobileOwnerV6*s){return s==source;}
int32_t ynx_auth_ai_mobile_owner_state_v6(YNXAuthAIMobileOwnerV6*s,YNXAuthAIMobileOwnerStateV6*out){assert(s==source);*out={6,sizeof(*out),1,0,sourceZero?Failure{1,0}:Failure{}, {}};return 0;}
int32_t ynx_auth_ai_mobile_client_current_v6(YNXAuthAIMobileOwnerV6*s){assert(s==source);return 0;}
int32_t ynx_auth_ai_mobile_copy_original_v6(YNXAuthAIMobileOwnerV6*s,uint32_t kind,uint8_t*out,size_t cap,size_t*bytes){assert(s==source&&kind==1);++copies;if(lateZero){sourceZero=true;return closed;}auto scope="{\"expiresAtMs\":"+std::to_string(expiry)+"}";assert(scope.size()<cap);std::memcpy(out,scope.data(),scope.size());*bytes=scope.size();return 0;}
}
int main(){auto life=std::make_shared<std::atomic<bool>>(true);expiry=now()+50;auto first=captureOriginalContext(source,7,life);assert(first.owner&&!first.failure.present);std::this_thread::sleep_for(std::chrono::milliseconds(2));auto second=captureOriginalContext(source,7,life);assert(second.owner&&!second.failure.present&&producer::context(first.owner)->expiresAtMs==expiry&&producer::context(second.owner)->expiresAtMs==expiry);assert(!ynx_ai_mobile_context_current_v6(first.owner));std::cout<<"PASS same Source expiry retained across distinct contexts, no new window\n";
 std::this_thread::sleep_for(std::chrono::milliseconds(55));assert(ynx_ai_mobile_context_current_v6(first.owner)==closed&&ynx_ai_mobile_context_current_v6(second.owner)==closed);auto expired=captureOriginalContext(source,7,life);assert(expired.owner&&expired.failure.present&&expired.failure.code==closed&&!producer::context(expired.owner)->ready);std::cout<<"PASS expired Source rejects fresh context and retains adopted partial\n";
 for(auto c:{first.owner,second.owner,expired.owner})assert(!closeOriginalContext(c).present);expiry=now()+1000;lateZero=true;auto partial=captureOriginalContext(source,8,life);assert(partial.owner&&partial.failure.present&&partial.failure.code==0&&!producer::context(partial.owner)->ready);assert(!closeOriginalContext(partial.owner).present);std::cout<<"PASS late Source present0 retains same partial before failure inspection\n";
 sourceZero=false;lateZero=false;auto actor=captureOriginalContext(source,9,life);assert(actor.owner&&!actor.failure.present);std::thread wrong([&]{assert(ynx_ai_mobile_context_current_v6(actor.owner)==closed);cancelOriginalContext(actor.owner);});wrong.join();assert(ynx_ai_mobile_context_current_v6(actor.owner)==closed&&!closeOriginalContext(actor.owner).present);assert(copies==5);std::cout<<"PASS foreign-thread current denied; atomic cancellation reduces same context\n4 PUBLIC native context deadline controls; no Auth/Root/nonce/signature/OS admission\n";
}
