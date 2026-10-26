#include "original-product-device-v4-factory.h"
#include "original-product-device-v4-slot.h"
#include "original-product-device-v4-http-call.h"
#include "product-session-device-v4-once-binding.h"
#include "original-auth-identity-source-authority.h"
#include "ProductSessionDeviceV4.h"
#include <chrono>
#include <thread>
#include <pthread.h>
#include <algorithm>
#include <cmath>
#ifdef YNX_PRODUCT_DEVICE_V4_FACTORY_PUBLIC_TEST
extern "C" uint64_t YNXProductDeviceV4FactoryPublicClock(unsigned);
#endif
namespace ynx_auth_private {
static uint64_t factoryClock(unsigned which){
#ifdef YNX_PRODUCT_DEVICE_V4_FACTORY_PUBLIC_TEST
 return YNXProductDeviceV4FactoryPublicClock(which);
#else
 if(!which)return(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
 return(uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
#endif
}
static NSData*factoryCanonical(id value){return[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];}
static bool factoryMS(NSString*value,uint64_t&out){
 if(![value isKindOfClass:NSString.class]||value.length!=24)return false;NSISO8601DateFormatter*f=[NSISO8601DateFormatter new];f.formatOptions=NSISO8601DateFormatWithInternetDateTime|NSISO8601DateFormatWithFractionalSeconds;NSDate*d=[f dateFromString:value];if(!d||![[f stringFromDate:d]isEqual:value]||d.timeIntervalSince1970<0)return false;out=(uint64_t)llround(d.timeIntervalSince1970*1000.0);return true;
}
static bool factoryASCII(NSString*s,const char*allowed,NSUInteger minimum,NSUInteger maximum){if(![s isKindOfClass:NSString.class]||s.length<minimum||s.length>maximum)return false;for(NSUInteger i=0;i<s.length;i++){unichar c=[s characterAtIndex:i];if(c>127||!std::strchr(allowed,(char)c)||c==0)return false;}return true;}
static std::vector<uint8_t>factoryPublicHex(NSString*s,size_t count){if(![s isKindOfClass:NSString.class]||s.length!=count*2)throw std::runtime_error("DEVICE_V4_FACTORY_REGISTERED_PUBLIC_HEX");std::vector<uint8_t>out;out.reserve(count);for(size_t i=0;i<count;i++){unsigned value=0;for(unsigned j=0;j<2;j++){unichar c=[s characterAtIndex:i*2+j];if(c>='0'&&c<='9')value=value*16+c-'0';else if(c>='a'&&c<='f')value=value*16+c-'a'+10;else throw std::runtime_error("DEVICE_V4_FACTORY_REGISTERED_PUBLIC_HEX");}out.push_back((uint8_t)value);}return out;}
struct ProductDeviceV4ProofOperation::Impl{
 YNXAuthIdentitySourceAuthority*__strong source=nil;NSDictionary*__strong scope=nil;
 NSData*__strong unsignedOriginal=nil;NSDictionary*__strong unsignedValue=nil;
 HostDirfdJournal journal;std::unique_ptr<ProductDeviceV4Once>once;
 std::unique_ptr<ProductDeviceV4Slot>slot;ProductDeviceV4HTTPOutcomeDATA outcome;
 std::thread::id actor=std::this_thread::get_id();bool done=false,retired=false,closeSelected=false,closed=false;
 uint64_t issued=0,expires=0,wallFloor=0,monoStart=0,budget=0;std::string first,closeCause;
 bool fail(const char*code,std::string&error){if(first.empty())first=code;error=first;return false;}
 bool originalActor(std::string&error){if(actor!=std::this_thread::get_id()||!pthread_main_np()){error="DEVICE_V4_FACTORY_ORIGINAL_ACTOR_REQUIRED";return false;}return true;}
 bool current(std::string&error){
  if(!originalActor(error))return false;if(!first.empty()){error=first;return false;}if(retired||closeSelected||[source class]!=YNXAuthIdentitySourceAuthority.class)return fail("DEVICE_V4_FACTORY_RETIRED_OR_SOURCE_REQUIRED",error);
  NSError*e=nil;if(![source assertOriginalProductSessionDeviceV4SourceCurrent:&e]||e)return fail("DEVICE_V4_FACTORY_SOURCE_NOT_CURRENT",error);NSDictionary*s=[source copyOriginalProductSessionDeviceV4Scope:&e];if(!s||e)return fail("DEVICE_V4_FACTORY_SCOPE_UNAVAILABLE",error);if(scope&&![scope isEqual:s])return fail("DEVICE_V4_FACTORY_SCOPE_CHANGED",error);if(!scope)scope=s;return true;
 }
 bool time(std::string&error){const auto wall=factoryClock(0),mono=factoryClock(1);if(!issued||!expires||wall<wallFloor||wall<issued||wall>=expires||mono<monoStart||mono-monoStart>=budget)return fail("DEVICE_V4_FACTORY_FIXED_WINDOW_EXPIRED",error);wallFloor=wall;return true;}
 bool request(std::string&error){
  if(![unsignedOriginal isKindOfClass:NSData.class]||!unsignedOriginal.length||unsignedOriginal.length>16384)return fail("DEVICE_V4_FACTORY_UNSIGNED_BOUND",error);
  NSDictionary*u=[NSJSONSerialization JSONObjectWithData:unsignedOriginal options:0 error:nil];NSArray*keys=@[@"version",@"sessionBinding",@"productId",@"clientId",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"canonicalOwner",@"deviceId",@"deviceRegistrationId",@"deviceRegistrationRevision",@"deviceRegistrationDigest",@"method",@"path",@"bodyDigest",@"nonce",@"issuedAt",@"expiresAt"];
  if(![u isKindOfClass:NSDictionary.class]||u.count!=21||![[NSSet setWithArray:u.allKeys]isEqual:[NSSet setWithArray:keys]]||![factoryCanonical(u)isEqual:unsignedOriginal]||![u[@"version"]isEqual:@"4"])return fail("DEVICE_V4_FACTORY_UNSIGNED_CANONICAL",error);
  NSDictionary*expected=scope[@"expected"];
  for(NSString*k in @[@"sessionBinding",@"productId",@"clientId",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"canonicalOwner",@"deviceId"])if(![u[k]isEqual:expected[k]])return fail("DEVICE_V4_FACTORY_SOURCE_REQUEST_BINDING",error);
  for(const auto&binding:{std::pair<NSString*,NSString*>{@"deviceRegistrationId",@"registrationId"},{@"deviceRegistrationRevision",@"revision"},{@"deviceRegistrationDigest",@"registrationDigest"}})if(![u[binding.first]isEqual:expected[binding.second]])return fail("DEVICE_V4_FACTORY_SOURCE_REQUEST_BINDING",error);
  NSString*path=u[@"path"];
  if(![u[@"method"]isEqual:@"GET"]||![u[@"bodyDigest"]isEqual:@"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]||!factoryASCII(path,"/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~!$&'()*+,;=:@-",2,256)||![path hasPrefix:@"/"]||[path hasSuffix:@"/"]||[path containsString:@"//"]||[[path componentsSeparatedByString:@"/"]containsObject:@"."]||[[path componentsSeparatedByString:@"/"]containsObject:@".."]||[path hasPrefix:@"/v2/product-sessions"]||[path hasPrefix:@"/v2/browser-sessions"]||!factoryASCII(u[@"nonce"],"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",32,64))return fail("DEVICE_V4_FACTORY_READ_ONLY_HTTP_REQUIRED",error);
  if(!factoryMS(u[@"issuedAt"],issued)||!factoryMS(u[@"expiresAt"],expires)||expires<=issued||expires-issued>30000)return fail("DEVICE_V4_FACTORY_FIXED_WINDOW_REQUIRED",error);
  NSDictionary*registration=[NSJSONSerialization JSONObjectWithData:[scope[@"registrationOriginal"]dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil],*session=[NSJSONSerialization JSONObjectWithData:[scope[@"sessionOriginal"]dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];uint64_t rBegin=0,rEnd=0,sBegin=0,sEnd=0;
  if(!factoryMS(registration[@"registeredAt"],rBegin)||!factoryMS(registration[@"expiresAt"],rEnd)||!factoryMS(session[@"issuedAt"],sBegin)||!factoryMS(session[@"expiresAt"],sEnd)||registration[@"revokedAt"]!=NSNull.null||issued<std::max(rBegin,sBegin)||expires>std::min(rEnd,sEnd))return fail("DEVICE_V4_FACTORY_ORIGINAL_WINDOW_BINDING",error);
  wallFloor=factoryClock(0);monoStart=factoryClock(1);if(wallFloor<issued||wallFloor>=expires)return fail("DEVICE_V4_FACTORY_FIXED_WINDOW_EXPIRED",error);budget=expires-wallFloor;unsignedValue=u;return time(error);
 }
};
ProductDeviceV4ProofOperation::ProductDeviceV4ProofOperation():impl_(new Impl){}
std::unique_ptr<ProductDeviceV4ProofOperation>ProductDeviceV4Factory::produce(YNXAuthIdentitySourceAuthority*source,NSData*raw,std::string&error){
 error.clear();std::unique_ptr<ProductDeviceV4ProofOperation>op;
 try{@try{op.reset(new ProductDeviceV4ProofOperation);auto&p=*op->impl_;p.source=source;if(![raw isKindOfClass:NSData.class]||!raw.length||raw.length>16384){p.fail("DEVICE_V4_FACTORY_UNSIGNED_BOUND",error);return op;}p.unsignedOriginal=[NSData dataWithBytes:raw.bytes length:raw.length];
  if(!p.current(error)||!p.request(error))return op;NSError*e=nil;NSDictionary*selection=[source copyOriginalSelection:&e];
  if(!selection||e||![selection[@"productSessionDeviceV4"]isEqual:p.scope]||![selection[@"originalHostTerminalDirectory"]isKindOfClass:NSString.class]){p.fail("DEVICE_V4_FACTORY_ORIGINAL_JOURNAL_BINDING",error);return op;}
  NSDictionary*expected=p.scope[@"expected"];auto network=deviceV4Hex32DATA([expected[@"networkId"]UTF8String]);NSData*owner=[expected[@"canonicalOwner"]dataUsingEncoding:NSUTF8StringEncoding];std::array<uint8_t,16384>e5{};size_t written=0;
  if(owner.length!=42||ynx_auth_device_http_v4_e5_data(network.data(),(const uint8_t*)owner.bytes,(const uint8_t*)p.unsignedOriginal.bytes,p.unsignedOriginal.length,e5.data(),e5.size(),&written)!=0){p.fail("DEVICE_V4_FACTORY_FIXED_E5_REFUSED",error);return op;}
  std::string leaf="device-v4-http-"+std::string([expected[@"sessionBinding"]UTF8String]);p.journal.open([selection[@"originalHostTerminalDirectory"]UTF8String],leaf);
  NSData*registration=[p.scope[@"registrationOriginal"]dataUsingEncoding:NSUTF8StringEncoding];std::vector<unsigned char>reg((const unsigned char*)registration.bytes,(const unsigned char*)registration.bytes+registration.length);
  p.once=makeProductDeviceV4OnceFromExpectedDATA(p.journal,{[expected[@"networkId"]UTF8String],[expected[@"sessionBinding"]UTF8String],[expected[@"registrationDigest"]UTF8String]},reg,[p.unsignedValue[@"nonce"]UTF8String],std::vector<unsigned char>(e5.begin(),e5.begin()+written));p.once->reserve();
  if(!p.current(error)||!p.time(error))return op;
  p.slot=ProductDeviceV4Slot::acquire(source,error);if(!p.slot||!error.empty()){p.fail(error.empty()?"DEVICE_V4_FACTORY_ORIGINAL_SLOT_UNAVAILABLE":error.c_str(),error);return op;}
  ProductDeviceV4SlotBorrow borrow;if(!p.slot->selectOriginalPrivateBorrow(borrow,error)){p.fail(error.empty()?"DEVICE_V4_FACTORY_PRIVATE_BORROW_REFUSED":error.c_str(),error);return op;}
  if(!p.current(error)||!p.time(error)||!p.slot->assertCurrent(error)){p.fail("DEVICE_V4_FACTORY_PRE_ENTRY_CURRENT_REFUSED",error);return op;}
  NSDictionary*registered=[NSJSONSerialization JSONObjectWithData:registration options:0 error:nil];auto expectedA=factoryPublicHex(registered[@"pkA"],2592),expectedB=factoryPublicHex(registered[@"pkB"],64);
  YNXProductSessionHTTPRequestV4 request{};request.version=4;request.struct_size=sizeof(request);request.unsigned_original={(const uint8_t*)p.unsignedOriginal.bytes,p.unsignedOriginal.length};request.expected={{network.data(),network.size()},{(const uint8_t*)owner.bytes,owner.length},{expectedA.data(),expectedA.size()},{expectedB.data(),expectedB.size()}};request.pkcs8_a={borrow.derA.bytes,borrow.derA.length};request.pkcs8_b={borrow.derB.bytes,borrow.derB.length};request.pk_a={borrow.pkA.bytes,borrow.pkA.length};request.pk_b={borrow.pkB.bytes,borrow.pkB.length};
  p.outcome=invokeOriginalProductDeviceV4HTTPBorrow(*p.once,request); // Adopt DATA before rc/current/cleanup.
  if(!p.outcome.mathCompleted){p.fail(p.outcome.firstCause.empty()?"DEVICE_V4_FACTORY_HTTP_OUTCOME_UNKNOWN":p.outcome.firstCause.c_str(),error);return op;}
  if(!p.current(error)||!p.time(error)||!p.slot->assertCurrent(error)){p.fail("DEVICE_V4_FACTORY_POST_ENTRY_CURRENT_REFUSED",error);return op;}
  std::string cleanup;if(!p.slot->close(cleanup)){p.fail("DEVICE_V4_FACTORY_SLOT_CLEANUP_UNKNOWN",error);return op;}
  if(!p.current(error)||!p.time(error))return op;p.done=true;return op;
 }@catch(id){if(op)op->impl_->fail("DEVICE_V4_FACTORY_NATIVE_EXCEPTION_UNKNOWN",error);else error="DEVICE_V4_FACTORY_NATIVE_EXCEPTION_UNKNOWN";return op;}}
 catch(const std::exception&e){if(op){auto&p=*op->impl_;if(p.once&&p.outcome.member.empty())p.outcome.member=p.once->copyRetainedOutcomeDATA();p.fail(e.what(),error);}else error="DEVICE_V4_FACTORY_ALLOCATION_UNKNOWN";return op;}
 catch(...){if(op)op->impl_->fail("DEVICE_V4_FACTORY_CPP_EXCEPTION_UNKNOWN",error);else error="DEVICE_V4_FACTORY_CPP_EXCEPTION_UNKNOWN";return op;}
}
std::vector<unsigned char>ProductDeviceV4ProofOperation::copyOriginalMemberDATA()const{if(impl_->actor!=std::this_thread::get_id())throw std::runtime_error("DEVICE_V4_FACTORY_ORIGINAL_ACTOR_REQUIRED");return impl_->outcome.member;}
bool ProductDeviceV4ProofOperation::assertCurrent(std::string&error){try{@try{auto&p=*impl_;if(!p.done)return p.fail("DEVICE_V4_FACTORY_OUTCOME_UNKNOWN",error);return p.current(error)&&p.time(error);}@catch(id){return impl_->fail("DEVICE_V4_FACTORY_CURRENT_EXCEPTION",error);}}catch(...){return impl_->fail("DEVICE_V4_FACTORY_CURRENT_CPP_EXCEPTION",error);}}
void ProductDeviceV4ProofOperation::retire(){if(impl_->actor==std::this_thread::get_id())impl_->retired=true;}
bool ProductDeviceV4ProofOperation::join(std::string&error){auto&p=*impl_;if(!p.originalActor(error))return false;if(!p.retired){error="DEVICE_V4_FACTORY_RETIRE_BEFORE_JOIN";return false;}return true;}
bool ProductDeviceV4ProofOperation::close(std::string&error){auto&p=*impl_;if(!p.originalActor(error))return false;if(p.closeSelected){error=p.closeCause;return p.closed;}p.retired=true;p.closeSelected=true;bool ok=true;std::string slotError;try{if(p.slot&&!p.slot->close(slotError))ok=false;if(!p.journal.close())ok=false;}catch(...){ok=false;}if(!ok){p.closeCause="DEVICE_V4_FACTORY_CLOSE_UNKNOWN";error=p.closeCause;return false;}p.source=nil;p.scope=nil;p.unsignedOriginal=nil;p.unsignedValue=nil;p.closed=true;error.clear();return true;}
ProductDeviceV4ProofOperation::~ProductDeviceV4ProofOperation(){std::string e;if(!close(e)){static thread_local std::vector<Impl*>debt;debt.push_back(impl_.release());}}
}
