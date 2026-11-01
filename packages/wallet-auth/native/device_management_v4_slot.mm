#include "device_management_v4_slot_private.hpp"
#include "device_management_v4_registered_private.hpp"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <thread>
#include <pthread.h>
#include <unistd.h>
#include <vector>

#ifdef YNX_DEVICE_MANAGEMENT_V4_SLOT_PUBLIC_TEST
extern "C" OSStatus YNXDeviceManagementV4SlotPublicCopy(CFDictionaryRef,CFTypeRef *);
#define DeviceV5SlotCopy YNXDeviceManagementV4SlotPublicCopy
#else
#define DeviceV5SlotCopy SecItemCopyMatching
#endif
namespace ynx_auth_private {
static NSString *const v5SlotService=@"com.ynx.wallet.product-device.v4";
static NSString *v5SlotText(const std::string &s){return [[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];}
static bool v5SameItem(const DeviceAssociationIdentity &a,const DeviceAssociationIdentity &b){return a.account==b.account&&a.network==b.network&&a.persistentRef==b.persistentRef&&a.metadata==b.metadata&&a.operation==b.operation&&a.osIdentity==b.osIdentity&&a.publicPair.pa==b.publicPair.pa&&a.publicPair.pb==b.publicPair.pb;}
static void v5Field(NSMutableData *raw,const void *p,size_t n){if(n>65536)throw std::runtime_error("DEVICE_MANAGEMENT_V4_SLOT_METADATA_BOUND");uint8_t size[4]={(uint8_t)(n>>24),(uint8_t)(n>>16),(uint8_t)(n>>8),(uint8_t)n};[raw appendBytes:size length:4];[raw appendBytes:p length:n];}
struct DeviceManagementV4Slot::Impl {
    std::shared_ptr<ynx::device::management::OriginalManagementRoot>source;
    std::shared_ptr<OriginalManagementRegisteredReadLease> lease;
    ManagementRegisteredOriginalView original;
    NSMutableData *__strong material=nil;
    NSError *__strong acquisitionError=nil;
    std::thread::id thread=std::this_thread::get_id();uid_t uid=getuid();
    bool captured=false,selected=false,retired=false,closeSelected=false,closed=false;
    std::string first,closeCause;
    bool fail(const char *code,std::string &error){if(first.empty())first=code;error=first;return false;}
    bool actor(std::string &error){if(thread!=std::this_thread::get_id()||!pthread_main_np()||uid==0||getuid()!=uid||geteuid()!=uid||getgid()!=getegid())return fail("DEVICE_MANAGEMENT_V4_SLOT_ORIGINAL_ACTOR_REQUIRED",error);return true;}
    bool current(std::string &error){
        if(!actor(error))return false;if(!first.empty()){error=first;return false;}
        if(retired||closeSelected||!lease)return fail("DEVICE_MANAGEMENT_V4_SLOT_RETIRED_OR_LEASE_REQUIRED",error);
        lease->assertCurrent();const auto &view=lease->readOriginalRegisteredView();
        if(view.registrationOriginal.empty()||view.registrationOriginal.size()>16384||(!view.completionQueryOnly&&view.sessionOriginal.empty())||view.sessionOriginal.size()>16384||view.sameItem.metadata.empty()||view.sameItem.metadata.size()>65536||view.sameItem.persistentRef.empty()||view.sameItem.persistentRef.size()>4096)
            return fail("DEVICE_MANAGEMENT_V4_SLOT_ORIGINAL_REGISTERED_ITEM_REQUIRED",error);
        if(captured&&(view.registrationOriginal!=original.registrationOriginal||view.sessionOriginal!=original.sessionOriginal||view.expiresAtMs!=original.expiresAtMs||view.completionQueryOnly!=original.completionQueryOnly||!v5SameItem(view.sameItem,original.sameItem)||![view.context isEqual:original.context]))return fail("DEVICE_MANAGEMENT_V4_SLOT_ORIGINAL_LEASE_CHANGED",error);
        if(!captured){original=view;captured=true;}lease->assertCurrent();return true;
    }
    bool read(bool privateData,std::string &error){
        if(!current(error))return false;const auto &item=original.sameItem;
        NSData *ref=[[NSData alloc]initWithBase64EncodedString:v5SlotText(item.persistentRef) options:0];
        if(!ref.length||ref.length>4096||![[ref base64EncodedStringWithOptions:0]isEqual:v5SlotText(item.persistentRef)])return fail("DEVICE_MANAGEMENT_V4_SLOT_ORIGINAL_PERSISTENT_REF",error);
        NSMutableData *generic=[NSMutableData data];for(const auto &s:{std::string("REGISTERED"),item.operation,item.metadata})v5Field(generic,s.data(),s.size());v5Field(generic,item.publicPair.pa.data(),2592);v5Field(generic,item.publicPair.pb.data(),64);
        LAContext *context=[LAContext new];context.interactionNotAllowed=YES;
        NSMutableDictionary *query=[@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:v5SlotService,
            (__bridge id)kSecAttrAccount:v5SlotText(item.account),(__bridge id)kSecValuePersistentRef:ref,(__bridge id)kSecAttrGeneric:generic,
            (__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecUseDataProtectionKeychain:@YES,(__bridge id)kSecUseAuthenticationContext:context,
            (__bridge id)kSecMatchLimit:(__bridge id)kSecMatchLimitAll,(__bridge id)kSecReturnAttributes:@YES,(__bridge id)kSecReturnPersistentRef:@YES}mutableCopy];
        if(privateData)query[(__bridge id)kSecReturnData]=@YES;
        CFTypeRef raw=nullptr;const OSStatus result=DeviceV5SlotCopy((__bridge CFDictionaryRef)query,&raw);id returned=CFBridgingRelease(raw);
        // Adopt any bounded actual private partial BEFORE result/attrs/current.
        if(privateData&&[returned isKindOfClass:NSArray.class]&&[returned count]==1&&[[returned firstObject]isKindOfClass:NSDictionary.class]){id data=[returned firstObject][(__bridge id)kSecValueData];if([data isKindOfClass:NSData.class]&&[data length]&&[data length]<=24576)material=[NSMutableData dataWithBytes:[data bytes] length:[data length]];}
        if(result!=errSecSuccess||![returned isKindOfClass:NSArray.class]||[returned count]!=1||![[returned firstObject]isKindOfClass:NSDictionary.class])return fail("DEVICE_MANAGEMENT_V4_SLOT_OS_ORIGINAL_READ_REFUSED",error);
        NSDictionary *entry=[returned firstObject];
        if(![entry[(__bridge id)kSecAttrService]isEqual:v5SlotService]||![entry[(__bridge id)kSecAttrAccount]isEqual:v5SlotText(item.account)]||![entry[(__bridge id)kSecAttrGeneric]isEqual:generic]||![entry[(__bridge id)kSecValuePersistentRef]isEqual:ref]||![entry[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]||![entry[(__bridge id)kSecAttrSynchronizable]isEqual:@NO])return fail("DEVICE_MANAGEMENT_V4_SLOT_OS_ORIGINAL_IDENTITY_CHANGED",error);
        id created=entry[(__bridge id)kSecAttrCreationDate],changed=entry[(__bridge id)kSecAttrModificationDate];
        if(![created isKindOfClass:NSDate.class]||![changed isKindOfClass:NSDate.class])return fail("DEVICE_MANAGEMENT_V4_SLOT_OS_DATES_REQUIRED",error);
        NSData *dates=[NSPropertyListSerialization dataWithPropertyList:@[created,changed] format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];
        if(!dates||![[dates base64EncodedStringWithOptions:0]isEqual:v5SlotText(item.osIdentity)])return fail("DEVICE_MANAGEMENT_V4_SLOT_OS_DATES_CHANGED",error);
        if(privateData&&!material.length)return fail("DEVICE_MANAGEMENT_V4_SLOT_PRIVATE_FRAME_NOT_RETAINED",error);
        return current(error);
    }
};
DeviceManagementV4Slot::DeviceManagementV4Slot():impl_(new Impl){}
std::unique_ptr<DeviceManagementV4Slot>DeviceManagementV4Slot::acquire(const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&source,std::string &error){
    error.clear();std::unique_ptr<DeviceManagementV4Slot> slot;
    try{@try{
        slot.reset(new DeviceManagementV4Slot);auto &p=*slot->impl_;p.source=source;
        if(!p.actor(error)||!ynx::device::management::is_original_device_v4_management_root(source)){p.fail("DEVICE_MANAGEMENT_V4_SLOT_ORIGINAL_SOURCE_REQUIRED",error);return slot;}
        NSError *cause=nil;p.lease=borrowOriginalManagementRegisteredReadLease(source,&cause);p.acquisitionError=cause; // adopt before error
        if(cause||!p.lease){p.fail("DEVICE_MANAGEMENT_V4_SLOT_REGISTERED_LEASE_UNAVAILABLE",error);return slot;}
        p.read(false,error);return slot;
    }@catch(id){if(slot)slot->impl_->fail("DEVICE_MANAGEMENT_V4_SLOT_ACQUIRE_EXCEPTION",error);else error="DEVICE_MANAGEMENT_V4_SLOT_ACQUIRE_EXCEPTION";return slot;}}
    catch(...){if(slot)slot->impl_->fail("DEVICE_MANAGEMENT_V4_SLOT_ACQUIRE_CPP_EXCEPTION",error);else error="DEVICE_MANAGEMENT_V4_SLOT_ACQUIRE_CPP_EXCEPTION";return slot;}
}
bool DeviceManagementV4Slot::assertCurrent(std::string &error){try{@try{return impl_->read(false,error);}@catch(id){return impl_->fail("DEVICE_MANAGEMENT_V4_SLOT_CURRENT_EXCEPTION",error);}}catch(...){return impl_->fail("DEVICE_MANAGEMENT_V4_SLOT_CURRENT_CPP_EXCEPTION",error);}}
bool DeviceManagementV4Slot::selectOriginalPrivateBorrow(ProductDeviceV4SlotBorrow &out,std::string &error){
    out={};try{@try{
        auto &p=*impl_;if(!p.current(error))return false;if(p.selected)return p.fail("DEVICE_MANAGEMENT_V4_SLOT_PRIVATE_BORROW_ALREADY_SELECTED",error);p.selected=true;
        if(!p.read(true,error))return false;ProductDeviceV4SlotBorrow borrowed;
        if(!borrowOriginalProductDeviceV4SlotRecord(p.material.bytes,p.material.length,p.original.registrationOriginal.data(),p.original.registrationOriginal.size(),p.original.sameItem.publicPair.pa.data(),p.original.sameItem.publicPair.pb.data(),borrowed))return p.fail("DEVICE_MANAGEMENT_V4_SLOT_PRIVATE_FRAME_BINDING_REFUSED",error);
        if(!p.current(error))return false;out=borrowed;return true;
    }@catch(id){return impl_->fail("DEVICE_MANAGEMENT_V4_SLOT_BORROW_EXCEPTION",error);}}catch(...){return impl_->fail("DEVICE_MANAGEMENT_V4_SLOT_BORROW_CPP_EXCEPTION",error);}
}
void DeviceManagementV4Slot::retire(){if(impl_->thread==std::this_thread::get_id()){impl_->retired=true;if(impl_->lease)impl_->lease->retire();}}
bool DeviceManagementV4Slot::close(std::string &error){
    auto &p=*impl_;if(p.closeSelected){error=p.closeCause;return p.closed;}if(p.thread!=std::this_thread::get_id()){error="DEVICE_MANAGEMENT_V4_SLOT_CLOSE_ACTOR_REQUIRED";return false;}p.closeSelected=true;p.retired=true;
    try{@try{if(p.material.length)[p.material resetBytesInRange:NSMakeRange(0,p.material.length)];p.material=nil;if(p.lease){p.lease->retire();if(!p.lease->close()){p.closeCause="DEVICE_MANAGEMENT_V4_SLOT_LEASE_CLOSE_UNKNOWN";error=p.closeCause;return false;}}p.lease.reset();p.source.reset();p.original={};p.acquisitionError=nil;p.closed=true;error.clear();return true;}@catch(id){p.closeCause="DEVICE_MANAGEMENT_V4_SLOT_CLOSE_UNKNOWN";}}
    catch(...){p.closeCause="DEVICE_MANAGEMENT_V4_SLOT_CLOSE_CPP_UNKNOWN";}error=p.closeCause;return false;
}
DeviceManagementV4Slot::~DeviceManagementV4Slot(){std::string error;if(!close(error)){static thread_local std::vector<Impl*> debt;debt.push_back(impl_.release());}}
}
