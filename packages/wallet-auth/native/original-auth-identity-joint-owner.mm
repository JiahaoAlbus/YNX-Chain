#import "original-auth-identity-joint-owner.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

static NSError *YNXAuthError(NSString *code) {
 return [NSError errorWithDomain:@"YNXOriginalAuthIdentity" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
}
static BOOL YNXAuthSameIdentity(struct stat a,struct stat b) {
 return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size
 &&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec
 &&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
}
static BOOL YNXAuthProtectedFile(struct stat s) {
 return S_ISREG(s.st_mode)&&s.st_nlink==1&&!(s.st_mode&0022)&&(s.st_uid==getuid()||s.st_uid==0)&&s.st_size>0&&s.st_size<=65536;
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
 NSUInteger _entered;
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
- (BOOL)capture:(NSError **)error {
 @synchronized(self){
  NSURL *resources=NSBundle.mainBundle.resourceURL;
  if(!resources.isFileURL)return [self fail:@"AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED" error:error];
  _rootPath=[[resources URLByAppendingPathComponent:@"original-auth-identity" isDirectory:YES] path];
  struct stat named;
  if(lstat(_rootPath.fileSystemRepresentation,&named)||!S_ISDIR(named.st_mode)||S_ISLNK(named.st_mode)||(named.st_mode&0022))return [self fail:@"AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED" error:error];
  _root=open(_rootPath.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(_root<0||fstat(_root,&_rootStat)||!YNXAuthSameIdentity(named,_rootStat))return [self fail:@"AUTH_IDENTITY_ROOT_CUSTODY_CHANGED" error:error];
  _profile=openat(_root,"profile.original",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  _head=openat(_root,"head.original",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  if(_profile<0||_head<0||fstat(_profile,&_profileStat)||fstat(_head,&_headStat)||!YNXAuthProtectedFile(_profileStat)||!YNXAuthProtectedFile(_headStat))return [self fail:@"AUTH_IDENTITY_PROFILE_CURRENT_NOT_SUPPLIED" error:error];
  _profileRaw=YNXAuthReadHeld(_profile,_profileStat,error);_headRaw=YNXAuthReadHeld(_head,_headStat,error);
  if(!_profileRaw||!_headRaw)return NO;
  return [self assertOriginalCurrent:error];
 }
}
- (BOOL)assertOriginalCurrent:(NSError **)error {
 @synchronized(self){
  if(_retired)return [self fail:@"AUTH_IDENTITY_ORIGINAL_RETIRED" error:error];
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
 // File custody is now implementing CODE. Authentic original Source/Identity
 // administration, Native-purpose approval and enforcing head/floor/revoke
 // still need the same Auth source-authority primitive, NOT a new signed domain.
 // Never parse OS-owned bytes or a claimed flag as independent authorization.
 return [self fail:@"AUTH_IDENTITY_SOURCE_AUTHORITY_NATIVE_PURPOSE_CODE_NOT_IMPLEMENTED" error:error];
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
