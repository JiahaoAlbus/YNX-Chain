#import "original-auth-identity-source-authority.h"
#include "original-source-verifier-io.h"
#import "original-auth-identity-joint-owner.h"
#include "original-auth-identity-native-release.h"
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <limits.h>
#include <vector>

static NSString *SourceSHA(NSData *raw){unsigned char bytes[CC_SHA256_DIGEST_LENGTH];CC_SHA256(raw.bytes,(CC_LONG)raw.length,bytes);NSMutableString *out=[NSMutableString string];for(auto c:bytes)[out appendFormat:@"%02x",c];return out;}
static bool SourceSame(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
struct SourceHeldPublic {int fd;struct stat identity;NSString *__strong path;bool selected=false,complete=false;};
@implementation YNXAuthIdentitySourceAuthority {
 YNXAuthIdentityCurrentOwner *_custody;
 NSData *_profileOriginal,*_headOriginal,*_rootOriginal,*_enrollmentOriginal;
 NSDictionary *_selection;
 const ynx_auth_private::NativeSourceRelease *_policy;
 std::vector<SourceHeldPublic> _files;
 NSTask *_task;
 NSMutableArray<NSFileHandle *> *_pipeHandles;NSMutableArray<NSNumber *> *_pipeStates;
 uint64_t _sequence,_floor,_timeFloor;NSString *_headDigest;
 BOOL _retired,_invalid,_entered,_closeSelected,_cleanupComplete,_ideRegistry;
 NSError *_firstCause,*_cleanupCause;
}
- (BOOL)fail:(NSString *)code error:(NSError **)error {
 _invalid=YES;if(!_firstCause)_firstCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_firstCause;return NO;
}
- (BOOL)closeHeldPipes {
 BOOL ok=YES;for(NSUInteger i=0;i<_pipeHandles.count;i++){
  if(_pipeStates[i].intValue!=0){if(_pipeStates[i].intValue!=1)ok=NO;continue;}
  _pipeStates[i]=@2;NSError *e=nil;BOOL done=[_pipeHandles[i] closeAndReturnError:&e];_pipeStates[i]=done?@1:@2;if(!done)ok=NO;
 }return ok;
}
- (NSData *)holdPublic:(NSString *)path maximum:(NSUInteger)maximum image:(BOOL)image digest:(const std::string&)digest error:(NSError **)error {
 char resolved[PATH_MAX];if(!path||!realpath(path.fileSystemRepresentation,resolved)||![path isEqual:[NSString stringWithUTF8String:resolved]]){[self fail:@"AUTH_IDENTITY_NATIVE_RELEASE_PATH_INVALID" error:error];return nil;}
 // Executed verifier/interpreter require root-owned nonwritable ancestor chain.
 if(image){NSString *part=@"/";for(NSString *name in path.stringByDeletingLastPathComponent.pathComponents){if([name isEqual:@"/"])continue;part=[part stringByAppendingPathComponent:name];struct stat st;if(lstat(part.fileSystemRepresentation,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&0022)){[self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_INSTALL_NOT_PROTECTED" error:error];return nil;}}}
 int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);if(fd<0){[self fail:@"AUTH_IDENTITY_NATIVE_RELEASE_NOT_SUPPLIED" error:error];return nil;}
 struct stat s{},named{};_files.push_back({fd,s,path,false,false});auto &held=_files.back();
 if(fstat(fd,&s)||lstat(path.fileSystemRepresentation,&named)||!SourceSame(s,named)||!S_ISREG(s.st_mode)||s.st_nlink!=1||(s.st_mode&0022)||(s.st_uid!=0&&s.st_uid!=getuid())||((image||_ideRegistry)&&s.st_uid!=0)||s.st_size<1||(uint64_t)s.st_size>maximum){[self fail:@"AUTH_IDENTITY_NATIVE_RELEASE_IDENTITY_INVALID" error:error];return nil;}held.identity=s;
 NSMutableData *raw=[NSMutableData dataWithLength:(NSUInteger)s.st_size];size_t offset=0;
 while(offset<raw.length){ssize_t n=pread(fd,(char *)raw.mutableBytes+offset,raw.length-offset,(off_t)offset);if(n<=0){[self fail:@"AUTH_IDENTITY_NATIVE_RELEASE_READ_UNKNOWN" error:error];return nil;}offset+=(size_t)n;}
 struct stat after{};if(fstat(fd,&after)||lstat(path.fileSystemRepresentation,&named)||!SourceSame(s,after)||!SourceSame(s,named)||![SourceSHA(raw) isEqual:[NSString stringWithUTF8String:digest.c_str()]]){[self fail:@"AUTH_IDENTITY_NATIVE_RELEASE_DIGEST_INVALID" error:error];return nil;}return [raw copy];
}
+ (instancetype)acquireOriginalSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority *s=[self new];s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalAdministrationProfile:error];if(!s->_custody)return nil;
 s->_profileOriginal=[s->_custody copyOriginalProfile:error];s->_headOriginal=[s->_custody copyOriginalHead:error];
 if(s->_profileOriginal&&s->_headOriginal){
  id envelope=[NSJSONSerialization JSONObjectWithData:s->_profileOriginal options:0 error:nil];id body=[envelope isKindOfClass:NSDictionary.class]?envelope[@"body"]:nil;id source=[body isKindOfClass:NSDictionary.class]?body[@"sourceId"]:nil;
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(!s->_policy)[s fail:@"AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_SUPPLIED" error:error];
  else{
   NSString *root=[NSBundle.mainBundle.resourceURL.path stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:8192 image:NO digest:s->_policy->rootDigest error:error];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:32768 image:NO digest:s->_policy->enrollmentDigest error:error];
   if(s->_enrollmentOriginal&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:error]&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:error]&&[s assertAuthenticatedNativePurpose:error])return s;
  }
 }
 [s retire];if(![s close:nil])return s;return nil;
}
+ (instancetype)acquireOriginalIDEConsumerSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority *s=[self new];s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalIDEConsumerProfile:error];if(!s->_custody)return nil;
 s->_profileOriginal=[s->_custody copyOriginalProfile:error];s->_headOriginal=[s->_custody copyOriginalHead:error];
 if(s->_profileOriginal&&s->_headOriginal){
  id envelope=[NSJSONSerialization JSONObjectWithData:s->_profileOriginal options:0 error:nil];id body=[envelope isKindOfClass:NSDictionary.class]?envelope[@"body"]:nil;id source=[body isKindOfClass:NSDictionary.class]?body[@"sourceId"]:nil;
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(!s->_policy)[s fail:@"AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_SUPPLIED" error:error];
  else{
   NSString *root=[[s->_custody copyOriginalResourceDirectory:error] stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:8192 image:NO digest:s->_policy->rootDigest error:error];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:32768 image:NO digest:s->_policy->enrollmentDigest error:error];
   if(s->_enrollmentOriginal&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:error]&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:error]&&[s assertAuthenticatedNativePurpose:error])return s;
  }
 }
 [s retire];if(![s close:nil])return s;return nil;
}
+ (instancetype)acquireOriginalIDEParentSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority *s=[self new];s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalIDERegistryProfile:error];if(!s->_custody)return nil;
 s->_profileOriginal=[s->_custody copyOriginalProfile:error];s->_headOriginal=[s->_custody copyOriginalHead:error];
 if(s->_profileOriginal&&s->_headOriginal){
  id envelope=[NSJSONSerialization JSONObjectWithData:s->_profileOriginal options:0 error:nil];id body=[envelope isKindOfClass:NSDictionary.class]?envelope[@"body"]:nil;id source=[body isKindOfClass:NSDictionary.class]?body[@"sourceId"]:nil;
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(!s->_policy)[s fail:@"AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_SUPPLIED" error:error];
  else{
   NSString *root=[[s->_custody copyOriginalResourceDirectory:error] stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:8192 image:NO digest:s->_policy->rootDigest error:error];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:32768 image:NO digest:s->_policy->enrollmentDigest error:error];
   if(s->_enrollmentOriginal&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:error]&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:error]&&[s assertAuthenticatedNativePurpose:error])return s;
  }
 }
 [s retire];if(![s close:nil])return s;return nil;
}
- (BOOL)heldCurrent:(NSError **)error {
 if(_invalid||_retired||!_policy||![_custody assertOriginalCurrent:error])return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CURRENT_UNAVAILABLE" error:error];
 for(const auto &file:_files){struct stat held{},named{};if(file.selected||fstat(file.fd,&held)||lstat(file.path.fileSystemRepresentation,&named)||!SourceSame(file.identity,held)||!SourceSame(file.identity,named))return [self fail:@"AUTH_IDENTITY_NATIVE_RELEASE_CHANGED" error:error];}return YES;
}
- (BOOL)assertCurrent:(NSError **)error {return [self assertAuthenticatedNativePurpose:error];}
- (BOOL)assertAuthenticatedNativePurpose:(NSError **)error {
 @synchronized(self){
  if(_entered)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_REENTRANT" error:error];
  if(![self heldCurrent:error])return NO;_entered=YES;
  @try{
   uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(before<_timeFloor)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CLOCK_ROLLBACK" error:error];
   NSDictionary *contract=@{@"purpose":[NSString stringWithUTF8String:_policy->purpose.c_str()],@"enrollmentFrame":[NSString stringWithUTF8String:_policy->enrollmentFrame.c_str()],@"profileFrame":[NSString stringWithUTF8String:_policy->profileFrame.c_str()],@"currentFrame":[NSString stringWithUTF8String:_policy->currentFrame.c_str()]};
   NSDictionary *policy=@{@"rootDigest":[NSString stringWithUTF8String:_policy->rootDigest.c_str()],@"enrollmentDigest":[NSString stringWithUTF8String:_policy->enrollmentDigest.c_str()],@"endpoint":[NSString stringWithUTF8String:_policy->endpoint.c_str()],@"spki":[NSString stringWithUTF8String:_policy->spki.c_str()],@"signatureContract":contract};
   NSDictionary *input=@{@"rootRaw":[[NSString alloc]initWithData:_rootOriginal encoding:NSUTF8StringEncoding],@"enrollmentRaw":[[NSString alloc]initWithData:_enrollmentOriginal encoding:NSUTF8StringEncoding],@"profileRaw":[[NSString alloc]initWithData:_profileOriginal encoding:NSUTF8StringEncoding],@"headRaw":[[NSString alloc]initWithData:_headOriginal encoding:NSUTF8StringEncoding],@"policy":policy,@"previous":@{@"sequence":@(_sequence),@"floor":@(_floor),@"head":_headDigest,@"timeFloor":@(_timeFloor)}};
   NSData *raw=[NSJSONSerialization dataWithJSONObject:input options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!raw||raw.length>131072)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CAPACITY" error:error];
   NSPipe *in=[NSPipe pipe],*out=[NSPipe pipe],*errors=[NSPipe pipe];
   for(NSFileHandle *handle in @[in.fileHandleForReading,in.fileHandleForWriting,out.fileHandleForReading,out.fileHandleForWriting,errors.fileHandleForReading,errors.fileHandleForWriting]){[_pipeHandles addObject:handle];[_pipeStates addObject:@0];}
   _task=[NSTask new];_task.executableURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:_policy->nodeImagePath.c_str()]];_task.arguments=@[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]];_task.environment=@{};_task.standardInput=in;_task.standardOutput=out;_task.standardError=errors;
   NSError *launch=nil;if(![_task launchAndReturnError:&launch])return [self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_EXEC_UNAVAILABLE" error:error];
   NSTask *owned=_task;dispatch_after(dispatch_time(DISPATCH_TIME_NOW,7*NSEC_PER_SEC),dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{if(owned.running)[owned terminate];});
   NSUInteger writer=[_pipeHandles indexOfObjectIdenticalTo:in.fileHandleForWriting];BOOL writerDone=NO;
   std::vector<unsigned char> verifiedBytes;
   try{
    verifiedBytes=ynx_auth_private::boundedVerifierIO(in.fileHandleForWriting.fileDescriptor,out.fileHandleForReading.fileDescriptor,errors.fileHandleForReading.fileDescriptor,
     (const unsigned char *)raw.bytes,raw.length,[&](){_pipeStates[writer]=@2;NSError *writerError=nil;writerDone=[in.fileHandleForWriting closeAndReturnError:&writerError];_pipeStates[writer]=writerDone?@1:@2;return (bool)writerDone;},[&](){return (bool)_task.running;});
   }catch(const std::exception &failure){return [self fail:[NSString stringWithUTF8String:failure.what()] error:error];}
   NSData *result=[NSData dataWithBytes:verifiedBytes.data() length:verifiedBytes.size()];
   if(!writerDone||![self closeHeldPipes])return [self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_CLOSE_UNKNOWN" error:error];
   if(_task.terminationStatus!=0||result.length>65536)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_VERIFICATION_FAILED" error:error];
   id parsed=[NSJSONSerialization JSONObjectWithData:result options:0 error:nil];NSDictionary *projection=[parsed isKindOfClass:NSDictionary.class]?parsed[@"projection"]:nil;
   if(![projection isKindOfClass:NSDictionary.class]||![projection[@"selection"] isKindOfClass:NSDictionary.class]||![projection[@"head"] isKindOfClass:NSString.class])return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_PROJECTION_INVALID" error:error];
   uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),sequence=[projection[@"sequence"] unsignedLongLongValue],floor=[projection[@"floor"] unsignedLongLongValue],expires=[projection[@"expiresAtMs"] unsignedLongLongValue];
   if(after<before||after<_timeFloor||sequence<_sequence||floor<_floor||floor>sequence||after>=expires||(sequence==_sequence&&_sequence&&![projection[@"head"] isEqual:_headDigest])||![self heldCurrent:error])return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_POST_FENCE_FAILED" error:error];
   _selection=[projection[@"selection"] copy];_sequence=sequence;_floor=floor;_headDigest=[projection[@"head"] copy];_timeFloor=after;return YES;
  }@catch(NSException *){return [self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_UNKNOWN" error:error];}
  @finally{_entered=NO;}
 }
}
- (NSDictionary *)copyOriginalSelection:(NSError **)error {if(![self assertAuthenticatedNativePurpose:error])return nil;NSDictionary *original=[_selection copy];if(![self heldCurrent:error])return nil;return original;}
- (NSNumber *)copyOriginalCurrentSequence:(NSError **)error {@synchronized(self){if(![self assertAuthenticatedNativePurpose:error])return nil;NSNumber *sequence=@(_sequence);return [self heldCurrent:error]?sequence:nil;}}
- (void)retire {@synchronized(self){_retired=YES;[_custody retire];}}
- (BOOL)join:(NSError **)error {@synchronized(self){if(!_retired||_entered||_task.running)return [self fail:@"AUTH_IDENTITY_SOURCE_JOIN_PENDING" error:error];return [_custody join:error];}}
- (BOOL)close:(NSError **)error {
 @synchronized(self){[self retire];if(_closeSelected){if(error)*error=_cleanupCause;return _cleanupComplete;}
  if(![self join:error])return NO;_closeSelected=YES;BOOL filesClosed=YES;
  for(auto &file:_files){if(file.selected){if(!file.complete)filesClosed=NO;continue;}file.selected=true;file.complete=::close(file.fd)==0;if(!file.complete)filesClosed=NO;}if(![self closeHeldPipes])filesClosed=NO;
  NSError *cause=nil;BOOL custodyClosed=[_custody close:&cause];_cleanupComplete=filesClosed&&custodyClosed;if(!_cleanupComplete)_cleanupCause=cause?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_SOURCE_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return _cleanupComplete;}
}
@end

