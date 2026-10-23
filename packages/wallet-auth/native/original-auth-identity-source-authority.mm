#import "original-auth-identity-source-authority.h"
#import "original-ide-helper-xpc-peer.h"
#import "original-ide-helper-client.h"
#include "original-source-verifier-io.h"
#include "original-source-provisioning-fence.h"
#include "original-auth-identity-public-limits.h"
#include "original-source-public-installation.h"
#include "original-ide-public-originals.h"
#include <memory>
#include <chrono>
#import "original-auth-identity-joint-owner.h"
#include "original-auth-identity-native-release.h"
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <fcntl.h>
#include <unistd.h>
#include <limits.h>
#include <vector>
#include "original-ide-auth-proof-data.h"
#include "original-auth-source-v2-native-data.h"

static NSString *SourceSHA(NSData *raw){unsigned char bytes[CC_SHA256_DIGEST_LENGTH];CC_SHA256(raw.bytes,(CC_LONG)raw.length,bytes);NSMutableString *out=[NSMutableString string];for(auto c:bytes)[out appendFormat:@"%02x",c];return out;}
static bool SourceSame(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
struct SourceHeldPublic {int fd;struct stat identity;NSString *__strong path;bool selected=false,complete=false;};
@implementation YNXAuthIdentitySourceAuthority {
 YNXAuthIdentityCurrentOwner *_custody;
 YNXIDEHelperMessagePeer *_helperPeer;
 YNXIDEHelperClient *_helperClient;
 NSData *_receiveRequestOriginal,*_receiveProofOriginal;NSDictionary*_remoteReceiveActual;
 NSData *_ideProofRequestOriginal,*_ideProofInvocationOriginal,*_ideProofDataOriginal;
 NSDictionary *_ideProofObservation;BOOL _ideProofObservationEntered;
 NSData *_profileOriginal,*_headOriginal,*_rootOriginal,*_enrollmentOriginal;
 NSData *_currentOriginal;NSString *_currentNonce;BOOL _firstEnterPinned;
 NSDictionary *_selection;
 const ynx_auth_private::NativeSourceRelease *_policy;
 std::vector<SourceHeldPublic> _files;
 NSTask *_task;
 NSMutableArray<NSFileHandle *> *_pipeHandles;NSMutableArray<NSNumber *> *_pipeStates;
 uint64_t _sequence,_floor,_timeFloor,_cachedCurrentExpiresMS;NSString *_headDigest,*_observationHeight;
 BOOL _relayLocalEntered;
 BOOL _relayRuntimePinned,_relayRuntimeEntered;
 NSData *_relayRuntimeManifestOriginal;
 BOOL _proofClosurePinned,_ideProofSelected,_ideProofVerified;
 BOOL _retired,_invalid,_entered,_closeSelected,_cleanupComplete,_ideRegistry;
 NSError *_firstCause,*_cleanupCause;
 std::unique_ptr<ynx_auth_private::SourcePublicInstallation> _publicInstallation;
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
  NSDictionary *body=SourceOriginalBodyHint(s->_profileOriginal);id source=body[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(!s->_policy)[s fail:@"AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_SUPPLIED" error:error];
  else{
   NSString *root=[NSBundle.mainBundle.resourceURL.path stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:error];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:error];
   if(s->_enrollmentOriginal&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:error]&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:error]&&[s assertAuthenticatedNativePurpose:error])return s;
  }
 }
 [s retire];if(![s close:nil])return s;return nil;
}
+ (instancetype)acquireOriginalHelperSourceForMessagePeer:(YNXIDEHelperMessagePeer*)peer error:(NSError**)error {
 if(!peer||![peer assertCurrentMessage:error]){if(error&&!*error)*error=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_HELPER_MESSAGE_REQUIRED"}];return nil;}
 // Do NOT bootstrap Source from the target user's not-yet-installed registry.
 // This is the original independent helper/admin Source acquisition, with its
 // unchanged signed Root/enrollment/purpose/verifier/current requirements.
 YNXAuthIdentitySourceAuthority*s=[self acquireOriginalSource:error];if(!s)return nil;
 s->_helperPeer=peer;
 if(![peer assertCurrentMessage:error]||![s heldCurrent:error]){
  [s fail:@"AUTH_IDENTITY_HELPER_SOURCE_MESSAGE_CHANGED" error:error];
  [s retire];if(![s close:nil])return s;return nil;
 }
 return s;
}
+ (instancetype)acquireOriginalIDEConsumerSource:(NSError **)error {
 return [self acquireIDEConsumerWithContractRelay:NO error:error];
}
+ (instancetype)acquireOriginalIDEContractRelaySource:(NSError **)error {
 return [self acquireIDEConsumerWithContractRelay:YES error:error];
}
+ (instancetype)acquireIDEConsumerWithContractRelay:(BOOL)relay error:(NSError **)error {
 YNXAuthIdentitySourceAuthority *s=[self new];s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 s->_custody=relay?[YNXAuthIdentityCurrentOwner acquireOriginalIDEContractRelayProfile:error]:[YNXAuthIdentityCurrentOwner acquireOriginalIDEConsumerProfile:error];if(!s->_custody)return nil;
 s->_profileOriginal=[s->_custody copyOriginalProfile:error];s->_headOriginal=[s->_custody copyOriginalHead:error];
 if(s->_profileOriginal&&s->_headOriginal){
  NSDictionary *body=SourceOriginalBodyHint(s->_profileOriginal);id source=body[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(relay&&s->_policy&&s->_policy->purpose!="ide-contract-relay-v1")s->_policy=nullptr;
  if(!s->_policy)[s fail:@"AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_SUPPLIED" error:error];
  else{
   NSString *root=[[s->_custody copyOriginalResourceDirectory:error] stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:error];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:error];
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
  NSDictionary *body=SourceOriginalBodyHint(s->_profileOriginal);id source=body[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(!s->_policy)[s fail:@"AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_SUPPLIED" error:error];
  else{
   NSString *root=[[s->_custody copyOriginalResourceDirectory:error] stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:error];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:error];
   if(s->_enrollmentOriginal&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:error]&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:error]&&[s assertAuthenticatedNativePurpose:error])return s;
  }
 }
 [s retire];if(![s close:nil])return s;return nil;
}
// Separate fixed factory, SAME original authenticated registry mechanics;
// no old four-operation SourceBinding, administration or Host purpose loan.
+ (instancetype)acquireOriginalIDEIdentityWalletSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority *s=[self new];s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalIDERegistryProfile:error];if(!s->_custody)return nil;
 s->_profileOriginal=[s->_custody copyOriginalProfile:error];s->_headOriginal=[s->_custody copyOriginalHead:error];
 if(s->_profileOriginal&&s->_headOriginal){
  NSDictionary *body=SourceOriginalBodyHint(s->_profileOriginal);id source=body[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(!s->_policy||(s->_policy->purpose!="AUTH-IDENTITY-RECEIVE"&&s->_policy->purpose!="AUTH-IDENTITY-RECOVER"&&s->_policy->purpose!="AUTH-PROTECTED-KEY-CALL"))[s fail:@"AUTH_IDENTITY_WALLET_IDENTITY_PURPOSE_REQUIRED" error:error];
  else{
   NSString *root=[[s->_custody copyOriginalResourceDirectory:error] stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:error];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:error];
   if(s->_enrollmentOriginal&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:error]&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:error]&&[s assertAuthenticatedNativePurpose:error])return s;
  }
 }
 [s retire];if(![s close:nil])return s;return nil;
}
- (BOOL)heldCurrent:(NSError **)error {
 if(_helperClient&&![_helperClient assertTransportCurrent:error])return [self fail:@"AUTH_IDENTITY_HELPER_CLIENT_NOT_CURRENT" error:error];
 if(_helperPeer&&![_helperPeer assertCurrentMessage:error])return [self fail:@"AUTH_IDENTITY_HELPER_SOURCE_MESSAGE_CHANGED" error:error];
 if(_invalid||_retired||!_policy||![_custody assertOriginalCurrent:error])return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CURRENT_UNAVAILABLE" error:error];
 for(const auto &file:_files){struct stat held{},named{};if(file.selected||fstat(file.fd,&held)||lstat(file.path.fileSystemRepresentation,&named)||!SourceSame(file.identity,held)||!SourceSame(file.identity,named))return [self fail:@"AUTH_IDENTITY_NATIVE_RELEASE_CHANGED" error:error];}
 if(_helperPeer&&![_helperPeer assertCurrentMessage:error])return [self fail:@"AUTH_IDENTITY_HELPER_SOURCE_MESSAGE_CHANGED" error:error];return YES;
}
- (NSData *)runOriginalVerifierData:(NSData *)raw error:(NSError **)error {
 if(!_entered||!_policy||!raw.length||raw.length>ynx_auth_private::OriginalAuthVerifierInputMax){[self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_INPUT_INVALID" error:error];return nil;}
   NSPipe *in=[NSPipe pipe],*out=[NSPipe pipe],*errors=[NSPipe pipe];
   for(NSFileHandle *handle in @[in.fileHandleForReading,in.fileHandleForWriting,out.fileHandleForReading,out.fileHandleForWriting,errors.fileHandleForReading,errors.fileHandleForWriting]){[_pipeHandles addObject:handle];[_pipeStates addObject:@0];}
   _task=[NSTask new];_task.executableURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:_policy->nodeImagePath.c_str()]];_task.arguments=@[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]];_task.environment=@{};_task.standardInput=in;_task.standardOutput=out;_task.standardError=errors;
   NSError *launch=nil;if(![_task launchAndReturnError:&launch]){[self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_EXEC_UNAVAILABLE" error:error];return nil;}
   NSTask *owned=_task;dispatch_after(dispatch_time(DISPATCH_TIME_NOW,7*NSEC_PER_SEC),dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{if(owned.running)[owned terminate];});
   NSUInteger writer=[_pipeHandles indexOfObjectIdenticalTo:in.fileHandleForWriting];BOOL writerDone=NO;
   std::vector<unsigned char> verifiedBytes;
   try{
    verifiedBytes=ynx_auth_private::boundedVerifierIO(in.fileHandleForWriting.fileDescriptor,out.fileHandleForReading.fileDescriptor,errors.fileHandleForReading.fileDescriptor,
     (const unsigned char *)raw.bytes,raw.length,[&](){_pipeStates[writer]=@2;NSError *writerError=nil;writerDone=[in.fileHandleForWriting closeAndReturnError:&writerError];_pipeStates[writer]=writerDone?@1:@2;return (bool)writerDone;},[&](){return (bool)_task.running;},7000,ynx_auth_private::OriginalAuthVerifierInputMax,ynx_auth_private::OriginalAuthVerifierOutputMax);
   }catch(const std::exception &failure){{[self fail:[NSString stringWithUTF8String:failure.what()] error:error];return nil;}}
   NSData *result=[NSData dataWithBytes:verifiedBytes.data() length:verifiedBytes.size()];
   if(!writerDone||![self closeHeldPipes]){[self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_CLOSE_UNKNOWN" error:error];return nil;}
   if(_task.terminationStatus!=0||result.length>ynx_auth_private::OriginalAuthVerifierOutputMax){[self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_VERIFICATION_FAILED" error:error];return nil;}
 return result;
}
#include "original-ide-auth-proof-source.inc.mm"
#include "original-ide-contract-relay-source.inc.mm"
#include "original-ide-contract-relay-runtime.inc.mm"
- (BOOL)assertCurrent:(NSError **)error {return [self assertAuthenticatedNativePurpose:error];}
- (BOOL)assertAuthenticatedNativePurpose:(NSError **)error {
 @synchronized(self){
  if(_entered||_relayLocalEntered||_relayRuntimeEntered)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_REENTRANT" error:error];
  if(![self heldCurrent:error])return NO;_entered=YES;
  @try{
   uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(before<_timeFloor)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CLOCK_ROLLBACK" error:error];
   NSDictionary *contract=@{@"purpose":[NSString stringWithUTF8String:_policy->purpose.c_str()],@"enrollmentFrame":[NSString stringWithUTF8String:_policy->enrollmentFrame.c_str()],@"profileFrame":[NSString stringWithUTF8String:_policy->profileFrame.c_str()],@"currentFrame":[NSString stringWithUTF8String:_policy->currentFrame.c_str()]};
   NSDictionary *policy=@{@"rootDigest":[NSString stringWithUTF8String:_policy->rootDigest.c_str()],@"enrollmentDigest":[NSString stringWithUTF8String:_policy->enrollmentDigest.c_str()],@"endpoint":[NSString stringWithUTF8String:_policy->endpoint.c_str()],@"spki":[NSString stringWithUTF8String:_policy->spki.c_str()],@"signatureContract":contract};
   NSDictionary *input=@{@"rootRaw":[[NSString alloc]initWithData:_rootOriginal encoding:NSUTF8StringEncoding],@"enrollmentRaw":[[NSString alloc]initWithData:_enrollmentOriginal encoding:NSUTF8StringEncoding],@"profileRaw":[[NSString alloc]initWithData:_profileOriginal encoding:NSUTF8StringEncoding],@"headRaw":[[NSString alloc]initWithData:_headOriginal encoding:NSUTF8StringEncoding],@"policy":policy,@"previous":@{@"sequence":@(_sequence),@"floor":@(_floor),@"head":_headDigest,@"timeFloor":@(_timeFloor)}};
   NSDictionary *rootBody=SourceProofDictionary(_rootOriginal,16384);BOOL sourceV2=[rootBody[@"version"]isEqual:@2];
   if(sourceV2){
    // SAME Source owner, runner, compiled release and whole held SDK closure.
    // No environment/caller endpoint, provider, alternate verifier or v1 PQ
    // fallback is permitted for this pinned v2 root.
    if(![self pinOriginalIDEProofRuntime:error])return NO;
    NSString *directory=[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent];
    for(NSString *name in @[@"original-auth-source-v2-dispatch.mjs",@"original-auth-identity-source-v2-verifier.mjs"]){
     BOOL held=NO;NSString *path=[directory stringByAppendingPathComponent:name];
     for(const auto&file:_files)if(!file.selected&&[file.path isEqual:path]){held=YES;break;}
     if(!held)return [self fail:@"AUTH_SOURCE_V2_RUNTIME_CLOSURE_REQUIRED" error:error];
    }
    NSString *origin=[NSString stringWithUTF8String:_policy->nativeNodeOrigin.c_str()];NSURLComponents *nodeURL=[NSURLComponents componentsWithString:origin];uint64_t nativeChain=0;
    if(!origin.length||![nodeURL.scheme isEqual:@"https"]||!nodeURL.host.length||nodeURL.user||nodeURL.password||nodeURL.query||nodeURL.fragment||nodeURL.path.length||!SourceProofHex([NSString stringWithUTF8String:_policy->nativeNodeSPKI.c_str()])||!SourceProofU64([NSString stringWithUTF8String:_policy->nativeChainId.c_str()],nativeChain,true))return [self fail:@"AUTH_SOURCE_V2_NATIVE_NODE_BINDING_REQUIRED" error:error];
    NSMutableDictionary *v2=[input mutableCopy];v2[@"operation"]=@"auth-source-v2-native-node/v1";
    v2[@"node"]=@{@"origin":origin,@"spki":[NSString stringWithUTF8String:_policy->nativeNodeSPKI.c_str()],@"nativeChainId":[NSString stringWithUTF8String:_policy->nativeChainId.c_str()]};
    v2[@"previous"]=@{@"sequence":@(_sequence),@"floor":@(_floor),@"head":_headDigest,@"timeFloor":@(_timeFloor),@"executionHeight":_observationHeight?:@"0"};input=v2;
   }
   NSData *raw=[NSJSONSerialization dataWithJSONObject:input options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!raw||raw.length>ynx_auth_private::OriginalAuthVerifierInputMax)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CAPACITY" error:error];
   NSData *result=[self runOriginalVerifierData:raw error:error];if(!result)return NO;
   id parsed=[NSJSONSerialization JSONObjectWithData:result options:0 error:nil];NSDictionary *projection=[parsed isKindOfClass:NSDictionary.class]?parsed[@"projection"]:nil;
   if(![projection isKindOfClass:NSDictionary.class]||![projection[@"selection"] isKindOfClass:NSDictionary.class]||![projection[@"head"] isKindOfClass:NSString.class])return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_PROJECTION_INVALID" error:error];
   if(sourceV2){uint64_t height=0;
    if(!SourceProofBoolean(projection[@"dataOnly"],true)||!SourceProofBoolean(projection[@"nativeAdmission"],false)||![projection[@"status"]isEqual:@"active"]||!SourceProofU64(projection[@"executionHeight"],height))return [self fail:@"AUTH_SOURCE_V2_NATIVE_PROJECTION_INVALID" error:error];
   }
   uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),sequence=[projection[@"sequence"] unsignedLongLongValue],floor=[projection[@"floor"] unsignedLongLongValue],expires=[projection[@"expiresAtMs"] unsignedLongLongValue];
   if(after<before||after<_timeFloor||sequence<_sequence||floor<_floor||floor>sequence||after>=expires||(sequence==_sequence&&_sequence&&![projection[@"head"] isEqual:_headDigest])||![self heldCurrent:error])return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_POST_FENCE_FAILED" error:error];
   NSString *currentRaw=[parsed isKindOfClass:NSDictionary.class]?parsed[@"currentRaw"]:nil;
   NSData *currentBytes=[currentRaw isKindOfClass:NSString.class]?[currentRaw dataUsingEncoding:NSUTF8StringEncoding]:nil;
   id currentBody=SourceOriginalBodyHint(currentBytes);
   id nonce=[currentBody isKindOfClass:NSDictionary.class]?currentBody[@"nonce"]:nil;
   if(!currentBytes||currentBytes.length>(sourceV2?393216:32768)||![nonce isKindOfClass:NSString.class]||[nonce length]!=43)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CURRENT_ORIGINAL_INVALID" error:error];
   _currentOriginal=[currentBytes copy];_currentNonce=[nonce copy];
   _selection=[projection[@"selection"] copy];_sequence=sequence;_floor=floor;_headDigest=[projection[@"head"] copy];_timeFloor=after;_cachedCurrentExpiresMS=expires;if(sourceV2)_observationHeight=[projection[@"executionHeight"]copy];return YES;
  }@catch(NSException *){return [self fail:@"AUTH_IDENTITY_NATIVE_VERIFIER_UNKNOWN" error:error];}
  @finally{_entered=NO;}
 }
}
- (NSDictionary *)copyOriginalSelection:(NSError **)error {if(![self assertAuthenticatedNativePurpose:error])return nil;NSDictionary *original=[_selection copy];if(![self heldCurrent:error])return nil;return original;}
- (NSDictionary *)copyOriginalProvisioningPublicOriginals:(NSError **)error {
 @synchronized(self){
  // Original owning source only: no caller Root, raw bundle, clock, endpoint,
  // admission boolean or signer callback. The returned copies remain DATA.
  if([self class]!=YNXAuthIdentitySourceAuthority.class){[self fail:@"AUTH_IDENTITY_PROVISIONING_ORIGINAL_OWNER_REQUIRED" error:error];return nil;}
  if(![self assertAuthenticatedNativePurpose:error])return nil;
  if(!_policy){[self fail:@"AUTH_IDENTITY_PROVISIONING_RELEASE_NOT_HELD" error:error];return nil;}
  NSData *root=[_rootOriginal copy],*enrollment=[_enrollmentOriginal copy],*profile=[_profileOriginal copy],*current=[_currentOriginal copy];
  NSString *nonce=[_currentNonce copy];
  if(!root.length||!enrollment.length||!profile.length||!current.length||!nonce.length){[self fail:@"AUTH_IDENTITY_PROVISIONING_ORIGINAL_NOT_HELD" error:error];return nil;}
  NSDictionary *body=SourceOriginalBodyHint(current);
  if(![body isKindOfClass:NSDictionary.class]||![body[@"sourceId"] isEqual:[NSString stringWithUTF8String:_policy->sourceId.c_str()]]||
   ![body[@"nonce"] isEqual:nonce]||![body[@"head"] isEqual:_headDigest]||
   ![body[@"profileDigest"] isEqual:SourceSHA(profile)]||
   [body[@"sequence"] unsignedLongLongValue]!=_sequence||[body[@"floor"] unsignedLongLongValue]!=_floor){
   [self fail:@"AUTH_IDENTITY_PROVISIONING_CURRENT_ORIGINAL_MISMATCH" error:error];return nil;
  }
  auto originalPolicy=_policy;
  auto observe=[&](){return ynx_auth_private::ProvisioningPublicIdentity{
   {SourceSHA(_rootOriginal).UTF8String,SourceSHA(_enrollmentOriginal).UTF8String,SourceSHA(_profileOriginal).UTF8String},
   _policy->sourceId,_headDigest.UTF8String,_sequence,_floor};};
  auto wall=[](){return (uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);};
  auto mono=[](){return (uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();};
  ynx_auth_private::ProvisioningPublicFence fence;
  if(!fence.capture(observe(),[body[@"issuedAtMs"] unsignedLongLongValue],
   [body[@"expiresAtMs"] unsignedLongLongValue],wall(),mono())){
   [self fail:[NSString stringWithUTF8String:fence.firstCause()] error:error];return nil;
  }
  NSDictionary *copies=@{@"rootOriginal":root,@"enrollmentOriginal":enrollment,@"profileOriginal":profile,
   @"currentOriginal":current,@"currentNonce":nonce,@"sourceId":body[@"sourceId"],
   @"profileDigest":body[@"profileDigest"],@"sequence":body[@"sequence"],@"floor":body[@"floor"],
   @"head":body[@"head"],@"issuedAtMs":body[@"issuedAtMs"],@"expiresAtMs":body[@"expiresAtMs"],
   @"dataOnly":@YES,@"nativeAdmission":@NO};
  // A second real current may advance read-only sequence, not replace the
  // copied originals, renew their lifetime, or hide a changed reserved floor.
  if(![self assertAuthenticatedNativePurpose:error])return nil;
  if(_policy!=originalPolicy||!fence.complete(observe(),wall(),mono())){
   const char *cause=fence.firstCause();
   [self fail:cause?[NSString stringWithUTF8String:cause]:@"AUTH_IDENTITY_PROVISIONING_POLICY_CHANGED" error:error];return nil;
  }
  return copies;
 }
}
- (NSNumber *)copyOriginalCurrentSequence:(NSError **)error {@synchronized(self){if(![self assertAuthenticatedNativePurpose:error])return nil;NSNumber *sequence=@(_sequence);return [self heldCurrent:error]?sequence:nil;}}
- (NSDictionary *)originalIDEPublicReceiver:(BOOL)install error:(NSError **)error {
 @synchronized(self){
 @try{
  if(_invalid||_retired||_publicInstallation){[self fail:@"AUTH_IDENTITY_RECEIVER_ALREADY_SELECTED" error:error];return nil;}
  if(![self assertAuthenticatedNativePurpose:error])return nil;
  // Independent release purpose, not a login token/current GET/TLS receipt.
  if(!_policy||_policy->purpose!="AUTH-IDENTITY-RECEIVE"){[self fail:@"AUTH_IDENTITY_RECEIVER_PURPOSE_REQUIRED" error:error];return nil;}
  NSDictionary *association=_selection[@"association"],*request=_selection[@"expectedRequest"];
  if(![association[@"productId"] isEqual:@"developer"]||![request[@"productId"] isEqual:@"developer"]){[self fail:@"AUTH_IDENTITY_RECEIVER_PRODUCT_MISMATCH" error:error];return nil;}
  if(install&&geteuid()!=0){[self fail:@"AUTH_IDENTITY_RECEIVER_PRIVILEGE_REQUIRED" error:error];return nil;}
  if(install&&!_helperPeer){[self fail:@"AUTH_IDENTITY_RECEIVER_OS_MESSAGE_REQUIRED" error:error];return nil;}
  // No sudo/privilege escalation is performed here. A real privileged normal
  // owner must already exist. UID is kernel-derived, never a renderer option.
  NSString*messageTarget=_helperPeer?[_helperPeer copyOriginalUserRegistryBase:error]:nil;
  if(_helperPeer&&!messageTarget)return nil;
  const std::string target=_helperPeer?std::string(messageTarget.UTF8String):ynx_auth_ide_private::originalIDERegistryBase(getuid());
  if(!ynx_auth_private::SourcePublicInstallation::protectedRootAncestors(target)){[self fail:@"AUTH_IDENTITY_RECEIVER_REGISTRY_NOT_PROTECTED" error:error];return nil;}
  NSDictionary *snapshot=[self copyOriginalProvisioningPublicOriginals:error];if(!snapshot)return nil;
  NSData *baseline=[_headOriginal copy];
  NSArray<NSData *> *originals=@[snapshot[@"rootOriginal"],snapshot[@"enrollmentOriginal"],snapshot[@"profileOriginal"],baseline];
  ynx_auth_private::SourcePublicInstallation::Bundle bundle;
  for(NSUInteger i=0;i<4;i++){
   NSData *raw=originals[i];if(![raw isKindOfClass:NSData.class]||!raw.length||raw.length>ynx_auth_private::OriginalAuthPublicOriginalMax){[self fail:@"AUTH_IDENTITY_RECEIVER_ORIGINAL_CAPACITY" error:error];return nil;}
   const auto *begin=(const unsigned char *)raw.bytes;bundle[i].assign(begin,begin+raw.length);
  }
  // Install the original signed acquisition HEAD, not a fresh nonce-bound
  // current response. Cold readback must match immutable installed bytes;
  // latest/current still requires the original separate fresh-network check.
  const auto wall=[](){return (uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);};
  const auto mono=[](){return (uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();};
  const auto identity=[&](NSDictionary *v){return ynx_auth_private::ProvisioningPublicIdentity{
   {SourceSHA(snapshot[@"rootOriginal"]).UTF8String,SourceSHA(snapshot[@"enrollmentOriginal"]).UTF8String,SourceSHA(snapshot[@"profileOriginal"]).UTF8String},
   [v[@"sourceId"] UTF8String],[v[@"head"] UTF8String],[v[@"sequence"] unsignedLongLongValue],[v[@"floor"] unsignedLongLongValue]};};
  ynx_auth_private::ProvisioningPublicFence fence;
  const uint64_t originalWall=wall(),originalMono=mono(),expires=[snapshot[@"expiresAtMs"] unsignedLongLongValue];
  if(!fence.capture(identity(snapshot),[snapshot[@"issuedAtMs"] unsignedLongLongValue],expires,originalWall,originalMono)){[self fail:@"AUTH_IDENTITY_RECEIVER_WINDOW_INVALID" error:error];return nil;}
  // Adopt before the first filesystem operation. Late failure must retain
  // this exact partial for close; no re-acquire/replace/automatic retry.
  _publicInstallation=std::make_unique<ynx_auth_private::SourcePublicInstallation>();
  auto &receiver=*_publicInstallation;
  if(![self heldCurrent:error])return nil;
  if(!receiver.captureParent(target,0)){[self fail:@"AUTH_IDENTITY_RECEIVER_INSTALL_UNKNOWN" error:error];return nil;}
  if(install){
   if(!receiver.stage(bundle)){[self fail:@"AUTH_IDENTITY_RECEIVER_INSTALL_UNKNOWN" error:error];return nil;}
   if(![self heldCurrent:error])return nil;
   if(!receiver.publish()){[self fail:@"AUTH_IDENTITY_RECEIVER_INSTALL_UNKNOWN" error:error];return nil;}
  }else if(!receiver.captureExisting(bundle)){[self fail:@"AUTH_IDENTITY_RECEIVER_INSTALL_UNKNOWN" error:error];return nil;}
  std::array<ynx_auth_private::SourcePublicInstallation::Receipt,4> receipts;
  if(!receiver.readBack(receipts)){[self fail:@"AUTH_IDENTITY_RECEIVER_READBACK_UNKNOWN" error:error];return nil;}
  NSDictionary *late=[self copyOriginalProvisioningPublicOriginals:error];if(!late)return nil;
  if(![_headOriginal isEqual:baseline]||![late[@"rootOriginal"] isEqual:snapshot[@"rootOriginal"]]||![late[@"enrollmentOriginal"] isEqual:snapshot[@"enrollmentOriginal"]]||![late[@"profileOriginal"] isEqual:snapshot[@"profileOriginal"]]||!fence.complete(identity(late),wall(),mono())){[self fail:@"AUTH_IDENTITY_RECEIVER_POST_CURRENT_REFUSED" error:error];return nil;}
  // Re-open/read bytes after current observation as well, never return a
  // receipt for a file replaced while the real verifier was running.
  if(!receiver.readBack(receipts)){[self fail:@"AUTH_IDENTITY_RECEIVER_LATE_READBACK_UNKNOWN" error:error];return nil;}
  NSMutableArray *files=[NSMutableArray array];
  for(const auto &r:receipts)[files addObject:@{@"name":[NSString stringWithUTF8String:r.name.c_str()],@"sha256":[NSString stringWithUTF8String:r.sha256.c_str()],@"device":@((uint64_t)r.identity.st_dev),@"inode":@((uint64_t)r.identity.st_ino),@"uid":@((uint64_t)r.identity.st_uid),@"gid":@((uint64_t)r.identity.st_gid),@"mode":@((uint64_t)r.identity.st_mode),@"nlink":@((uint64_t)r.identity.st_nlink),@"bytes":@((uint64_t)r.identity.st_size)}];
  if(![self heldCurrent:error])return nil;
  // Receipt target is the kernel-bound registry, NOT the root helper's UID0.
  // Original normal-user readback retains its existing kernelUID field.
  NSNumber*kernelUID=_helperPeer?[_helperPeer copyOriginalUserIdentifier:error]:@((uint64_t)getuid());if(!kernelUID)return nil;
  NSDictionary *result=@{@"files":[files copy],@"kernelUID":kernelUID,@"installed":@(install),@"coldReadback":@(!install),@"dataOnly":@YES,@"nativeAdmission":@NO,@"identityRestored":@NO,@"keyBorrowed":@NO};
  const uint64_t terminalWall=wall(),terminalMono=mono();
  if(terminalWall<originalWall||terminalWall>=expires||terminalMono<originalMono||terminalMono>=originalMono+(expires-originalWall)){[self fail:@"AUTH_IDENTITY_RECEIVER_TERMINAL_WINDOW_EXPIRED" error:error];return nil;}
  if(install&&!receiver.retainPublishedData()){[self fail:@"AUTH_IDENTITY_RECEIVER_RETAIN_UNKNOWN" error:error];return nil;}
  return result;
 }@catch(NSException *){[self fail:@"AUTH_IDENTITY_RECEIVER_EXCEPTION_UNKNOWN" error:error];return nil;}
 }
}
- (NSDictionary *)installOriginalIDEIdentityPublicOriginals:(NSError **)error {
 @synchronized(self){
  if(!_helperClient)return [self originalIDEPublicReceiver:YES error:error];
  if(geteuid()==0||!_ideProofVerified||!_receiveRequestOriginal||!_receiveProofOriginal){[self fail:@"AUTH_IDENTITY_RECEIVE_ORIGINAL_PROOF_REQUIRED" error:error];return nil;}
  if(![self assertOriginalIDEIdentityRequestCurrent:_receiveRequestOriginal invocation:[NSData data] error:error])return nil;
  NSError*actualError=nil;
  _remoteReceiveActual=[_helperClient receiveOriginalRequest:_receiveRequestOriginal proof:_receiveProofOriginal error:&actualError]; // adopt actual partial BEFORE error/current
  if(actualError||!_remoteReceiveActual){_invalid=YES;if(!_firstCause)_firstCause=actualError?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_HELPER_RECEIVE_UNKNOWN"}];if(error)*error=_firstCause;return _remoteReceiveActual;}
  // Root transport success is not installed-original success. Independently
  // reopen the expected USER registry through the original cold reader and
  // match every real file hash/inode/metadata against actual remote receipts.
  NSDictionary*local=[self copyOriginalIDEInstalledPublicOriginals:&actualError];
  if(actualError||!local||![_remoteReceiveActual[@"files"]isEqual:local[@"files"]]||![_remoteReceiveActual[@"kernelUID"]isEqual:local[@"kernelUID"]]||![_remoteReceiveActual[@"dataOnly"]isEqual:@YES]||![_remoteReceiveActual[@"nativeAdmission"]isEqual:@NO]||![_remoteReceiveActual[@"identityRestored"]isEqual:@NO]||![_remoteReceiveActual[@"keyBorrowed"]isEqual:@NO]||![_remoteReceiveActual[@"installed"]isEqual:@YES]){
   [self fail:actualError.localizedDescription?:@"AUTH_IDENTITY_HELPER_INDEPENDENT_READBACK_MISMATCH" error:error];return _remoteReceiveActual;
  }
  if(![self assertOriginalIDEIdentityRequestCurrent:_receiveRequestOriginal invocation:[NSData data] error:error])return _remoteReceiveActual;
  return _remoteReceiveActual;
 }
}
- (NSDictionary *)copyOriginalIDEInstalledPublicOriginals:(NSError **)error {return [self originalIDEPublicReceiver:NO error:error];}
- (NSDictionary *)verifyOriginalFirstEnterWitness:(NSData *)witness binding:(NSDictionary *)binding requestId:(NSString *)requestId nonce:(NSString *)nonce error:(NSError **)error {
 @synchronized(self){
  if(_entered){[self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_REENTRANT" error:error];return nil;}
  if(![self assertAuthenticatedNativePurpose:error])return nil;
  if(_policy->persistentVersion!="YNX-AUTH-PERSISTENT-ENTERED/v1"||_policy->persistentContractDigest.empty()||_policy->persistentFrame.empty()||_policy->persistentNamespace.empty()||_policy->firstEnterVerifierDigest.empty()||_policy->persistentModuleDigest.empty()){
   [self fail:@"AUTH_IDENTITY_PERSISTENT_VERSION_NOT_REGISTERED" error:error];return nil;
  }
  if(![witness isKindOfClass:NSData.class]||!witness.length||witness.length>32768||![binding isKindOfClass:NSDictionary.class]||![requestId isKindOfClass:NSString.class]||![nonce isKindOfClass:NSString.class]){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_INPUT_INVALID" error:error];return nil;}
  NSString *directory=[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()] stringByDeletingLastPathComponent];
  NSString *companion=[directory stringByAppendingPathComponent:@"original-source-first-enter-verifier.mjs"];
  if(!_firstEnterPinned){
   if(![self holdPublic:companion maximum:131072 image:YES digest:_policy->firstEnterVerifierDigest error:error]||![self holdPublic:[directory stringByAppendingPathComponent:@"original-source-persistent-entered-v1.mjs"] maximum:131072 image:YES digest:_policy->persistentModuleDigest error:error])return nil;
   _firstEnterPinned=YES;
  }
  if(![self heldCurrent:error])return nil;
  _entered=YES;
  @try{
   uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
   if(before<_timeFloor){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_CLOCK_ROLLBACK" error:error];return nil;}
   NSDictionary *contract=@{@"purpose":[NSString stringWithUTF8String:_policy->purpose.c_str()],@"enrollmentFrame":[NSString stringWithUTF8String:_policy->enrollmentFrame.c_str()],@"profileFrame":[NSString stringWithUTF8String:_policy->profileFrame.c_str()],@"currentFrame":[NSString stringWithUTF8String:_policy->currentFrame.c_str()]};
   NSDictionary *policy=@{@"rootDigest":[NSString stringWithUTF8String:_policy->rootDigest.c_str()],@"enrollmentDigest":[NSString stringWithUTF8String:_policy->enrollmentDigest.c_str()],@"endpoint":[NSString stringWithUTF8String:_policy->endpoint.c_str()],@"spki":[NSString stringWithUTF8String:_policy->spki.c_str()],@"signatureContract":contract};
   NSDictionary *persistent=@{@"version":[NSString stringWithUTF8String:_policy->persistentVersion.c_str()],@"contractDigest":[NSString stringWithUTF8String:_policy->persistentContractDigest.c_str()],@"frame":[NSString stringWithUTF8String:_policy->persistentFrame.c_str()],@"namespace":[NSString stringWithUTF8String:_policy->persistentNamespace.c_str()]};
   NSString *witnessRaw=[[NSString alloc]initWithData:witness encoding:NSUTF8StringEncoding];
   if(!witnessRaw){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_ENCODING_INVALID" error:error];return nil;}
   NSDictionary *source=@{@"rootRaw":[[NSString alloc]initWithData:_rootOriginal encoding:NSUTF8StringEncoding],@"enrollmentRaw":[[NSString alloc]initWithData:_enrollmentOriginal encoding:NSUTF8StringEncoding],@"profileRaw":[[NSString alloc]initWithData:_profileOriginal encoding:NSUTF8StringEncoding],@"sourcePolicy":policy,@"persistentPolicy":persistent};
   NSDictionary *input=@{@"source":source,@"witnessRaw":witnessRaw,@"currentRaw":[[NSString alloc]initWithData:_currentOriginal encoding:NSUTF8StringEncoding],@"currentNonce":_currentNonce,@"binding":[binding copy],@"witnessNonce":[nonce copy],@"requestId":[requestId copy]};
   NSData *raw=[NSJSONSerialization dataWithJSONObject:input options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
   if(!raw||raw.length>ynx_auth_private::OriginalAuthVerifierInputMax){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_CAPACITY" error:error];return nil;}
   NSPipe *in=[NSPipe pipe],*out=[NSPipe pipe],*errors=[NSPipe pipe];
   for(NSFileHandle *handle in @[in.fileHandleForReading,in.fileHandleForWriting,out.fileHandleForReading,out.fileHandleForWriting,errors.fileHandleForReading,errors.fileHandleForWriting]){[_pipeHandles addObject:handle];[_pipeStates addObject:@0];}
   _task=[NSTask new];_task.executableURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:_policy->nodeImagePath.c_str()]];_task.arguments=@[companion];_task.environment=@{};_task.standardInput=in;_task.standardOutput=out;_task.standardError=errors;
   NSError *launch=nil;if(![_task launchAndReturnError:&launch]){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_VERIFIER_EXEC_UNAVAILABLE" error:error];return nil;}
   NSTask *owned=_task;dispatch_after(dispatch_time(DISPATCH_TIME_NOW,7*NSEC_PER_SEC),dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{if(owned.running)[owned terminate];});
   NSUInteger writer=[_pipeHandles indexOfObjectIdenticalTo:in.fileHandleForWriting];BOOL writerDone=NO;std::vector<unsigned char> verified;
   try{verified=ynx_auth_private::boundedVerifierIO(in.fileHandleForWriting.fileDescriptor,out.fileHandleForReading.fileDescriptor,errors.fileHandleForReading.fileDescriptor,(const unsigned char *)raw.bytes,raw.length,[&](){_pipeStates[writer]=@2;NSError *e=nil;writerDone=[in.fileHandleForWriting closeAndReturnError:&e];_pipeStates[writer]=writerDone?@1:@2;return (bool)writerDone;},[&](){return (bool)_task.running;},7000,ynx_auth_private::OriginalAuthVerifierInputMax,ynx_auth_private::OriginalAuthVerifierOutputMax);}
   catch(const std::exception &failure){[self fail:[NSString stringWithUTF8String:failure.what()] error:error];return nil;}
   if(!writerDone||![self closeHeldPipes]||_task.terminationStatus!=0){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_VERIFICATION_UNKNOWN" error:error];return nil;}
   NSData *result=[NSData dataWithBytes:verified.data() length:verified.size()];id facts=[NSJSONSerialization JSONObjectWithData:result options:0 error:nil];
   if(![facts isKindOfClass:NSDictionary.class]||![facts[@"mode"] isEqual:@"entered"]||![facts[@"requestId"] isEqual:requestId]||![facts[@"firstFailure"] isEqual:@""]||![facts[@"dataOnly"] isEqual:@YES]||![facts[@"nativeAdmission"] isEqual:@NO]||![facts[@"effectRetryAuthorized"] isEqual:@NO]||[facts[@"floor"] unsignedLongLongValue]!=_floor||![facts[@"head"] isEqual:_headDigest]){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_FACTS_INVALID" error:error];return nil;}
   if(![self heldCurrent:error])return nil;
   uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
   if(after<before||after<_timeFloor||[facts[@"verifiedAtMs"] unsignedLongLongValue]<before||[facts[@"verifiedAtMs"] unsignedLongLongValue]>after||after>=[facts[@"expiresAtMs"] unsignedLongLongValue]){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_POST_CURRENT_FAILED" error:error];return nil;}
   _timeFloor=after;return [facts copy];
  }@catch(NSException *){[self fail:@"AUTH_IDENTITY_FIRST_ENTER_UNKNOWN" error:error];return nil;}
  @finally{_entered=NO;}
 }
}
- (void)retire {@synchronized(self){_retired=YES;[_helperClient retire];[_custody retire];}}
- (BOOL)join:(NSError **)error {@synchronized(self){if(!_retired||_entered||_task.running)return [self fail:@"AUTH_IDENTITY_SOURCE_JOIN_PENDING" error:error];if(_helperClient&&![_helperClient join:error])return NO;return [_custody join:error];}}
- (BOOL)close:(NSError **)error {
 @synchronized(self){[self retire];if(_closeSelected){if(error)*error=_cleanupCause;return _cleanupComplete;}
  if(![self join:error])return NO;_closeSelected=YES;BOOL filesClosed=YES;
  if(_helperClient){NSError*clientError=nil;if(![_helperClient close:&clientError]||clientError){_cleanupCause=clientError?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_HELPER_CLIENT_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;}_helperClient=nil;}
  if(_publicInstallation&&!_publicInstallation->close()){
   _cleanupComplete=NO;_cleanupCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_RECEIVER_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;
  }
  for(auto &file:_files){if(file.selected){if(!file.complete)filesClosed=NO;continue;}file.selected=true;file.complete=::close(file.fd)==0;if(!file.complete)filesClosed=NO;}if(![self closeHeldPipes])filesClosed=NO;
  NSError *cause=nil;BOOL custodyClosed=[_custody close:&cause];_cleanupComplete=filesClosed&&custodyClosed;if(!_cleanupComplete)_cleanupCause=cause?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_SOURCE_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return _cleanupComplete;}
}
@end
