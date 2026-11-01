#import "original-ide-helper-service-contract.h"
#include "original-ide-helper-build-release.h"
#import <ServiceManagement/ServiceManagement.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#include <pthread.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
NSString *const YNXIDEIdentityHelperService=@"com.ynxweb4.developer.testnetpreview.identity-receiver";
NSString *const YNXIDEIdentityHelperPlist=@"com.ynxweb4.developer.testnetpreview.identity-receiver.plist";
static NSError*HelperInstallError(NSString*code){return [NSError errorWithDomain:@"YNXIDEHelperInstallation" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
static NSString*HelperDigest(NSData*bytes){unsigned char digest[32];CC_SHA256(bytes.bytes,(CC_LONG)bytes.length,digest);NSMutableString*s=[NSMutableString string];for(unsigned i=0;i<32;i++)[s appendFormat:@"%02x",digest[i]];return s;}
static bool HelperHex(const std::string&s){return s.size()==64&&s.find_first_not_of("0123456789abcdef")==std::string::npos;}
static NSData*HelperReadPublic(NSURL*url,size_t cap){
 if(!url.isFileURL)return nil;
 char*canonical=realpath(url.fileSystemRepresentation,nullptr);if(!canonical)return nil;
 BOOL same=[url.path isEqual:[NSString stringWithUTF8String:canonical]];free(canonical);if(!same)return nil;
 int fd=open(url.fileSystemRepresentation,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0)return nil;
 struct stat before{},after{},named{};NSMutableData*data=nil;
 if(!fstat(fd,&before)&&S_ISREG(before.st_mode)&&before.st_nlink==1&&!(before.st_mode&0022)&&before.st_size>0&&(uint64_t)before.st_size<=cap){
  data=[NSMutableData dataWithLength:(NSUInteger)before.st_size];size_t at=0;
  while(at<data.length){ssize_t n=read(fd,(unsigned char*)data.mutableBytes+at,data.length-at);if(n<=0){data=nil;break;}at+=(size_t)n;}
  unsigned char extra;if(data&&read(fd,&extra,1)!=0)data=nil;
 }
 if(data&&(fstat(fd,&after)||lstat(url.fileSystemRepresentation,&named)||!S_ISREG(named.st_mode)||
  before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_mode!=after.st_mode||before.st_nlink!=after.st_nlink||
  before.st_dev!=named.st_dev||before.st_ino!=named.st_ino||before.st_size!=named.st_size||before.st_mode!=named.st_mode||before.st_nlink!=named.st_nlink))data=nil;
 if(close(fd))return nil;return [data copy];
}
static bool HelperPlistContract(NSData*p){
 id v=[NSPropertyListSerialization propertyListWithData:p options:NSPropertyListImmutable format:nil error:nil];
 if(![v isKindOfClass:NSDictionary.class]||[v count]!=3||![v[@"Label"]isEqual:YNXIDEIdentityHelperService]||![v[@"BundleProgram"]isEqual:@"Contents/Library/HelperTools/YNXIdentityReceiver"]||![v[@"MachServices"]isKindOfClass:NSDictionary.class]||[v[@"MachServices"]count]!=1)return false;
 id enabled=v[@"MachServices"][YNXIDEIdentityHelperService];
 return enabled&&CFGetTypeID((__bridge CFTypeRef)enabled)==CFBooleanGetTypeID()&&[enabled boolValue];
}
static bool HelperCode(NSURL*url,const std::string&requirement,const std::string&team){
 if(!url.isFileURL||requirement.empty()||team.empty())return false;
 SecStaticCodeRef code=nullptr;SecRequirementRef rule=nullptr;CFDictionaryRef info=nullptr;
 OSStatus s=SecRequirementCreateWithString((__bridge CFStringRef)[NSString stringWithUTF8String:requirement.c_str()],kSecCSDefaultFlags,&rule);
 if(!s)s=SecStaticCodeCreateWithPath((__bridge CFURLRef)url,kSecCSDefaultFlags,&code);
 if(!s)s=SecStaticCodeCheckValidity(code,kSecCSStrictValidate|kSecCSCheckAllArchitectures,rule);
 if(!s)s=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info);
 NSString*actual=info?((__bridge NSDictionary*)info)[(__bridge NSString*)kSecCodeInfoTeamIdentifier]:nil;
 bool matches=!s&&[actual isEqual:[NSString stringWithUTF8String:team.c_str()]];
 if(info)CFRelease(info);if(code)CFRelease(code);if(rule)CFRelease(rule);return matches;
}
@implementation YNXIDEHelperBundledService{
 const ynx_auth_ide_private::IDEHelperBuildRelease*_release;
 NSBundle*_bundle;BOOL _registrationSelected;NSError*_first;pthread_t _thread;
}
-(instancetype)init{if((self=[super init]))_thread=pthread_self();return self;}
-(BOOL)fail:(NSString*)code error:(NSError**)error{if(!_first)_first=HelperInstallError(code);if(error)*error=_first;return NO;}
-(BOOL)assertCandidate:(NSError**)error{
 if(!pthread_equal(_thread,pthread_self())||!pthread_main_np())return [self fail:@"AUTH_IDENTITY_HELPER_INSTALL_THREAD_REQUIRED" error:error];
 if(_first||!_release||!_bundle){if(error)*error=_first?:HelperInstallError(@"AUTH_IDENTITY_HELPER_BUILD_NOT_ADMITTED");return NO;}
 if(![_bundle.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"]||!HelperHex(_release->helperSHA256)||!HelperHex(_release->plistSHA256)||!HelperCode(_bundle.bundleURL,_release->clientRequirement,_release->teamIdentifier))return [self fail:@"AUTH_IDENTITY_HELPER_SIGNED_CLIENT_REQUIRED" error:error];
 NSURL*helper=[_bundle.bundleURL URLByAppendingPathComponent:@"Contents/Library/HelperTools/YNXIdentityReceiver"];
 NSURL*plist=[_bundle.bundleURL URLByAppendingPathComponent:[@"Contents/Library/LaunchDaemons/" stringByAppendingString:YNXIDEIdentityHelperPlist]];
 NSData*h=HelperReadPublic(helper,67108864),*p=HelperReadPublic(plist,16384);
 if(!h.length||h.length>67108864||!p.length||p.length>16384||![HelperDigest(h)isEqual:[NSString stringWithUTF8String:_release->helperSHA256.c_str()]]||![HelperDigest(p)isEqual:[NSString stringWithUTF8String:_release->plistSHA256.c_str()]]||!HelperCode(helper,_release->helperRequirement,_release->teamIdentifier))return [self fail:@"AUTH_IDENTITY_HELPER_BUNDLED_BYTES_REQUIRED" error:error];
 if(!HelperPlistContract(p))return [self fail:@"AUTH_IDENTITY_HELPER_PLIST_CONTRACT_MISMATCH" error:error];
 return YES;
}
+(instancetype)acquireBundledCandidate:(NSError**)error{
 YNXIDEHelperBundledService*owner=[self new];owner->_bundle=NSBundle.mainBundle;
 if(!pthread_main_np()){[owner fail:@"AUTH_IDENTITY_HELPER_INSTALL_THREAD_REQUIRED" error:error];return owner;}
 for(const auto&r:ynx_auth_ide_private::originalIDEHelperBuildReleases()){
  if(HelperCode(owner->_bundle.bundleURL,r.clientRequirement,r.teamIdentifier)){
   if(owner->_release){[owner fail:@"AUTH_IDENTITY_HELPER_BUILD_AMBIGUOUS" error:error];return owner;}
   owner->_release=&r;
  }
 }
 [owner assertCandidate:error];return owner;
}
-(NSDictionary*)copySystemStatus:(NSError**)error{
 if(![self assertCandidate:error])return nil;
 if(@available(macOS 13.0,*)){
  SMAppService*s=[SMAppService daemonServiceWithPlistName:YNXIDEIdentityHelperPlist];
  NSString*state=s.status==SMAppServiceStatusEnabled?@"enabled":s.status==SMAppServiceStatusRequiresApproval?@"requires-system-approval":s.status==SMAppServiceStatusNotRegistered?@"not-registered":@"not-found";
  if(![self assertCandidate:error])return nil;
  return @{@"serviceIdentifier":YNXIDEIdentityHelperService,@"systemStatus":state,@"dataOnly":@YES,@"sourceAdmitted":@NO,@"registryAdmitted":@NO,@"receiveReady":@NO,@"recoverReady":@NO,@"keyCallReady":@NO};
 }
 [self fail:@"AUTH_IDENTITY_HELPER_REQUIRES_MACOS13" error:error];return nil;
}
-(NSDictionary*)registerRequestedService:(NSError**)error{
 if(_registrationSelected){[self fail:@"AUTH_IDENTITY_HELPER_REGISTRATION_ALREADY_SELECTED" error:error];return nil;}
 if(![self assertCandidate:error])return nil;
 if(@available(macOS 13.0,*)){
  _registrationSelected=YES; // before OS action; error/unknown never auto-retry
  NSError*failure=nil;BOOL ok=[[SMAppService daemonServiceWithPlistName:YNXIDEIdentityHelperPlist]registerAndReturnError:&failure];
  if(!ok||failure){_first=failure?:HelperInstallError(@"AUTH_IDENTITY_HELPER_REGISTRATION_UNKNOWN");if(error)*error=_first;return nil;}
  return [self copySystemStatus:error]; // enabled is NOT Source/registry grant
 }
 [self fail:@"AUTH_IDENTITY_HELPER_REQUIRES_MACOS13" error:error];return nil;
}
@end
