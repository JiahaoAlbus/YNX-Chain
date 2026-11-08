// PUBLIC integration fixture only. The production Auth stage, qualification,
// and extracted closure getter are compiled unchanged from a pinned supplier.
// This Source/holdPublic seam is not a reviewed Root or an issuance interface.
#ifndef YNX_LINK_PUBLIC_TASK_READ_NORMAL_CONSUMER
#error "PUBLIC fixture guard required"
#endif
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <node_api.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cerrno>
#include <memory>
#include <string>
#include <vector>
#include "desktop-grant-release-private.hpp"
#import "original-auth-identity-source-authority.h"
#import "original-auth-identity-joint-owner.h"

using PublicRelease = ynx::auth::desktopgrant::Release;
struct PublicHeldFile {
 int fd=-1;dev_t device{};ino_t inode{};off_t bytes{};std::string digest;
};
struct PublicSourceState {
 PublicRelease release;NSDictionary*__strong config=nil;
 std::vector<PublicHeldFile> files;bool retired=false,closed=false,failed=false;
 uint64_t current_calls=0,holds=0;std::string cause;
};
static YNXAuthIdentitySourceAuthority*__strong publicSource=nil;
static std::string publicDigest(NSData*data){
 unsigned char bytes[CC_SHA256_DIGEST_LENGTH];
 CC_SHA256(data.bytes,(CC_LONG)data.length,bytes);
 static const char hex[]="0123456789abcdef";std::string out;
 for(auto b:bytes){out+=hex[b>>4];out+=hex[b&15];}return out;
}
static NSDictionary*publicConfig(){
 const char*path=getenv("YNX_LINK_PUBLIC_NATIVE_CONFIG");
 if(!path)return nil;NSData*raw=[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:path]];
 if(!raw||raw.length>1048576)return nil;
 id value=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nullptr];
 return [value isKindOfClass:NSDictionary.class]?value:nil;
}
@implementation YNXAuthIdentityCurrentOwner
@end
@implementation YNXAuthIdentitySourceAuthority
+ (instancetype)acquireOriginalDesktopTaskGrantAuthoritySource:(NSError**)error {
 if(publicSource)return publicSource;
 NSDictionary*config=publicConfig();if(!config)return nil;
 auto*source=[YNXAuthIdentitySourceAuthority new];source->_publicState=new PublicSourceState;
 auto&s=*source->_publicState;s.config=config;
 s.release.task_read_module_path=[config[@"physical"] UTF8String];
 s.release.task_read_continuation_module_path=[config[@"carrier"] UTF8String];
 for(NSDictionary*pin in config[@"closure"]){
  s.release.task_read_continuation_code_closure.push_back({[pin[@"path"] UTF8String],[pin[@"sha256"] UTF8String],[pin[@"bytes"] unsignedLongLongValue]});
 }
 source->_desktopGrantPolicy=&s.release;publicSource=source;(void)error;return source;
}
- (BOOL)fail:(NSString*)message error:(NSError**)error {
 auto&s=*_publicState;s.failed=true;if(s.cause.empty())s.cause=message.UTF8String;
 if(error)*error=[NSError errorWithDomain:@"YNX-PUBLIC-Source-seam" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];
 return NO;
}
- (BOOL)assertOriginalDesktopTaskGrantAuthorityCurrent:(NSError**)error {
 auto&s=*_publicState;s.current_calls++;
 if(s.retired||s.closed||s.failed)return [self fail:@"PUBLIC_SOURCE_NOT_CURRENT" error:error];
 return [self heldCurrent:error];
}
- (NSDictionary*)copyOriginalDesktopTaskGrantAuthorityContext:(NSError**)error {
 if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error])return nil;
 return @{@"scope":@{@"PUBLIC":@YES},@"sourceId":@"PUBLIC-SOURCE-NOT-A-GRANT",@"instanceId":@"PUBLIC-INSTANCE",@"profileDigest":@"PUBLIC-NOT-ROOT",@"expiresAtMs":@((uint64_t)(NSDate.date.timeIntervalSince1970*1000.0)+60000)};
}
- (NSData*)holdPublic:(NSString*)path maximum:(uint64_t)maximum image:(BOOL)image digest:(const std::string&)digest error:(NSError**)error {
 int fd=open(path.fileSystemRepresentation,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);struct stat before{},after{};
 if(fd<0||fstat(fd,&before)||!S_ISREG(before.st_mode)||before.st_size<1||(uint64_t)before.st_size>maximum){if(fd>=0)close(fd);[self fail:@"PUBLIC_HELD_FILE_OPEN" error:error];return nil;}
 NSMutableData*raw=[NSMutableData dataWithLength:(NSUInteger)before.st_size];size_t offset=0;
 while(offset<raw.length){ssize_t n=pread(fd,(char*)raw.mutableBytes+offset,raw.length-offset,(off_t)offset);if(n<0&&errno==EINTR)continue;if(n<=0){close(fd);[self fail:@"PUBLIC_HELD_FILE_READ" error:error];return nil;}offset+=(size_t)n;}
 unsigned char extra=0;ssize_t eof=pread(fd,&extra,1,before.st_size);
 if(eof!=0||fstat(fd,&after)||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||publicDigest(raw)!=digest){close(fd);[self fail:@"PUBLIC_HELD_FILE_INTEGRITY" error:error];return nil;}
 _publicState->files.push_back({fd,before.st_dev,before.st_ino,before.st_size,digest});_publicState->holds++;
 (void)image;return [raw copy];
}
- (BOOL)heldCurrent:(NSError**)error {
 for(const auto&held:_publicState->files){struct stat value{};
  if(fstat(held.fd,&value)||value.st_dev!=held.device||value.st_ino!=held.inode||value.st_size!=held.bytes)return [self fail:@"PUBLIC_HELD_FILE_CHANGED" error:error];
 }
 return YES;
}
// The runner inserts only the exact pinned production method bytes here.
#include "PUBLIC-exact-source-getter.inc"
- (NSString*)copyOriginalDesktopTaskGrantBootstrapModule:(NSError**)error {if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error])return nil;return _publicState->config[@"bootstrap"];}
- (NSString*)copyOriginalDesktopTaskGrantLINKModule:(NSError**)error {(void)error;return nil;}
- (NSString*)copyOriginalDesktopTaskReadModule:(NSError**)error {if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error])return nil;return [NSString stringWithUTF8String:_publicState->release.task_read_module_path.c_str()];}
- (NSDictionary*)copyOriginalDesktopTaskGrantCallerRegistration:(NSError**)error {(void)error;return nil;}
- (NSDictionary*)copyOriginalDesktopTaskGrantLINKRegistration:(NSError**)error {(void)error;return nil;}
- (NSDictionary*)copyOriginalDesktopTaskReadAvailability:(NSError**)error {(void)error;return @{@"available":@NO};}
- (NSDictionary*)copyOriginalDesktopTaskReadMaterial:(NSError**)error {(void)error;return nil;}
- (NSDictionary*)copyOriginalDesktopTaskReadPeer:(NSError**)error {(void)error;return nil;}
- (NSDictionary*)copyOriginalDesktopTaskReadTarget:(NSError**)error {(void)error;return nil;}
- (BOOL)holdOriginalDesktopTaskGrantNativeAddress:(const void*)address error:(NSError**)error {(void)error;return address!=nullptr;}
- (void)retire {_publicState->retired=true;}
- (BOOL)join:(NSError**)error {(void)error;return _publicState->retired;}
- (BOOL)closeOriginalDesktopTaskGrantAuthority:(NSError**)error {
 auto&s=*_publicState;if(!s.retired)return NO;if(s.closed)return YES;
 for(auto&held:s.files){const int fd=held.fd;held.fd=-1;if(close(fd)){[self fail:@"PUBLIC_CLOSE_UNKNOWN" error:error];return NO;}}
 s.closed=true;return YES;
}
@end

