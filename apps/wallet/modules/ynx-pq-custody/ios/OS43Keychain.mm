#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#import <UIKit/UIKit.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include "OS43Private.h"
#include <condition_variable>
#include <chrono>
#include <memory>
#include <mutex>
#include <vector>

namespace ynx::mobilepq::os43 {
namespace {
NSString* const service=@"com.ynx.wallet.pq.custody.v1";
NSString* account(const YNXMobileOS43Descriptor& d){return [@"keychain:ynx-pq-v1:" stringByAppendingString:[NSString stringWithUTF8String:itemID(d).c_str()]];}
NSMutableDictionary* query(const YNXMobileOS43Descriptor& d){return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:service,(__bridge id)kSecAttrAccount:account(d),(__bridge id)kSecAttrSynchronizable:@NO} mutableCopy];}
int32_t status(OSStatus s){return s==errSecSuccess?ok:s==errSecItemNotFound?missing:s==errSecDuplicateItem?exists:s==errSecUserCanceled?cancelled:denied;}
bool deviceDescriptor(const YNXMobileOS43Descriptor& d){return d.directory_fd==-1&&d.minimum_protection==YNX_PQ_OS43_AUTHENTICATED;}
int32_t checkAttributes(const YNXMobileOS43Descriptor& d,NSDictionary* attrs,uint8_t identity[32]){
 auto aad=metadata(d);NSData* generic=attrs[(__bridge id)kSecAttrGeneric];
 if(![generic isKindOfClass:NSData.class]||generic.length!=aad.size()||memcmp(generic.bytes,aad.data(),aad.size()))return changed;
 if(![attrs[(__bridge id)kSecAttrAccessible] isEqual:(__bridge id)kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly])return denied;
 CFTypeRef actual=(__bridge CFTypeRef)attrs[(__bridge id)kSecAttrAccessControl];
 CFErrorRef error=nullptr;auto expected=SecAccessControlCreateWithFlags(kCFAllocatorDefault,kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,kSecAccessControlUserPresence,&error);
 bool same=actual&&expected&&CFGetTypeID(actual)==SecAccessControlGetTypeID()&&CFEqual(actual,expected);
 if(expected)CFRelease(expected);if(error)CFRelease(error);if(!same)return denied;
 NSDate* created=attrs[(__bridge id)kSecAttrCreationDate];NSDate* modified=attrs[(__bridge id)kSecAttrModificationDate];
 if(![created isKindOfClass:NSDate.class]||![modified isKindOfClass:NSDate.class])return changed;
 NSData* reference=attrs[(__bridge id)kSecValuePersistentRef];
 if(![reference isKindOfClass:NSData.class]||!reference.length||reference.length>4096)return changed;
 std::vector<uint8_t> frame(aad.begin(),aad.end());
 for(NSDate* date in @[created,modified]){double t=date.timeIntervalSince1970;uint64_t bits=0;memcpy(&bits,&t,8);for(int i=0;i<8;++i)frame.push_back(uint8_t(bits>>(56-i*8)));}
 const auto* bytes=static_cast<const uint8_t*>(reference.bytes);frame.insert(frame.end(),bytes,bytes+reference.length);
 return platformSHA256(frame.data(),frame.size(),identity);
}
struct Input {
 std::mutex mutex;std::condition_variable cv;bool done=false;int32_t code=cancelled;Credential value{};
 __weak UIAlertController* dialog;
 ~Input(){wipe(value.data(),value.size());}
};
void complete(const std::shared_ptr<Input>& input,UITextField* field,int32_t code){
 std::lock_guard<std::mutex> lock(input->mutex);if(input->done){field.text=@"";return;}
 if(code==ok){
  NSString* text=field.text;NSUInteger used=0;
  if(text.length!=43||![text getBytes:input->value.data() maxLength:43 usedLength:&used encoding:NSASCIIStringEncoding options:0 range:NSMakeRange(0,text.length) remainingRange:nullptr]||used!=43||!canonical(input->value))code=invalid;
 }
 field.text=@"";if(code!=ok)wipe(input->value.data(),43);input->code=code;input->done=true;input->cv.notify_one();
}
}
int32_t platformSHA256(const uint8_t* bytes,size_t n,uint8_t* out){
 if(!bytes||!n||n>65536||!out)return invalid;
 CC_SHA256(bytes,CC_LONG(n),out);return 0;
}
int32_t platformRead(const YNXMobileOS43Descriptor& d,Credential& credential,YNXMobileOS43Protection& protection){
 if(!deviceDescriptor(d))return unsupported;
 auto q=query(d);q[(__bridge id)kSecReturnAttributes]=@YES;q[(__bridge id)kSecReturnData]=@YES;q[(__bridge id)kSecReturnPersistentRef]=@YES;
 LAContext* authentication=[LAContext new];
 authentication.localizedReason=@"Unlock the original Wallet PQ backup credential";
 q[(__bridge id)kSecUseAuthenticationContext]=authentication;
 CFTypeRef result=nullptr;auto code=SecItemCopyMatching((__bridge CFDictionaryRef)q,&result);
 if(code!=errSecSuccess)return status(code);
 NSDictionary* attrs=CFBridgingRelease(result);NSData* data=attrs[(__bridge id)kSecValueData];
 if(![data isKindOfClass:NSData.class]||data.length!=43)return changed;
 auto e=checkAttributes(d,attrs,protection.item_identity);if(e)return e;
 [data getBytes:credential.data() length:43];
 protection.platform=1;protection.protection=YNX_PQ_OS43_AUTHENTICATED;protection.user_presence=1;return 0;
}
int32_t platformCurrent(const YNXMobileOS43Descriptor& d,const YNXMobileOS43Protection& prior){
 if(!deviceDescriptor(d)||prior.platform!=1||prior.protection!=1||prior.user_presence!=1)return denied;
 auto q=query(d);q[(__bridge id)kSecReturnAttributes]=@YES;q[(__bridge id)kSecReturnPersistentRef]=@YES;CFTypeRef result=nullptr;
 auto code=SecItemCopyMatching((__bridge CFDictionaryRef)q,&result);if(code!=errSecSuccess)return status(code);
 NSDictionary* attrs=CFBridgingRelease(result);uint8_t identity[32];auto e=checkAttributes(d,attrs,identity);
 return e?e:memcmp(identity,prior.item_identity,32)?changed:ok;
}
int32_t platformInput(const YNXMobileOS43Descriptor& d,Credential& out){
 if(!deviceDescriptor(d)||NSThread.isMainThread)return unsupported;
 LAContext* authentication=[LAContext new];NSError* authError=nil;
 if(![authentication canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&authError])return denied;
 auto input=std::make_shared<Input>();
 dispatch_async(dispatch_get_main_queue(),^{
  NSMutableArray<UIWindow*>* windows=[NSMutableArray array];
  for(UIScene* scene in UIApplication.sharedApplication.connectedScenes)if(scene.activationState==UISceneActivationStateForegroundActive&&[scene isKindOfClass:UIWindowScene.class])
   for(UIWindow* window in ((UIWindowScene*)scene).windows)if(window.isKeyWindow&&window.rootViewController)[windows addObject:window];
  if(windows.count!=1){complete(input,nil,denied);return;}
  UIViewController* parent=windows.firstObject.rootViewController;while(parent.presentedViewController)parent=parent.presentedViewController;
  auto alert=[UIAlertController alertControllerWithTitle:@"Original PQ backup credential" message:@"Enter the original 43-character credential. This does not approve signing or sending." preferredStyle:UIAlertControllerStyleAlert];
  [alert addTextFieldWithConfigurationHandler:^(UITextField* field){field.secureTextEntry=YES;field.autocorrectionType=UITextAutocorrectionTypeNo;field.spellCheckingType=UITextSpellCheckingTypeNo;field.autocapitalizationType=UITextAutocapitalizationTypeNone;field.textContentType=nil;}];
  // UIKit owns its secure input buffers; only our explicit Native allocation
  // is wipe-guaranteed. No physical-erasure claim for UIKit/OS internals.
  [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:^(UIAlertAction*){complete(input,alert.textFields.firstObject,cancelled);}]];
  [alert addAction:[UIAlertAction actionWithTitle:@"Use original" style:UIAlertActionStyleDefault handler:^(UIAlertAction*){complete(input,alert.textFields.firstObject,ok);}]];
  {std::lock_guard<std::mutex> lock(input->mutex);if(input->done)return;input->dialog=alert;}
  [parent presentViewController:alert animated:YES completion:nil];
 });
 std::unique_lock<std::mutex> lock(input->mutex);
 if(!input->cv.wait_for(lock,std::chrono::milliseconds(d.ui_timeout_ms),[&]{return input->done;})){
  input->done=true;input->code=cancelled;wipe(input->value.data(),43);
  dispatch_async(dispatch_get_main_queue(),^{UIAlertController* dialog=input->dialog;dialog.textFields.firstObject.text=@"";[dialog dismissViewControllerAnimated:YES completion:nil];});
 }
 if(input->code==0)out=input->value;return input->code;
}
Effect platformImportAbsent(const YNXMobileOS43Descriptor& d,const Credential& c){
 if(!deviceDescriptor(d))return {unsupported,false};
 CFErrorRef error=nullptr;SecAccessControlRef access=SecAccessControlCreateWithFlags(kCFAllocatorDefault,kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,kSecAccessControlUserPresence,&error);
 if(!access){if(error)CFRelease(error);return {denied,false};}
 auto q=query(d);auto aad=metadata(d);
 q[(__bridge id)kSecAttrAccessControl]=(__bridge id)access;q[(__bridge id)kSecAttrGeneric]=[NSData dataWithBytes:aad.data() length:aad.size()];
 NSMutableData* value=[NSMutableData dataWithBytes:c.data() length:c.size()];q[(__bridge id)kSecValueData]=value;
 auto result=SecItemAdd((__bridge CFDictionaryRef)q,nullptr);[value resetBytesInRange:NSMakeRange(0,value.length)];CFRelease(access);
 return {status(result),result==errSecSuccess}; // duplicate is NEVER an update
}
Effect platformRemoveExact(const YNXMobileOS43Descriptor& d){
 // Enforce actual user presence and exact metadata before exact deletion. Auth
 // separately restricts this to the same unreferenced import cleanup receipt.
 Credential credential{};YNXMobileOS43Protection protection{1,sizeof(YNXMobileOS43Protection),0,0,0,{}};
 auto e=platformRead(d,credential,protection);wipe(credential.data(),43);if(e)return {e,false};
 auto selected=query(d);selected[(__bridge id)kSecReturnAttributes]=@YES;selected[(__bridge id)kSecReturnPersistentRef]=@YES;
 CFTypeRef raw=nullptr;auto read=SecItemCopyMatching((__bridge CFDictionaryRef)selected,&raw);if(read!=errSecSuccess)return {status(read),false};
 NSDictionary* attrs=CFBridgingRelease(raw);uint8_t identity[32];e=checkAttributes(d,attrs,identity);
 if(e||memcmp(identity,protection.item_identity,32))return {e?e:changed,false};
 // Delete the independently rechecked original item by its actual persistent
 // reference. Replacement of this service/account cannot redirect deletion.
 auto q=query(d);q[(__bridge id)kSecValuePersistentRef]=attrs[(__bridge id)kSecValuePersistentRef];
 auto result=SecItemDelete((__bridge CFDictionaryRef)q);return {status(result),result==errSecSuccess};
}
}
