#import "original-auth-identity-source-authority.h"
#include "original-product-device-v4-pending-journal.h"
#include "original-product-device-v4-provisioning-journal.h"
#include "original-product-device-v4-query-journal.h"
#include <algorithm>
#import <Security/Security.h>
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
#include "original-auth-runtime-image-source-internal.h"
#include "original-ide-project-app-observer.h"
#include "original-ide-project-app-observer-data.h"

static NSString *SourceSHA(NSData *raw){unsigned char bytes[CC_SHA256_DIGEST_LENGTH];CC_SHA256(raw.bytes,(CC_LONG)raw.length,bytes);NSMutableString *out=[NSMutableString string];for(auto c:bytes)[out appendFormat:@"%02x",c];return out;}
static bool SourceSame(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
struct SourceHeldPublic {int fd;struct stat identity;NSString *__strong path;bool selected=false,complete=false;};
#include "original-registered-finalization-scope-private.h"
#include "original-http-v5-scope-private.h"
#include "original-http-v5-registered-private.h"
@implementation YNXAuthIdentitySourceAuthority {
 NSDictionary*_productDeviceV4QueryJournalObservedIdentity;
 NSDictionary*_productDeviceV4RegisteredFinalizationJournalObservedIdentity;
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
 BOOL _projectLocalEntered,_ideProjectConsumer,_ideControlConsumer,_controlLocalEntered;
 BOOL _ideAppObserver,_observerFilesPinned;
 SourceObserverWindow _observerWindow;
 NSData *_observerMetadata;
 id _controlKeyBorrowToken;BOOL _controlKeyBorrowSelected;
 BOOL _relayRuntimePinned,_relayRuntimeEntered;
 NSData *_relayRuntimeManifestOriginal;
 BOOL _proofClosurePinned,_ideProofSelected,_ideProofVerified;
 std::shared_ptr<ynx_auth_private::OriginalDeviceAssociationStore> _httpV5Store;
 ynx_auth_private::DeviceAssociationIdentity _httpV5SameItem;
 uint64_t _httpV5Deadline,_httpV5MonoAnchor,_httpV5WallAnchor;
 unsigned _httpV5Loans;
 unsigned _runtimeImageLoans;
 NSError *_runtimeImageCloseCause;
 BOOL _productHTTPV5,_httpV5ItemSelected;
 NSError *_httpV5CloseCause;
 BOOL _retired,_invalid,_entered,_closeSelected,_cleanupComplete,_ideRegistry,_walletPQCatalog,_productDeviceV4,_productDeviceV4Pending,_productDeviceV4Provisioning,_productDeviceV4Query,_productDeviceV4RegisteredFinalization;
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
+ (instancetype)acquireOriginalWalletPQHostCatalogSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority *s=[self new];s->_walletPQCatalog=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 NSError *e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalWalletPQHostCatalogProfile:&e];
 // Return actual partial + error intact; caller owns every acquired child.
 if(e||!s->_custody){[s fail:e.localizedDescription?:@"PQ_HOST_ORIGINAL_SOURCE_NOT_SUPPLIED" error:error];return s;}
 s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];
 NSDictionary *body=SourceOriginalBodyHint(s->_profileOriginal);id source=body[@"sourceId"];
 if([source isKindOfClass:NSString.class])for(const auto&policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
 if(e||!s->_policy||s->_policy->purpose!="wallet-pq-host-catalog-source-v1"||s->_policy->walletPQApplicationId.empty()||s->_policy->walletPQProtocolImagePath.empty()||s->_policy->walletPQProtocolImageDigest.empty()||s->_policy->walletPQProtocolSourceRevision.empty()||s->_policy->walletPQProtocolContract!="YNX-PQ-HOST-CATALOG-WALLET-JOURNAL6/v1"){[s fail:@"PQ_HOST_DEDICATED_SOURCE_RELEASE_NOT_SUPPLIED" error:error];return s;}
 NSString *root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
 if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];
 if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
 if(e||!s->_enrollmentOriginal||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertAuthenticatedNativePurpose:&e]){[s fail:e.localizedDescription?:@"PQ_HOST_ORIGINAL_SOURCE_NOT_CURRENT" error:error];return s;}
 return s;
}
+ (instancetype)acquireOriginalProductSessionDeviceV4Source:(NSError **)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_productDeviceV4=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 try{@try{
 NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalProductSessionDeviceV4Profile:&e];
 // Publish the same actual partial on every late refusal; never promote raw
 // public-file custody or retry via ordinary administration/catalog/IDE.
 if(e||!s->_custody){[s fail:e.localizedDescription?:@"PRODUCT_DEVICE_V4_ORIGINAL_PROFILE_NOT_SUPPLIED" error:error];return s;}
 s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];
 NSDictionary*body=SourceOriginalBodyHint(s->_profileOriginal);id source=body[@"sourceId"];
 if([source isKindOfClass:NSString.class])for(const auto&policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){if(s->_policy){[s fail:@"PRODUCT_DEVICE_V4_DUPLICATE_SOURCE_RELEASE" error:error];return s;}s->_policy=&policy;}
 if(e||!s->_policy||s->_policy->purpose!="product-session-device-source-v4"||s->_policy->productDeviceV4ApplicationId.empty()||s->_policy->productDeviceV4ProductId.empty()){[s fail:@"PRODUCT_DEVICE_V4_INDEPENDENT_SOURCE_RELEASE_NOT_SUPPLIED" error:error];return s;}
 NSString*root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
 if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];
 if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
 if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]){[s fail:e.localizedDescription?:@"PRODUCT_DEVICE_V4_ORIGINAL_V2_ROOT_REQUIRED" error:error];return s;}
 if(![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertOriginalProductSessionDeviceV4SourceCurrent:&e]){[s fail:e.localizedDescription?:@"PRODUCT_DEVICE_V4_SOURCE_NOT_CURRENT" error:error];return s;}
 return s;
 }@catch(id){[s fail:@"PRODUCT_DEVICE_V4_SOURCE_ACQUIRE_EXCEPTION" error:error];return s;}}
 catch(...){[s fail:@"PRODUCT_DEVICE_V4_SOURCE_ACQUIRE_CPP_EXCEPTION" error:error];return s;}
}
+ (instancetype)acquireOriginalProductSessionDeviceV4PendingSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_productDeviceV4Pending=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 try{@try{NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalProductSessionDeviceV4PendingProfile:&e];if(e||!s->_custody){[s fail:e.localizedDescription?:@"PRODUCT_PENDING_V4_PROFILE_NOT_SUPPLIED" error:error];return s;}s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&p:ynx_auth_private::originalNativeSourceReleases())if(p.sourceId==[source UTF8String]){if(s->_policy){[s fail:@"PRODUCT_PENDING_V4_DUPLICATE_RELEASE" error:error];return s;}s->_policy=&p;}
  if(e||!s->_policy||s->_policy->purpose!="product-session-device-pending-source-v4"||s->_policy->productDeviceV4ApplicationId.empty()||s->_policy->productDeviceV4ProductId.empty()){[s fail:@"PRODUCT_PENDING_V4_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;}
  NSString*root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertOriginalProductSessionDeviceV4PendingSourceCurrent:&e]){[s fail:e.localizedDescription?:@"PRODUCT_PENDING_V4_SOURCE_NOT_CURRENT" error:error];return s;}return s;
 }@catch(id){[s fail:@"PRODUCT_PENDING_V4_SOURCE_EXCEPTION" error:error];return s;}}catch(...){[s fail:@"PRODUCT_PENDING_V4_SOURCE_CPP" error:error];return s;}
}
- (BOOL)assertOriginalProductSessionDeviceV4PendingSourceCurrent:(NSError **)error {
 if([self class]!=YNXAuthIdentitySourceAuthority.class||!_productDeviceV4Pending||!_policy||_policy->purpose!="product-session-device-pending-source-v4"||![SourceProofDictionary(_rootOriginal,16384)[@"version"]isEqual:@2])return [self fail:@"PRODUCT_PENDING_V4_DEDICATED_SOURCE_REQUIRED" error:error];
 if(![self assertAuthenticatedNativePurpose:error])return NO;if(![_selection[@"expectedRequest"][@"operations"]isEqual:@[@"device.registration-pop",@"device.challenge-completion"]])return [self fail:@"PRODUCT_PENDING_V4_OPERATIONS_REQUIRED" error:error];if(!ynx_auth_private::originalPendingDeviceV4JournalCurrent(_selection))return [self fail:@"PRODUCT_PENDING_V4_JOURNAL_IDENTITY" error:error];return [self heldCurrent:error];
}
- (NSDictionary *)copyOriginalProductSessionDeviceV4PendingScope:(NSError **)error {
 @synchronized(self){if(![self assertOriginalProductSessionDeviceV4PendingSourceCurrent:error])return nil;NSDictionary*s=_selection[@"productSessionDeviceV4Pending"];if(![s isKindOfClass:NSDictionary.class]||s.count!=8||![s[@"version"]isEqual:@"4"]||![s[@"expected"]isKindOfClass:NSDictionary.class]||[s[@"expected"]count]!=16)return [self fail:@"PRODUCT_PENDING_V4_SCOPE_REQUIRED" error:error],nil;NSData*raw=[NSJSONSerialization dataWithJSONObject:s options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!raw.length||raw.length>65536)return [self fail:@"PRODUCT_PENDING_V4_SCOPE_CAPACITY" error:error],nil;NSDictionary*copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];if(!copy||![self assertOriginalProductSessionDeviceV4PendingSourceCurrent:error]||![_selection[@"productSessionDeviceV4Pending"]isEqual:copy])return [self fail:@"PRODUCT_PENDING_V4_SCOPE_CHANGED" error:error],nil;return copy;}
}
+ (instancetype)acquireOriginalProductSessionDeviceV4ProvisioningSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_productDeviceV4Provisioning=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 BOOL released=NO;for(const auto&p:ynx_auth_private::originalNativeSourceReleases())if(p.purpose=="product-session-device-provisioning-source-v4"&&!p.productDeviceV4ApplicationId.empty()&&!p.productDeviceV4ProductId.empty())released=YES;if(!released){[s fail:@"PRODUCT_PROVISIONING_V4_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;}
 try{@try{NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalProductSessionDeviceV4ProvisioningProfile:&e];if(e||!s->_custody){[s fail:e.localizedDescription?:@"PRODUCT_PROVISIONING_V4_PROFILE_NOT_SUPPLIED" error:error];return s;}s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&p:ynx_auth_private::originalNativeSourceReleases())if(p.sourceId==[source UTF8String]){if(s->_policy){[s fail:@"PRODUCT_PROVISIONING_V4_DUPLICATE_RELEASE" error:error];return s;}s->_policy=&p;}
  if(e||!s->_policy||s->_policy->purpose!="product-session-device-provisioning-source-v4"||s->_policy->productDeviceV4ApplicationId.empty()||s->_policy->productDeviceV4ProductId.empty()){[s fail:@"PRODUCT_PROVISIONING_V4_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;}
  NSString*root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:&e]){[s fail:e.localizedDescription?:@"PRODUCT_PROVISIONING_V4_SOURCE_NOT_CURRENT" error:error];return s;}return s;
 }@catch(id){[s fail:@"PRODUCT_PROVISIONING_V4_SOURCE_EXCEPTION" error:error];return s;}}catch(...){[s fail:@"PRODUCT_PROVISIONING_V4_SOURCE_CPP" error:error];return s;}
}
- (BOOL)assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:(NSError **)error {
 if([self class]!=YNXAuthIdentitySourceAuthority.class||!_productDeviceV4Provisioning||!_policy||_policy->purpose!="product-session-device-provisioning-source-v4"||![SourceProofDictionary(_rootOriginal,16384)[@"version"]isEqual:@2])return [self fail:@"PRODUCT_PROVISIONING_V4_DEDICATED_SOURCE_REQUIRED" error:error];
 if(![self assertAuthenticatedNativePurpose:error])return NO;if(![_selection[@"expectedRequest"][@"operations"]isEqual:@[@"device.creation-prepare",@"device.original-query"]])return [self fail:@"PRODUCT_PROVISIONING_V4_OPERATIONS_REQUIRED" error:error];if(!ynx_auth_private::originalProvisioningDeviceV4JournalCurrent(_selection))return [self fail:@"PRODUCT_PROVISIONING_V4_JOURNAL_IDENTITY" error:error];return [self heldCurrent:error];
}
- (NSDictionary *)copyOriginalProductSessionDeviceV4ProvisioningScope:(NSError **)error {
 @synchronized(self){if(![self assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:error])return nil;NSDictionary*s=_selection[@"productSessionDeviceV4Provisioning"];if(![s isKindOfClass:NSDictionary.class]||s.count!=3||![s[@"version"]isEqual:@"4"]||![s[@"intentOriginal"]isKindOfClass:NSString.class]||![s[@"nativeIntentDATA"]isKindOfClass:NSDictionary.class]||[s[@"nativeIntentDATA"]count]!=5)return [self fail:@"PRODUCT_PROVISIONING_V4_SCOPE_REQUIRED" error:error],nil;NSData*raw=[NSJSONSerialization dataWithJSONObject:s options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!raw.length||raw.length>65536)return [self fail:@"PRODUCT_PROVISIONING_V4_SCOPE_CAPACITY" error:error],nil;NSDictionary*copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];if(!copy||![self assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:error]||![_selection[@"productSessionDeviceV4Provisioning"]isEqual:copy])return [self fail:@"PRODUCT_PROVISIONING_V4_SCOPE_CHANGED" error:error],nil;return copy;}
}
- (NSString *)copyOriginalProductSessionDeviceV4ApprovalModulePath:(NSError **)error {
 @synchronized(self){
  if(![self assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:error])return nil;
  const auto&path=_policy->productDeviceV4ApprovalModulePath;const auto&digest=_policy->productDeviceV4ApprovalModuleDigest;const auto bytes=_policy->productDeviceV4ApprovalModuleBytes;
  if(path.empty()||path.front()!='/'||path.size()>4096||digest.size()!=64||!bytes||bytes>131072)return [self fail:@"PRODUCT_PROVISIONING_V4_MAIN_MODULE_RELEASE_REQUIRED" error:error],nil;
  NSString*p=[NSString stringWithUTF8String:path.c_str()];
  // Existing holdPublic pins no-symlink protected ancestry, FD identity/hash.
  // Reuse the held record, never reacquire substituted bytes on every call.
  NSData*raw=nil;for(auto&held:_files)if([held.path isEqual:p]){struct stat st{};if(fstat(held.fd,&st)||!SourceSame(st,held.identity))return [self fail:@"PRODUCT_PROVISIONING_V4_MAIN_MODULE_CHANGED" error:error],nil;if((uint64_t)st.st_size!=bytes)return [self fail:@"PRODUCT_PROVISIONING_V4_MAIN_MODULE_BYTES" error:error],nil;return [self heldCurrent:error]?[p copy]:nil;}
  raw=[self holdPublic:p maximum:131072 image:NO digest:digest error:error];if(!raw||raw.length!=bytes||![self assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:error])return [self fail:@"PRODUCT_PROVISIONING_V4_MAIN_MODULE_BINDING" error:error],nil;
  return [p copy];
 }
}
- (NSDictionary *)copyOriginalProductSessionDeviceV4ProvisioningJournal:(NSError **)error {
 @synchronized(self){if(![self assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:error])return nil;
  NSString*parent=_selection[@"originalHostTerminalDirectory"],*stable=_selection[@"productSessionDeviceV4Provisioning"][@"nativeIntentDATA"][@"stableDeviceIdentity"];NSData*b=[stable dataUsingEncoding:NSUTF8StringEncoding];
  if(!parent.length||!b.length||b.length>1024)return [self fail:@"PRODUCT_PROVISIONING_V4_JOURNAL_SCOPE" error:error],nil;
  NSString*leaf=[@"device-v4-provisioning-" stringByAppendingString:SourceSHA(b)];
  NSDictionary*context=@{@"parent":parent,@"leaf":leaf,@"identity":_selection[@"originalProvisioningJournal"]};
  if(![self assertOriginalProductSessionDeviceV4ProvisioningSourceCurrent:error])return nil;return context;
 }
}
- (BOOL)assertOriginalProductSessionDeviceV4SourceCurrent:(NSError **)error {
 if([self class]!=YNXAuthIdentitySourceAuthority.class||!_productDeviceV4||!_policy||_policy->purpose!="product-session-device-source-v4")return [self fail:@"PRODUCT_DEVICE_V4_ORIGINAL_SOURCE_REQUIRED" error:error];
 if(![SourceProofDictionary(_rootOriginal,16384)[@"version"]isEqual:@2])return [self fail:@"PRODUCT_DEVICE_V4_ORIGINAL_V2_ROOT_REQUIRED" error:error];
 if(![self assertAuthenticatedNativePurpose:error])return NO;
 // Unknown purposes in an older common verifier must not inherit its legacy
 // beginYNX/restore operations and become a device-key-use grant. The owning
 // verifier/issuer must explicitly support this closed device-only contract.
 NSArray*operations=_selection[@"expectedRequest"][@"operations"];
 if(![operations isKindOfClass:NSArray.class]||![operations isEqual:@[@"device.current",@"device.http-proof"]])return [self fail:@"PRODUCT_DEVICE_V4_DEDICATED_OPERATIONS_REQUIRED" error:error];
 return [self heldCurrent:error];
}
- (NSDictionary *)copyOriginalProductSessionDeviceV4Scope:(NSError **)error {
 @synchronized(self){
  if(![self assertOriginalProductSessionDeviceV4SourceCurrent:error])return nil;
  NSDictionary*scope=_selection[@"productSessionDeviceV4"];
  if(![scope isKindOfClass:NSDictionary.class]||scope.count!=5||![scope[@"version"]isEqual:@"4"]||![scope[@"expected"]isKindOfClass:NSDictionary.class]||[scope[@"expected"]count]!=17||![scope[@"context"]isKindOfClass:NSDictionary.class]||[scope[@"context"]count]!=12||![scope[@"registrationOriginal"]isKindOfClass:NSString.class]||![scope[@"sessionOriginal"]isKindOfClass:NSString.class])return [self fail:@"PRODUCT_DEVICE_V4_AUTHENTICATED_SCOPE_REQUIRED" error:error],nil;
  // Detach only PUBLIC verified JSON. No protected signer/slot, Source handle,
  // path or renderer-supplied override can enter this projection.
  NSData*raw=[NSJSONSerialization dataWithJSONObject:scope options:0 error:error];
  if(!raw||raw.length>65536)return [self fail:@"PRODUCT_DEVICE_V4_SCOPE_CAPACITY" error:error],nil;
  NSDictionary*copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:error];
  if(!copy)return [self fail:@"PRODUCT_DEVICE_V4_SCOPE_DECODE" error:error],nil;
  if(![self assertOriginalProductSessionDeviceV4SourceCurrent:error])return nil;
  if(![_selection[@"productSessionDeviceV4"]isEqual:copy])return [self fail:@"PRODUCT_DEVICE_V4_SCOPE_CHANGED" error:error],nil;
  return copy;
 }
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
 return [self acquireIDEConsumerWithPurpose:0 error:error];
}
+ (instancetype)acquireOriginalIDEContractRelaySource:(NSError **)error {
 return [self acquireIDEConsumerWithPurpose:1 error:error];
}
+ (instancetype)acquireOriginalIDEProjectAuthoritySource:(NSError **)error {
 return [self acquireIDEConsumerWithPurpose:2 error:error];
}
+ (instancetype)acquireIDEConsumerWithPurpose:(unsigned)purpose error:(NSError **)error {
 YNXAuthIdentitySourceAuthority *s=[self new];s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 s->_ideProjectConsumer=purpose==2||purpose==3;s->_ideAppObserver=purpose==3;
 s->_custody=purpose==3?[YNXAuthIdentityCurrentOwner acquireOriginalIDEProjectObserverProfile:error]:purpose==2?[YNXAuthIdentityCurrentOwner acquireOriginalIDEProjectAuthorityProfile:error]:purpose==1?[YNXAuthIdentityCurrentOwner acquireOriginalIDEContractRelayProfile:error]:[YNXAuthIdentityCurrentOwner acquireOriginalIDEConsumerProfile:error];if(!s->_custody)return nil;
 s->_profileOriginal=[s->_custody copyOriginalProfile:error];s->_headOriginal=[s->_custody copyOriginalHead:error];
 if(s->_profileOriginal&&s->_headOriginal){
  NSDictionary *body=SourceOriginalBodyHint(s->_profileOriginal);id source=body[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto &policy:ynx_auth_private::originalNativeSourceReleases())if(policy.sourceId==[source UTF8String]){s->_policy=&policy;break;}
  if(s->_policy&&((purpose==1&&s->_policy->purpose!="ide-contract-relay-v1")||((purpose==2||purpose==3)&&s->_policy->purpose!="ide-project-authority-v1")))s->_policy=nullptr;
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
#include "original-ide-project-authority-source.inc.mm"
#include "original-product-device-v4-query-source.inc.mm"
#include "original-product-device-v4-registered-finalization-source.inc.mm"
#include "original-http-v5-source.inc.mm"
#include "original-ide-project-control-source.inc.mm"
#include "original-ide-project-control-custody-source.inc.mm"
- (BOOL)assertCurrent:(NSError **)error {return [self assertAuthenticatedNativePurpose:error];}
- (BOOL)assertAuthenticatedNativePurpose:(NSError **)error {
 @synchronized(self){if(![self assertAuthenticatedNativePurposeCore:error])return NO;return !_ideAppObserver||[self assertOriginalAppObserver:error];}
}
- (BOOL)assertOriginalAppObserver:(NSError**)error {
 try{@try{
  using namespace ynx_auth_ide_private;
  if(!_ideAppObserver||!_policy||_policy->purpose!="ide-project-authority-v1"||![self heldCurrent:error])return NO;
  const uint64_t now=wallMS(),mono=monotonicMS();
  id metadata=_selection[@"ideProjectAppObserver"];
  if(![metadata isKindOfClass:NSDictionary.class])return [self fail:@"IDE_APP_OBSERVER_SIGNED_METADATA_REQUIRED" error:error];
  uint64_t nodePID=0;if(!SourceProofU64(metadata[@"node"][@"pid"],nodePID,true)||nodePID>INT_MAX)return [self fail:@"IDE_APP_OBSERVER_NODE_IDENTITY_REQUIRED" error:error];
  auto app=observeKernel(getpid()),node=observeKernel((pid_t)nodePID);
  NSString*resources=NSBundle.mainBundle.resourceURL.path;
  uint64_t expires=0;
  if(![NSBundle.mainBundle.executableURL.path isEqual:app.image]||![NSBundle.mainBundle.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"]||!SourceObserverBinding(_selection,app,node,now,_cachedCurrentExpiresMS,expires)||!originalObservedNodeEntry(node,resources))return [self fail:@"IDE_APP_OBSERVER_ACTUAL_BINDING_REQUIRED" error:error];
  NSData*raw=[NSJSONSerialization dataWithJSONObject:metadata options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  if(!raw||raw.length>16384)return [self fail:@"IDE_APP_OBSERVER_METADATA_CAPACITY" error:error];
  if(!_observerMetadata)_observerMetadata=[raw copy];
  if(![_observerMetadata isEqual:raw]||!_observerWindow.observe(now,mono,expires))return [self fail:@"IDE_APP_OBSERVER_FIXED_LIFETIME_EXPIRED" error:error];
  if(!_observerFilesPinned){
   for(NSArray*pair in @[@[@"runtime/node",@"nodeSHA256"],@[@"server.mjs",@"entrySHA256"],@[@"build-provenance.json",@"provenanceSHA256"]]){
    NSString*digest=metadata[pair[1]];
    if(![self holdPublic:[resources stringByAppendingPathComponent:pair[0]] maximum:134217728 image:NO digest:std::string(digest.UTF8String) error:error])return NO;
   }_observerFilesPinned=YES;
  }
  const uint64_t after=wallMS(),afterMono=monotonicMS();
  if(!sameKernel(app,observeKernel(getpid()))||!sameKernel(node,observeKernel((pid_t)nodePID))||!_observerWindow.current(after,afterMono)||![self heldCurrent:error])return [self fail:@"IDE_APP_OBSERVER_POST_CURRENT_REFUSED" error:error];
  if(!_observerWindow.current(wallMS(),monotonicMS()))return [self fail:@"IDE_APP_OBSERVER_POST_CUSTODY_EXPIRED" error:error];
  return YES;
 }@catch(id){return [self fail:@"IDE_APP_OBSERVER_CURRENT_UNKNOWN" error:error];}}catch(const std::exception&){return [self fail:@"IDE_APP_OBSERVER_KERNEL_UNKNOWN" error:error];}
}
- (NSDictionary*)copyOriginalAppObservedService:(NSError**)error {
 @synchronized(self){
  if(!_ideAppObserver||![self assertAuthenticatedNativePurpose:error])return nil;
  NSDictionary*data=[self copyOriginalIDECurrentServiceRegistration:_selection[@"ideProjectAppObserver"][@"projectId"] error:error];
  if(!data||![self assertAuthenticatedNativePurpose:error])return nil;
  NSDictionary*last=[self copyOriginalIDECurrentServiceRegistration:_selection[@"ideProjectAppObserver"][@"projectId"] error:error];
  if(!last||![last isEqual:data]||![self assertOriginalAppObserver:error])return [self fail:@"IDE_APP_OBSERVER_SERVICE_CHANGED" error:error],nil;
  uint64_t expiry=0;const uint64_t now=ynx_auth_ide_private::wallMS();
  if(!SourceProjectMS(data[@"expiresMS"],expiry)||now>=expiry||!_observerWindow.current(now,ynx_auth_ide_private::monotonicMS()))return [self fail:@"IDE_APP_OBSERVER_DATA_RETURN_EXPIRED" error:error],nil;
  NSMutableDictionary*bounded=[data mutableCopy];bounded[@"expiresMS"]=@(std::min(expiry,_observerWindow.expires));return [bounded copy];
 }
}
- (BOOL)assertAuthenticatedNativePurposeCore:(NSError **)error {
 @synchronized(self){
  if(_entered||_relayLocalEntered||_relayRuntimeEntered||_projectLocalEntered||_controlLocalEntered)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_REENTRANT" error:error];
  if(![self heldCurrent:error])return NO;_entered=YES;
  @try{
   uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(before<_timeFloor)return [self fail:@"AUTH_IDENTITY_NATIVE_SOURCE_CLOCK_ROLLBACK" error:error];
   NSDictionary *contract=@{@"purpose":[NSString stringWithUTF8String:_policy->purpose.c_str()],@"enrollmentFrame":[NSString stringWithUTF8String:_policy->enrollmentFrame.c_str()],@"profileFrame":[NSString stringWithUTF8String:_policy->profileFrame.c_str()],@"currentFrame":[NSString stringWithUTF8String:_policy->currentFrame.c_str()]};
   NSMutableDictionary *policy=[@{@"rootDigest":[NSString stringWithUTF8String:_policy->rootDigest.c_str()],@"enrollmentDigest":[NSString stringWithUTF8String:_policy->enrollmentDigest.c_str()],@"endpoint":[NSString stringWithUTF8String:_policy->endpoint.c_str()],@"spki":[NSString stringWithUTF8String:_policy->spki.c_str()],@"signatureContract":contract}mutableCopy];
   if(_policy->purpose=="product-session-device-source-v4"||_policy->purpose=="product-session-device-pending-source-v4"||_policy->purpose=="product-session-device-provisioning-source-v4"||_policy->purpose=="product-session-device-query-source-v4"||_policy->purpose=="product-session-device-registered-finalization-source-v4"||_policy->purpose=="product-session-device-http-binary-source-v5"){
    if((_policy->purpose=="product-session-device-source-v4"?!_productDeviceV4:_policy->purpose=="product-session-device-pending-source-v4"?!_productDeviceV4Pending:_policy->purpose=="product-session-device-provisioning-source-v4"?!_productDeviceV4Provisioning:_policy->purpose=="product-session-device-query-source-v4"?!_productDeviceV4Query:_policy->purpose=="product-session-device-registered-finalization-source-v4"?!_productDeviceV4RegisteredFinalization:!_productHTTPV5)||_policy->productDeviceV4ApplicationId.empty()||_policy->productDeviceV4ProductId.empty())return [self fail:@"PRODUCT_DEVICE_V4_DEDICATED_SOURCE_OWNER_REQUIRED" error:error];
    policy[@"applicationId"]=[NSString stringWithUTF8String:_policy->productDeviceV4ApplicationId.c_str()];
    policy[@"productId"]=[NSString stringWithUTF8String:_policy->productDeviceV4ProductId.c_str()];
   }else if(_productDeviceV4||_productDeviceV4Pending||_productDeviceV4Provisioning||_productDeviceV4Query||_productDeviceV4RegisteredFinalization||_productHTTPV5)return [self fail:@"PRODUCT_DEVICE_V4_DEDICATED_SOURCE_PURPOSE_REQUIRED" error:error];
   if(_policy->purpose=="wallet-pq-host-catalog-source-v1"){
    if(!_walletPQCatalog||_policy->walletPQApplicationId.empty())return [self fail:@"PQ_HOST_DEDICATED_SOURCE_OWNER_REQUIRED" error:error];
    policy[@"applicationId"]=[NSString stringWithUTF8String:_policy->walletPQApplicationId.c_str()];
   }else if(_walletPQCatalog)return [self fail:@"PQ_HOST_DEDICATED_SOURCE_PURPOSE_REQUIRED" error:error];
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
- (BOOL)checkOriginalRuntimeImageBinding:(NSDictionary *)binding error:(NSError **)error {
 @synchronized(self){
  if([self class]!=YNXAuthIdentitySourceAuthority.class||!_policy||
    !((_productHTTPV5&&_policy->purpose=="product-session-device-http-binary-source-v5")||
      (_productDeviceV4RegisteredFinalization&&_policy->purpose=="product-session-device-registered-finalization-source-v4")))
   return [self fail:@"AUTH_RUNTIME_IMAGE_DEDICATED_PURPOSE_REQUIRED" error:error];
  if(![self assertAuthenticatedNativePurpose:error])return NO;
  NSDictionary *actual=_selection[@"runtimeImageBindingV1"];
  // Only the sole SDK mathematically checked selection, never profile hints.
  if(![actual isKindOfClass:NSDictionary.class])return [self fail:@"AUTH_RUNTIME_IMAGE_BINDING_V1_NOT_SUPPLIED" error:error];
  if(binding&&![actual isEqual:binding])return [self fail:@"AUTH_RUNTIME_IMAGE_BINDING_CHANGED" error:error];
  return [self heldCurrent:error];
 }
}
- (NSDictionary *)retainOriginalRuntimeImageBinding:(NSError **)error {
 @synchronized(self){
  if(![self checkOriginalRuntimeImageBinding:nil error:error])return nil;
  NSData *raw=[NSJSONSerialization dataWithJSONObject:_selection[@"runtimeImageBindingV1"] options:NSJSONWritingSortedKeys error:nil];
  NSDictionary *copy=raw.length&&raw.length<=32768?[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil]:nil;
  if(!copy||![self checkOriginalRuntimeImageBinding:copy error:error])return nil;
  if(_runtimeImageLoans==UINT_MAX)return [self fail:@"AUTH_RUNTIME_IMAGE_LOAN_OVERFLOW" error:error],nil;
  ++_runtimeImageLoans;return copy;
 }
}
- (BOOL)finishOriginalRuntimeImageBinding:(NSDictionary *)binding error:(NSError **)error {
 @synchronized(self){
  if(![self heldCurrent:error]||!binding||![_selection[@"runtimeImageBindingV1"]isEqual:binding]||
    !_cachedCurrentExpiresMS||_cachedCurrentExpiresMS<=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0))
   return [self fail:@"AUTH_RUNTIME_IMAGE_TERMINAL_CURRENT_EXPIRED" error:error];
  return YES;
 }
}
- (void)releaseOriginalRuntimeImageLoan {@synchronized(self){if(_runtimeImageLoans)--_runtimeImageLoans;else [self fail:@"AUTH_RUNTIME_IMAGE_LOAN_UNDERFLOW" error:nil];}}
- (NSDictionary *)copyOriginalWalletPQHostCatalogContext:(NSError **)error {
 @synchronized(self){
  if(!_walletPQCatalog||!_policy||_policy->purpose!="wallet-pq-host-catalog-source-v1"||![self assertAuthenticatedNativePurpose:error])return [self fail:@"PQ_HOST_DEDICATED_SOURCE_OWNER_REQUIRED" error:error],nil;
  NSDictionary *scope=_selection[@"pqHostCatalogSource"];NSDictionary *profile=SourceOriginalBodyHint(_profileOriginal);
  if(![scope isKindOfClass:NSDictionary.class]||![profile[@"instanceId"]isKindOfClass:NSString.class]||
    ![scope[@"protocolImagePath"]isEqual:[NSString stringWithUTF8String:_policy->walletPQProtocolImagePath.c_str()]]||
    ![scope[@"protocolImageSHA256"]isEqual:[NSString stringWithUTF8String:_policy->walletPQProtocolImageDigest.c_str()]]||
    ![scope[@"protocolSourceRevision"]isEqual:[NSString stringWithUTF8String:_policy->walletPQProtocolSourceRevision.c_str()]]||
    ![scope[@"protocolReconcileContract"]isEqual:[NSString stringWithUTF8String:_policy->walletPQProtocolReconcileContract.c_str()]]||
    ![scope[@"protocolWalletRequestContract"]isEqual:@"YNX-PQ-HOST-CATALOG-WALLET-JOURNAL6/v1"]||
    _cachedCurrentExpiresMS<=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0))return [self fail:@"PQ_HOST_QUALIFIED_PROTOCOL_RELEASE_REQUIRED" error:error],nil;
  NSDictionary *context=@{@"sourceId":[NSString stringWithUTF8String:_policy->sourceId.c_str()],@"instanceId":profile[@"instanceId"],@"profileDigest":SourceSHA(_profileOriginal),@"applicationId":[NSString stringWithUTF8String:_policy->walletPQApplicationId.c_str()],@"scope":[scope copy]};
  if(![self heldCurrent:error]||_cachedCurrentExpiresMS<=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0))return nil;
  return context;
 }
}
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
- (BOOL)join:(NSError **)error {@synchronized(self){if(!_retired||_entered||_task.running||_controlKeyBorrowToken||_httpV5Loans||_runtimeImageLoans)return [self fail:@"AUTH_IDENTITY_SOURCE_JOIN_PENDING" error:error];if(_helperClient&&![_helperClient join:error])return NO;return !_custody||[_custody join:error];}}
- (BOOL)close:(NSError **)error {
 @synchronized(self){[self retire];if(_runtimeImageLoans){if(!_runtimeImageCloseCause)_runtimeImageCloseCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_RUNTIME_IMAGE_CHILDREN_RETAINED"}];if(error)*error=_runtimeImageCloseCause;return NO;}}
 @synchronized(self){[self retire];if(_productHTTPV5&&_httpV5Loans){if(!_httpV5CloseCause)_httpV5CloseCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PRODUCT_HTTP_V5_REGISTERED_CHILDREN_RETAINED"}];if(error)*error=_httpV5CloseCause;return NO;}if(_closeSelected){if(error)*error=_runtimeImageCloseCause?:_httpV5CloseCause?:_cleanupCause;return _cleanupComplete&&!_httpV5CloseCause&&!_runtimeImageCloseCause;}
  if(![self join:error])return NO;_closeSelected=YES;BOOL filesClosed=YES;
  if(_helperClient){NSError*clientError=nil;if(![_helperClient close:&clientError]||clientError){_cleanupCause=clientError?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_HELPER_CLIENT_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;}_helperClient=nil;}
  if(_publicInstallation&&!_publicInstallation->close()){
   _cleanupComplete=NO;_cleanupCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_RECEIVER_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;
  }
  for(auto &file:_files){if(file.selected){if(!file.complete)filesClosed=NO;continue;}file.selected=true;file.complete=::close(file.fd)==0;if(!file.complete)filesClosed=NO;}if(![self closeHeldPipes])filesClosed=NO;
  NSError *cause=nil;BOOL custodyClosed=!_custody||[_custody close:&cause];_cleanupComplete=filesClosed&&custodyClosed;if(!_cleanupComplete)_cleanupCause=cause?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_SOURCE_CLOSE_UNKNOWN"}];if(error)*error=_runtimeImageCloseCause?:_httpV5CloseCause?:_cleanupCause;return _cleanupComplete&&!_httpV5CloseCause&&!_runtimeImageCloseCause;}
}
@end

@implementation YNXIDEProjectServiceObserver {
 YNXAuthIdentitySourceAuthority *_source;
 BOOL _retired,_closeSelected,_closed;
 NSError *_closeCause;
}
+ (instancetype)acquireOriginalObserver:(NSError**)error {
 YNXIDEProjectServiceObserver*owner=[self new];NSError*e=nil;
 owner->_source=[YNXAuthIdentitySourceAuthority acquireIDEConsumerWithPurpose:3 error:&e];
 // Keep a real cleanup partial; nil/closed is never mistaken for readiness.
 if(e||!owner->_source){if(error)*error=e?:[NSError errorWithDomain:@"YNXIDEProjectObserver" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_APP_OBSERVER_SOURCE_UNAVAILABLE"}];[owner retire];return owner;}
 return owner;
}
- (BOOL)assertCurrent:(NSError**)error {@synchronized(self){if(_retired||!_source){if(error)*error=[NSError errorWithDomain:@"YNXIDEProjectObserver" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_APP_OBSERVER_RETIRED"}];return NO;}NSError*e=nil;BOOL ok=[_source assertCurrent:&e];if(!ok||e)[self retire];if(error)*error=e;return ok&&!e;}}
- (NSDictionary*)copyCurrentServiceRegistration:(NSError**)error {@synchronized(self){if(![self assertCurrent:error])return nil;return [_source copyOriginalAppObservedService:error];}}
- (void)retire {@synchronized(self){_retired=YES;[_source retire];}}
- (BOOL)join:(NSError**)error {@synchronized(self){if(!_retired)return NO;NSError*e=nil;BOOL ok=!_source||[_source join:&e];if(error)*error=e;return ok&&!e;}}
- (BOOL)close:(NSError**)error {@synchronized(self){[self retire];if(_closeSelected){if(error)*error=_closeCause;return _closed;}if(![self join:error])return NO;_closeSelected=YES;NSError*e=nil;BOOL ok=!_source||[_source close:&e];_closed=ok&&!e;_closeCause=e;if(!_closed&&!_closeCause)_closeCause=[NSError errorWithDomain:@"YNXIDEProjectObserver" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_APP_OBSERVER_CLOSE_UNKNOWN"}];if(error)*error=_closeCause;return _closed;}}
@end