// These are the unmodified, exact pinned production TUs, not replacements for
// their functions. No original three-TU control executable is run here.
#include "desktop-grant-qualification.mm"
#include "desktop-grant-native-stage.cpp"

static napi_value publicStats(napi_env env,napi_callback_info info){
 (void)info;napi_value out=nullptr;napi_create_object(env,&out);
 auto number=[&](const char*key,double value){napi_value v=nullptr;napi_create_double(env,value,&v);napi_set_named_property(env,out,key,v);};
 auto boolean=[&](const char*key,bool value){napi_value v=nullptr;napi_get_boolean(env,value,&v);napi_set_named_property(env,out,key,v);};
 if(publicSource){auto&s=*publicSource->_publicState;number("currentCalls",(double)s.current_calls);number("holds",(double)s.holds);number("openHeldFDs",(double)std::count_if(s.files.begin(),s.files.end(),[](const auto&v){return v.fd>=0;}));boolean("retired",s.retired);boolean("closed",s.closed);boolean("failed",s.failed);}
 boolean("PUBLICSourceSeam",true);boolean("RootAdmission",false);return out;
}
static napi_value publicInvalidate(napi_env env,napi_callback_info info){
 (void)info;if(publicSource)publicSource->_publicState->failed=true;napi_value v=nullptr;napi_get_undefined(env,&v);return v;
}
static napi_value publicInit(napi_env env,napi_value exports){
 RegisterOriginalTaskGrantAuthorityBackendV1(env,exports);
 napi_property_descriptor p[]={{"PUBLICFixtureStats",nullptr,publicStats,nullptr,nullptr,nullptr,napi_default,nullptr},{"invalidatePUBLICSource",nullptr,publicInvalidate,nullptr,nullptr,nullptr,napi_default,nullptr}};
 napi_define_properties(env,exports,2,p);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,publicInit)
