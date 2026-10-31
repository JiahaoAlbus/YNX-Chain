#import "original-auth-identity-joint-owner.h"
#include "original-auth-identity-public-limits.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <libproc.h>
#include <limits.h>
#include "original-ide-public-originals.h"

static NSURL *YNXActualIDEConsumerResources(void) {
 char parent[PROC_PIDPATHINFO_MAXSIZE]={0},self[PROC_PIDPATHINFO_MAXSIZE]={0};
 if(proc_pidpath(getppid(),parent,sizeof(parent))<=0||proc_pidpath(getpid(),self,sizeof(self))<=0)return nil;
 NSString *image=[NSString stringWithUTF8String:parent];
 NSString *app=image.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;
 NSBundle *bundle=[NSBundle bundleWithPath:app];NSURL *resources=bundle.resourceURL;
 if(!resources.isFileURL||![bundle.executableURL.path isEqual:image])return nil;
 NSString *expected=[resources.path stringByAppendingPathComponent:@"runtime/node"];
 char canonical[PATH_MAX];if(!realpath(expected.fileSystemRepresentation,canonical)||strcmp(self,canonical)!=0||![expected isEqual:[NSString stringWithUTF8String:canonical]])return nil;
 return resources;
}
static NSURL *YNXActualIDEObserverResources(void) {
 char self[PROC_PIDPATHINFO_MAXSIZE]={0},canonical[PATH_MAX]={0};
 if(proc_pidpath(getpid(),self,sizeof(self))<=0)return nil;
 NSBundle*b=NSBundle.mainBundle;
 if(![b.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"]||![b.bundleURL.path.pathExtension isEqual:@"app"]||!b.resourceURL.isFileURL||!realpath(b.executableURL.path.fileSystemRepresentation,canonical)||strcmp(self,canonical)||![b.executableURL.path isEqual:[NSString stringWithUTF8String:canonical]])return nil;
 return b.resourceURL;
}
// Public canonical original files live OUTSIDE signed App resources. Otherwise
// the profile's final code identities and ephemeral request would sign-cycle.
// Proposed fixed custody layout, not an enrollment/provisioning operation.
// No HOME/ENV/caller path, no mkdir/write, no private key is ever accessed.
static NSURL *YNXOriginalIDERegistryResources(void){
 if(getuid()!=geteuid()||getgid()!=getegid())return nil;
 NSString *base=[NSString stringWithUTF8String:ynx_auth_ide_private::originalIDERegistryBase(getuid()).c_str()];
 return [NSURL fileURLWithPath:base isDirectory:YES];
}
// Separate fixed Wallet namespace, not Developer/SSO/IDE purpose lending.
static NSURL *YNXOriginalWalletPQRegistryResources(void){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 NSString *base=[NSString stringWithFormat:@"/Library/Application Support/YNX/OriginalAuthIdentity/UID-%u/Wallet/PQHostCatalog",getuid()];
 return [NSURL fileURLWithPath:base isDirectory:YES];
}
static NSURL *YNXOriginalProductDeviceV4RegistryResources(void){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 // Read-only code-defined separate namespace. No mkdir/provisioning, ENV or
 // caller path. Presence of files never supplies admission by itself.
 NSString*base=[NSString stringWithFormat:@"/Library/Application Support/YNX/OriginalAuthIdentity/UID-%u/Wallet/ProductSessionDeviceV4",getuid()];
 return [NSURL fileURLWithPath:base isDirectory:YES];
}
static NSURL *YNXOriginalProductDeviceV4PendingRegistryResources(void){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 NSString*base=[NSString stringWithFormat:@"/Library/Application Support/YNX/OriginalAuthIdentity/UID-%u/Wallet/ProductSessionDeviceV4Pending",getuid()];
 return [NSURL fileURLWithPath:base isDirectory:YES];
}
static NSURL *YNXOriginalProductDeviceV4ProvisioningRegistryResources(void){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 NSString*base=[NSString stringWithFormat:@"/Library/Application Support/YNX/OriginalAuthIdentity/UID-%u/Wallet/ProductSessionDeviceV4Provisioning",getuid()];
 return [NSURL fileURLWithPath:base isDirectory:YES];
}
static BOOL YNXOriginalIDEProtectedAncestors(NSString *path){
 NSString *part=@"/";for(NSString *name in path.pathComponents){if([name isEqual:@"/"])continue;part=[part stringByAppendingPathComponent:name];struct stat s;
  if(lstat(part.fileSystemRepresentation,&s)||!ynx_auth_ide_private::originalIDERegistryDirectory(s))return NO;
 }return YES;
}

static NSError *YNXAuthError(NSString *code) {
 return [NSError errorWithDomain:@"YNXOriginalAuthIdentity" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
}
static BOOL YNXAuthSameIdentity(struct stat a,struct stat b) {
 return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size
 &&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec
 &&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
}
static BOOL YNXAuthProtectedFile(struct stat s) {
 return S_ISREG(s.st_mode)&&s.st_nlink==1&&!(s.st_mode&0022)&&(s.st_uid==getuid()||s.st_uid==0)&&s.st_size>0&&s.st_size<=(off_t)ynx_auth_private::OriginalAuthPublicOriginalMax;
}
// Retains exact original raw bytes and FD. No pathname/profile/key is accepted
// from renderer, environment, caller dictionary or an approving callback.
static NSData *YNXAuthReadHeld(int fd,struct stat expected,NSError **error) {
 struct stat before,after;
 if(fstat(fd,&before)||!YNXAuthSameIdentity(before,expected)||!YNXAuthProtectedFile(before)){if(error)*error=YNXAuthError(@"AUTH_IDENTITY_HELD_SOURCE_CHANGED");return nil;}
 NSMutableData *data=[NSMutableData dataWithLength:(NSUInteger)before.st_size];size_t count=0;
 while(count<data.length){ssize_t n=pread(fd,(char *)data.mutableBytes+count,data.length-count,(off_t)count);if(n<=0){if(error)*error=YNXAuthError(@"AUTH_IDENTITY_SOURCE_READ_INCOMPLETE");return nil;}count+=(size_t)n;}
 if(fstat(fd,&after)||!YNXAuthSameIdentity(before,after)){if(error)*error=YNXAuthError(@"AUTH_IDENTITY_HELD_SOURCE_CHANGED");return nil;}return [data copy];
}
@interface YNXAuthIdentityCurrentOwner ()
- (BOOL)capture:(NSError **)error;
@end
@implementation YNXAuthIdentityCurrentOwner {
 int _root,_profile,_head;
 struct stat _rootStat,_profileStat,_headStat;
 NSString *_rootPath;
 NSData *_profileRaw,*_headRaw;
 BOOL _retired,_closeSelected,_cleanupComplete;
 NSUInteger _entered;BOOL _ideConsumer,_ideRegistry,_contractRelay,_projectAuthority,_projectControl,_walletPQCatalog,_ideProjectObserver,_productDeviceV4,_productDeviceV4Pending,_productDeviceV4Provisioning;
 NSString *_actualIDEResources;
 NSError *_firstCause,*_cleanupCause;
}
- (instancetype)init {if((self=[super init]))_root=_profile=_head=-1;return self;}
- (BOOL)fail:(NSString *)code error:(NSError **)error {if(!_firstCause)_firstCause=YNXAuthError(code);if(error)*error=_firstCause;return NO;}
+ (instancetype)acquireOriginalAdministrationProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner *owner=[self new];
 if([owner capture:error])return owner;
 // No owner is discarded with an uncertain descriptor close. The returned
// retired owner is cleanup custody only, never an approving guard.
 [owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalIDEConsumerProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner *owner=[self new];owner->_ideConsumer=YES;owner->_ideRegistry=YES;
 if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalIDERegistryProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner *owner=[self new];owner->_ideRegistry=YES;
 if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalIDEContractRelayProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner *owner=[self new];owner->_ideConsumer=YES;owner->_ideRegistry=YES;owner->_contractRelay=YES;
 if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalIDEProjectAuthorityProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner *owner=[self new];owner->_ideConsumer=YES;owner->_ideRegistry=YES;owner->_projectAuthority=YES;
 if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalIDEProjectObserverProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner*owner=[self new];owner->_ideRegistry=YES;owner->_projectAuthority=YES;owner->_ideProjectObserver=YES;
 if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalIDEProjectControlProfile:(NSError **)error {
 // Wallet-side original capture, not an IDE child path/ENV/provider. Same
 // protected external registry, separate purpose-specific leaf and custody.
 YNXAuthIdentityCurrentOwner *owner=[self new];owner->_ideRegistry=YES;owner->_projectControl=YES;
 if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalWalletPQHostCatalogProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner *owner=[self new];owner->_ideRegistry=YES;owner->_walletPQCatalog=YES;
 if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;
}
+ (instancetype)acquireOriginalProductSessionDeviceV4Profile:(NSError **)error {
 YNXAuthIdentityCurrentOwner*owner=[self new];owner->_ideRegistry=YES;owner->_productDeviceV4=YES;
 try{@try{if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;}
 @catch(id){[owner fail:@"PRODUCT_DEVICE_V4_PROFILE_CAPTURE_EXCEPTION" error:error];return owner;}}
 catch(...){[owner fail:@"PRODUCT_DEVICE_V4_PROFILE_CAPTURE_CPP_EXCEPTION" error:error];return owner;}
}
+ (instancetype)acquireOriginalProductSessionDeviceV4PendingProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner*owner=[self new];owner->_ideRegistry=YES;owner->_productDeviceV4Pending=YES;
 try{@try{if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;}
 @catch(id){[owner fail:@"PRODUCT_PENDING_V4_PROFILE_EXCEPTION" error:error];return owner;}}
 catch(...){[owner fail:@"PRODUCT_PENDING_V4_PROFILE_CPP" error:error];return owner;}
}
+ (instancetype)acquireOriginalProductSessionDeviceV4ProvisioningProfile:(NSError **)error {
 YNXAuthIdentityCurrentOwner*owner=[self new];owner->_ideRegistry=YES;owner->_productDeviceV4Provisioning=YES;
 try{@try{if([owner capture:error])return owner;[owner retire];if(![owner close:nil])return owner;return nil;}
 @catch(id){[owner fail:@"PRODUCT_PROVISIONING_V4_PROFILE_EXCEPTION" error:error];return owner;}}
 catch(...){[owner fail:@"PRODUCT_PROVISIONING_V4_PROFILE_CPP" error:error];return owner;}
}
- (NSString *)copyOriginalResourceDirectory:(NSError **)error {
 @synchronized(self){if(![self assertOriginalCurrent:error])return nil;return [_rootPath.stringByDeletingLastPathComponent copy];}
}
- (BOOL)capture:(NSError **)error {
 @synchronized(self){
  if(_ideConsumer){_actualIDEResources=YNXActualIDEConsumerResources().path;if(!_actualIDEResources)return [self fail:@"AUTH_IDENTITY_IDE_ACTUAL_PARENT_ENTRY_UNAVAILABLE" error:error];}
  if(_ideProjectObserver){_actualIDEResources=YNXActualIDEObserverResources().path;if(!_actualIDEResources)return [self fail:@"IDE_OBSERVER_ACTUAL_APP_UNAVAILABLE" error:error];}
  NSURL *resources=_productDeviceV4Provisioning?YNXOriginalProductDeviceV4ProvisioningRegistryResources():_productDeviceV4Pending?YNXOriginalProductDeviceV4PendingRegistryResources():_productDeviceV4?YNXOriginalProductDeviceV4RegistryResources():_walletPQCatalog?YNXOriginalWalletPQRegistryResources():_ideRegistry?YNXOriginalIDERegistryResources():NSBundle.mainBundle.resourceURL;
  if(_contractRelay)resources=[resources URLByAppendingPathComponent:@"contract-relay" isDirectory:YES];
  if(_projectAuthority)resources=[resources URLByAppendingPathComponent:@"project-authority" isDirectory:YES];
  if(_projectControl)resources=[resources URLByAppendingPathComponent:@"project-control" isDirectory:YES];
  if(!resources.isFileURL)return [self fail:@"AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED" error:error];
  _rootPath=[[resources URLByAppendingPathComponent:@"original-auth-identity" isDirectory:YES] path];
  if(_ideRegistry&&!YNXOriginalIDEProtectedAncestors(_rootPath))return [self fail:@"AUTH_IDENTITY_IDE_EXTERNAL_ORIGINALS_NOT_PROTECTED" error:error];
  struct stat named;
  if(lstat(_rootPath.fileSystemRepresentation,&named)||!S_ISDIR(named.st_mode)||S_ISLNK(named.st_mode)||(named.st_mode&0022))return [self fail:@"AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED" error:error];
  _root=open(_rootPath.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(_root<0||fstat(_root,&_rootStat)||!YNXAuthSameIdentity(named,_rootStat))return [self fail:@"AUTH_IDENTITY_ROOT_CUSTODY_CHANGED" error:error];
  _profile=openat(_root,"profile.original",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  _head=openat(_root,"head.original",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  if(_profile<0||_head<0||fstat(_profile,&_profileStat)||fstat(_head,&_headStat)||!YNXAuthProtectedFile(_profileStat)||!YNXAuthProtectedFile(_headStat)||(_ideRegistry&&(!ynx_auth_ide_private::originalIDERegistryPublicFile(_profileStat)||!ynx_auth_ide_private::originalIDERegistryPublicFile(_headStat))))return [self fail:@"AUTH_IDENTITY_PROFILE_CURRENT_NOT_SUPPLIED" error:error];
  _profileRaw=YNXAuthReadHeld(_profile,_profileStat,error);_headRaw=YNXAuthReadHeld(_head,_headStat,error);
  if(!_profileRaw||!_headRaw)return NO;
  return [self assertOriginalCurrent:error];
 }
}
- (BOOL)assertOriginalCurrent:(NSError **)error {
 @synchronized(self){
  if(_retired)return [self fail:@"AUTH_IDENTITY_ORIGINAL_RETIRED" error:error];
  if(_ideConsumer&&![YNXActualIDEConsumerResources().path isEqual:_actualIDEResources])return [self fail:@"AUTH_IDENTITY_IDE_ACTUAL_PARENT_ENTRY_CHANGED" error:error];
  if(_ideProjectObserver&&![YNXActualIDEObserverResources().path isEqual:_actualIDEResources])return [self fail:@"IDE_OBSERVER_ACTUAL_APP_CHANGED" error:error];
  NSURL *expectedRegistry=_productDeviceV4Provisioning?YNXOriginalProductDeviceV4ProvisioningRegistryResources():_productDeviceV4Pending?YNXOriginalProductDeviceV4PendingRegistryResources():_productDeviceV4?YNXOriginalProductDeviceV4RegistryResources():_walletPQCatalog?YNXOriginalWalletPQRegistryResources():YNXOriginalIDERegistryResources();
  if(_contractRelay)expectedRegistry=[expectedRegistry URLByAppendingPathComponent:@"contract-relay" isDirectory:YES];
  if(_projectAuthority)expectedRegistry=[expectedRegistry URLByAppendingPathComponent:@"project-authority" isDirectory:YES];
  if(_projectControl)expectedRegistry=[expectedRegistry URLByAppendingPathComponent:@"project-control" isDirectory:YES];
  if(_ideRegistry&&(![expectedRegistry.path isEqual:_rootPath.stringByDeletingLastPathComponent]||!YNXOriginalIDEProtectedAncestors(_rootPath)))return [self fail:@"AUTH_IDENTITY_IDE_EXTERNAL_ORIGINALS_CHANGED" error:error];
  struct stat root,profile,head,namedRoot,namedProfile,namedHead;
  if(_root<0||_profile<0||_head<0||fstat(_root,&root)||fstat(_profile,&profile)||fstat(_head,&head)||lstat(_rootPath.fileSystemRepresentation,&namedRoot)
   ||fstatat(_root,"profile.original",&namedProfile,AT_SYMLINK_NOFOLLOW)||fstatat(_root,"head.original",&namedHead,AT_SYMLINK_NOFOLLOW)
   ||!YNXAuthSameIdentity(root,_rootStat)||!YNXAuthSameIdentity(root,namedRoot)||!YNXAuthSameIdentity(profile,_profileStat)||!YNXAuthSameIdentity(profile,namedProfile)||!YNXAuthSameIdentity(head,_headStat)||!YNXAuthSameIdentity(head,namedHead))return [self fail:@"AUTH_IDENTITY_ORIGINAL_CURRENT_CHANGED" error:error];
  NSData *profileRaw=YNXAuthReadHeld(_profile,_profileStat,error),*headRaw=YNXAuthReadHeld(_head,_headStat,error);
  if(!profileRaw||!headRaw||![profileRaw isEqual:_profileRaw]||![headRaw isEqual:_headRaw])return [self fail:@"AUTH_IDENTITY_ORIGINAL_CURRENT_CHANGED" error:error];
  return YES;
 }
}
- (NSData *)copyOriginalProfile:(NSError **)error {
 @synchronized(self){if(![self assertOriginalCurrent:error])return nil;_entered++;NSData *result=[_profileRaw copy];BOOL live=[self assertOriginalCurrent:error];_entered--;return live?result:nil;}
}
- (NSData *)copyOriginalHead:(NSError **)error {
 @synchronized(self){if(![self assertOriginalCurrent:error])return nil;_entered++;NSData *result=[_headRaw copy];BOOL live=[self assertOriginalCurrent:error];_entered--;return live?result:nil;}
}
- (BOOL)assertIndependentNativePurposeAdmission:(NSError **)error {
 if(![self assertOriginalCurrent:error])return NO;
 // This object is raw custody only, NOT the Source-authority verifier.
 // Authentication is YNXAuthIdentitySourceAuthority's separate original
 // contract. Never promote a held file or this legacy method to admission.
 return [self fail:@"AUTH_IDENTITY_RAW_CUSTODY_IS_NOT_NATIVE_AUTHORITY" error:error];
}
- (BOOL)nativeQualified {return NO;}
- (BOOL)cleanupComplete {@synchronized(self){return _cleanupComplete;}}
- (void)retire {@synchronized(self){_retired=YES;}}
- (BOOL)join:(NSError **)error {@synchronized(self){if(!_retired)return [self fail:@"AUTH_IDENTITY_NOT_RETIRED" error:error];if(_entered)return [self fail:@"AUTH_IDENTITY_ENTERED_READ_PENDING" error:error];return YES;}}
- (BOOL)close:(NSError **)error {
 @synchronized(self){
  _retired=YES;if(_closeSelected){if(error)*error=_cleanupCause;return _cleanupComplete;}
  if(![self join:error])return NO;_closeSelected=YES;
  int *fds[]={&_head,&_profile,&_root};
  for(unsigned i=0;i<3;i++){int fd=*fds[i];if(fd<0)continue;if(close(fd)<0){if(!_cleanupCause)_cleanupCause=YNXAuthError(@"AUTH_IDENTITY_ORIGINAL_CLOSE_UNKNOWN");}else *fds[i]=-1;}
  _cleanupComplete=_cleanupCause==nil;if(error)*error=_cleanupCause;return _cleanupComplete;
 }
}
@end
