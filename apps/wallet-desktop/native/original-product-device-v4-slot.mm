#include "original-product-device-v4-slot.h"
#include "original-auth-identity-source-authority.h"
#import <Security/Security.h>
#include <unistd.h>
#include <pthread.h>
#include <thread>
#include <vector>
#include <array>

// Test-only fixed OS boundary. Normal binary has no provider/Keychain setter.
#ifdef YNX_PRODUCT_DEVICE_V4_SLOT_PUBLIC_TEST
extern "C" OSStatus YNXProductDeviceV4SlotPublicCopy(CFDictionaryRef,CFTypeRef*);
#define DeviceV4SlotCopy YNXProductDeviceV4SlotPublicCopy
#else
#define DeviceV4SlotCopy SecItemCopyMatching
#endif
namespace ynx_auth_private {
static NSString*const deviceSlotService=@"com.ynx.wallet.product-device.v4";
static bool slotHex(NSString*s,size_t n,std::vector<uint8_t>&bytes){
 if(![s isKindOfClass:NSString.class]||s.length!=n*2)return false;bytes.clear();bytes.reserve(n);
 for(size_t i=0;i<n;i++){unsigned value=0;for(unsigned j=0;j<2;j++){unichar c=[s characterAtIndex:i*2+j];if(c>='0'&&c<='9')value=value*16+c-'0';else if(c>='a'&&c<='f')value=value*16+c-'a'+10;else{return false;}}bytes.push_back((uint8_t)value);}return true;
}
struct ProductDeviceV4Slot::Impl{
 YNXAuthIdentitySourceAuthority*__strong source=nil;
 NSDictionary*__strong scope=nil;NSDictionary*__strong metadata=nil;
 NSData*__strong registration=nil;NSMutableData*__strong material=nil;
 NSString*__strong account=nil;std::vector<uint8_t>pkA,pkB;
 std::thread::id thread=std::this_thread::get_id();uid_t uid=getuid();
 bool selected=false,retired=false,closeSelected=false,closed=false;
 std::string first,closeCause;
 bool fail(const char*code,std::string&error){if(first.empty())first=code;error=first;return false;}
 bool actor(std::string&error){if(thread!=std::this_thread::get_id()||!pthread_main_np()){error="DEVICE_V4_SLOT_ORIGINAL_ACTOR_REQUIRED";return false;}if(uid==0||getuid()!=uid||geteuid()!=uid||getegid()!=getgid())return fail("DEVICE_V4_SLOT_ORIGINAL_ACTOR_REQUIRED",error);return true;}
 bool originalScope(std::string&error){
  if(!actor(error))return false;if(!first.empty()){error=first;return false;}if(retired||closeSelected||!source)return fail("DEVICE_V4_SLOT_RETIRED",error);
  if([source class]!=YNXAuthIdentitySourceAuthority.class)return fail("DEVICE_V4_SLOT_DEDICATED_SOURCE_REQUIRED",error);
  NSError*e=nil;if(![source assertOriginalProductSessionDeviceV4SourceCurrent:&e]||e)return fail("DEVICE_V4_SLOT_SOURCE_NOT_CURRENT",error);
  NSDictionary*value=[source copyOriginalProductSessionDeviceV4Scope:&e];if(!value||e)return fail("DEVICE_V4_SLOT_SOURCE_SCOPE_UNAVAILABLE",error);
  if(scope&&![scope isEqual:value])return fail("DEVICE_V4_SLOT_SOURCE_SCOPE_CHANGED",error);if(!scope)scope=value;
  return true;
 }
 // Result is retained before OS status/attributes are interpreted. No contents
 // or private digest enter errors, logs, receipts or NAPI.
 NSDictionary*read(bool privateData,std::string&error){
  NSMutableDictionary*q=[@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
   (__bridge id)kSecAttrService:deviceSlotService,(__bridge id)kSecAttrAccount:account,
   (__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecUseDataProtectionKeychain:@YES,
   (__bridge id)kSecUseAuthenticationUI:(__bridge id)kSecUseAuthenticationUIFail,
   (__bridge id)kSecMatchLimit:(__bridge id)kSecMatchLimitAll,
   (__bridge id)kSecReturnAttributes:@YES,(__bridge id)kSecReturnPersistentRef:@YES}mutableCopy];
  if(privateData)q[(__bridge id)kSecReturnData]=@YES;
  CFTypeRef raw=nullptr;OSStatus status=DeviceV4SlotCopy((__bridge CFDictionaryRef)q,&raw);id result=CFBridgingRelease(raw);
  // Adopt a bounded actual private partial before interpreting OS status.
  // The same returned slot remains its cleanup owner on every late refusal.
  if(privateData&&[result isKindOfClass:NSArray.class]&&[result count]==1&&[[result firstObject]isKindOfClass:NSDictionary.class]){id b=[result firstObject][(__bridge id)kSecValueData];if([b isKindOfClass:NSData.class]&&[b length]>0&&[b length]<=24576)material=[NSMutableData dataWithBytes:[b bytes] length:[b length]];}
  if(status!=errSecSuccess||![result isKindOfClass:NSArray.class]||[result count]!=1){fail("DEVICE_V4_SLOT_OS_READ_REFUSED",error);return nil;}
  NSDictionary*entry=[result firstObject];if(![entry isKindOfClass:NSDictionary.class]){fail("DEVICE_V4_SLOT_OS_SHAPE",error);return nil;}
  if(![entry[(__bridge id)kSecAttrService]isEqual:deviceSlotService]||![entry[(__bridge id)kSecAttrAccount]isEqual:account]||![entry[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]||![entry[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]){fail("DEVICE_V4_SLOT_PROTECTION_MISMATCH",error);return nil;}
  NSData*ref=entry[(__bridge id)kSecValuePersistentRef];id created=entry[(__bridge id)kSecAttrCreationDate],changed=entry[(__bridge id)kSecAttrModificationDate];
  if(![ref isKindOfClass:NSData.class]||!ref.length||ref.length>4096||![created isKindOfClass:NSDate.class]||![changed isKindOfClass:NSDate.class]){fail("DEVICE_V4_SLOT_OS_IDENTITY_REQUIRED",error);return nil;}
  NSDictionary*identity=@{@"reference":[NSData dataWithBytes:ref.bytes length:ref.length],@"created":[created copy],@"changed":[changed copy],@"account":account,@"service":deviceSlotService,@"accessible":entry[(__bridge id)kSecAttrAccessible],@"synchronizable":@NO};
  if(metadata&&![metadata isEqual:identity]){fail("DEVICE_V4_SLOT_OS_IDENTITY_CHANGED",error);return nil;}if(!metadata)metadata=identity;
  if(privateData){NSData*bytes=entry[(__bridge id)kSecValueData];if(![bytes isKindOfClass:NSData.class]||!bytes.length||bytes.length>24576){fail("DEVICE_V4_SLOT_PRIVATE_RECORD_BOUND",error);return nil;}material=[NSMutableData dataWithBytes:bytes.bytes length:bytes.length];}
  return entry;
 }
};
ProductDeviceV4Slot::ProductDeviceV4Slot():impl_(new Impl){}
std::unique_ptr<ProductDeviceV4Slot>ProductDeviceV4Slot::acquire(YNXAuthIdentitySourceAuthority*source,std::string&error){
 error.clear();std::unique_ptr<ProductDeviceV4Slot>slot;
 try{@try{
  slot.reset(new ProductDeviceV4Slot);auto&p=*slot->impl_;p.source=source;
  if(!p.originalScope(error))return slot;NSDictionary*expected=p.scope[@"expected"];
  std::vector<uint8_t>network,digest;if(!slotHex(expected[@"networkId"],32,network)||!slotHex(expected[@"registrationDigest"],32,digest)){p.fail("DEVICE_V4_SLOT_PUBLIC_BINDING_INVALID",error);return slot;}
  p.account=[NSString stringWithFormat:@"uid:%u:network:%@:registration:%@",p.uid,expected[@"networkId"],expected[@"registrationDigest"]];
  NSString*raw=p.scope[@"registrationOriginal"];p.registration=[raw isKindOfClass:NSString.class]?[raw dataUsingEncoding:NSUTF8StringEncoding]:nil;
  NSDictionary*record=p.registration?[NSJSONSerialization JSONObjectWithData:p.registration options:0 error:nil]:nil;
  if(!p.registration.length||p.registration.length>16384||![record isKindOfClass:NSDictionary.class]||!slotHex(record[@"pkA"],2592,p.pkA)||!slotHex(record[@"pkB"],64,p.pkB)){p.fail("DEVICE_V4_SLOT_REGISTERED_PAIR_REQUIRED",error);return slot;}
  // Metadata only: no private data is requested during acquisition/current.
  if(!p.read(false,error)||!p.originalScope(error))return slot;return slot;
 }@catch(id){if(slot)slot->impl_->fail("DEVICE_V4_SLOT_ACQUIRE_EXCEPTION",error);else error="DEVICE_V4_SLOT_ACQUIRE_EXCEPTION";return slot;}}
 catch(...){if(slot)slot->impl_->fail("DEVICE_V4_SLOT_ACQUIRE_CPP_EXCEPTION",error);else error="DEVICE_V4_SLOT_ACQUIRE_CPP_EXCEPTION";return slot;}
}
bool ProductDeviceV4Slot::assertCurrent(std::string&error){
 try{@try{auto&p=*impl_;if(!p.originalScope(error)||!p.read(false,error)||!p.originalScope(error))return false;return true;}
 @catch(id){return impl_->fail("DEVICE_V4_SLOT_CURRENT_EXCEPTION",error);}}catch(...){return impl_->fail("DEVICE_V4_SLOT_CURRENT_CPP_EXCEPTION",error);}
}
bool ProductDeviceV4Slot::selectOriginalPrivateBorrow(ProductDeviceV4SlotBorrow&out,std::string&error){
 out={};try{@try{auto&p=*impl_;if(!assertCurrent(error))return false;if(p.selected)return p.fail("DEVICE_V4_SLOT_PRIVATE_BORROW_ALREADY_SELECTED",error);p.selected=true;
  if(!p.read(true,error))return false;ProductDeviceV4SlotBorrow captured;
  if(!borrowOriginalProductDeviceV4SlotRecord(p.material.bytes,p.material.length,p.registration.bytes,p.registration.length,p.pkA.data(),p.pkB.data(),captured))return p.fail("DEVICE_V4_SLOT_PRIVATE_RECORD_BINDING_REFUSED",error);
  if(!assertCurrent(error))return false;out=captured;return true;
 }@catch(id){return impl_->fail("DEVICE_V4_SLOT_PRIVATE_BORROW_EXCEPTION",error);}}catch(...){return impl_->fail("DEVICE_V4_SLOT_PRIVATE_BORROW_CPP_EXCEPTION",error);}
}
void ProductDeviceV4Slot::retire(){if(impl_->thread==std::this_thread::get_id())impl_->retired=true;}
bool ProductDeviceV4Slot::close(std::string&error){
 auto&p=*impl_;if(p.closeSelected){error=p.closeCause;return p.closed;}
 if(p.thread!=std::this_thread::get_id()){error="DEVICE_V4_SLOT_CLOSE_ACTOR_REQUIRED";return false;}p.retired=true;p.closeSelected=true;
 try{@try{if(p.material.length)[p.material resetBytesInRange:NSMakeRange(0,p.material.length)];p.material=nil;p.source=nil;p.scope=nil;p.metadata=nil;p.registration=nil;p.closed=true;error.clear();return true;}
 @catch(id){p.closeCause="DEVICE_V4_SLOT_CLOSE_UNKNOWN";error=p.closeCause;return false;}}catch(...){p.closeCause="DEVICE_V4_SLOT_CLOSE_CPP_UNKNOWN";error=p.closeCause;return false;}
}
ProductDeviceV4Slot::~ProductDeviceV4Slot(){std::string error;if(!close(error)){// Preserve unresolved custody, never retry a selected close.
 static thread_local std::vector<Impl*>debt;debt.push_back(impl_.release());}}
}
