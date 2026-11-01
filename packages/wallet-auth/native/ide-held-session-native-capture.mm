#import "ide-held-session-native-capture.h"
#import "ide-original-read-release-private.hpp"
#import "original-auth-identity-source-authority.h"
#include <pthread.h>
namespace phys=ynx::wallet::pay::root_physical;
namespace {
NSError *captureError(NSString *code){return [NSError errorWithDomain:@"YNXIDEHeldSessionCapture" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
}
@implementation YNXIDEHeldSessionNativeCapture {
 YNXAuthIdentitySourceAuthority *_source;YNXIDEOriginalSessionStoreRead *_store;
 std::unique_ptr<phys::PublicOriginalHold> _registry;
 const ynx_auth_private::IDEOriginalReadRelease *_row;NSDictionary *_scope,*_witness,*_metadata;
 pthread_t _thread;NSError *_first;BOOL _retired,_closed,_closeSelected;
}
- (BOOL)reject:(NSError *)e out:(NSError **)error {if(!_first)_first=e?:captureError(@"IDE_HELD_SESSION_UNKNOWN");_retired=YES;if(error)*error=_first;return NO;}
+ (instancetype)holdUsingOriginalSource:(YNXAuthIdentitySourceAuthority *)source error:(NSError **)error {
 auto o=[self new];o->_thread=pthread_self();o->_source=source;NSError *e=nil;
 @try{
  // Reuse the existing independent device.current/device.http-proof Source
  // purpose, NOT the four IDE login parent operations or an OS observation.
  if([source class]!=YNXAuthIdentitySourceAuthority.class||![source assertOriginalProductSessionDeviceV4SourceCurrent:&e]||e){[o reject:e?:captureError(@"IDE_HELD_SESSION_ORIGINAL_V4_SOURCE_REQUIRED") out:error];return o;}
  o->_scope=[source copyOriginalProductSessionDeviceV4Scope:&e];o->_witness=[source copyOriginalProvisioningPublicOriginals:&e];
  NSDictionary *expected=o->_scope[@"expected"];NSString *sid=o->_witness[@"sourceId"];
  if(e||!sid||![expected[@"productId"]isEqual:@"developer"]||![expected[@"platform"]isEqual:@"macos"]){[o reject:e?:captureError(@"IDE_HELD_SESSION_IDE_BINDING_REQUIRED") out:error];return o;}
  for(const auto&r:ynx_auth_private::originalIDEReadReleases())if([r.sourceId isEqual:sid]&&[r.account isEqual:expected[@"account"]]&&[r.applicationId isEqual:expected[@"applicationId"]]){if(o->_row){[o reject:captureError(@"IDE_HELD_SESSION_DUPLICATE_RELEASE") out:error];return o;}o->_row=&r;}
  if(!o->_row){[o reject:captureError(@"IDE_HELD_SESSION_STORE_RELEASE_NOT_SUPPLIED") out:error];return o;}
  const auto&r=*o->_row;
  NSString *key=[NSString stringWithFormat:@"ynx.product-session.v2:developer:macos:%@",r.applicationId];
  if(![r.store.baseKey isEqual:key]||r.gatewayTimeoutMs<1||r.gatewayTimeoutMs>30000){[o reject:captureError(@"IDE_HELD_SESSION_RELEASE_BINDING") out:error];return o;}
  phys::Spec spec=r.registry;spec.not_before_ms=[o->_witness[@"issuedAtMs"]unsignedLongLongValue];spec.expires_ms=[o->_witness[@"expiresAtMs"]unsignedLongLongValue];
  auto acquired=phys::hold_original(spec);o->_registry=std::move(acquired.owner); // partial before error
  if(acquired.error!=phys::Code::ok||!o->_registry){[o reject:captureError(@"IDE_HELD_SESSION_REGISTRY_ORIGINAL_NOT_CURRENT") out:error];return o;}
  std::vector<unsigned char>bytes;if(o->_registry->read_original(bytes)!=phys::Code::ok){[o reject:captureError(@"IDE_HELD_SESSION_REGISTRY_READ") out:error];return o;}
  NSData *raw=[NSData dataWithBytes:bytes.data() length:bytes.size()];id registry=[NSJSONSerialization JSONObjectWithData:raw options:0 error:&e];
  if(e||![registry isKindOfClass:NSDictionary.class]){[o reject:e?:captureError(@"IDE_HELD_SESSION_REGISTRY_DATA") out:error];return o;}
  // Actual existing Keychain namespace, never RootScope.sessionOriginal as a
  // memory-backed store. Lock must already exist; no create/migrate/reset.
  o->_store=[YNXIDEOriginalSessionStoreRead holdOriginal:r.store error:&e];
  if(e||!o->_store){[o reject:e?:captureError(@"IDE_HELD_SESSION_STORE_NOT_SUPPLIED") out:error];return o;}
  o->_metadata=@{@"registry":registry,@"productId":@"developer",@"platform":@"macos",@"storageKey":key,@"gatewayTimeoutMs":@(r.gatewayTimeoutMs),@"securityLevel":@"os-protected"};
  if(![o assertCurrent:&e]){if(error)*error=e;return o;}return o;
 }@catch(id){[o reject:captureError(@"IDE_HELD_SESSION_CAPTURE_EXCEPTION") out:error];return o;}
}
- (BOOL)assertCurrent:(NSError **)error {
 if(!pthread_equal(_thread,pthread_self())){if(error)*error=captureError(@"IDE_HELD_SESSION_ORIGINAL_ACTOR");return NO;}
 if(_retired||_closed||_first){if(error)*error=_first?:captureError(@"IDE_HELD_SESSION_RETIRED");return NO;}
 NSError *e=nil;
 if(!_row||!_source||!_store||!_registry||![ _source assertOriginalProductSessionDeviceV4SourceCurrent:&e]||e)return [self reject:e?:captureError(@"IDE_HELD_SESSION_SOURCE_NOT_CURRENT") out:error];
 NSDictionary *scope=[_source copyOriginalProductSessionDeviceV4Scope:&e],*witness=[_source copyOriginalProvisioningPublicOriginals:&e];
 if(e||![_scope isEqual:scope])return [self reject:e?:captureError(@"IDE_HELD_SESSION_SCOPE_CHANGED") out:error];
 for(NSString*k in @[@"sourceId",@"profileDigest",@"head",@"floor"])if(![_witness[k]isEqual:witness[k]])return [self reject:captureError(@"IDE_HELD_SESSION_ORIGINAL_EPOCH_CHANGED") out:error];
 if(_registry->current()!=phys::Code::ok||![_store assertCurrent:&e]||e)return [self reject:e?:captureError(@"IDE_HELD_SESSION_PHYSICAL_NOT_CURRENT") out:error];
 NSString *original=[_store readOriginal:_metadata[@"storageKey"] error:&e];
 // Equality only; the body is read from actual store on every boundary. The
 // signed source snapshot is never returned in place of missing storage.
 if(e||!original||![original isEqual:_scope[@"sessionOriginal"]]||[_store revocationRequested])return [self reject:e?:captureError(@"IDE_HELD_SESSION_ORIGINAL_OR_REVOKE_CHANGED") out:error];
 if(_retired||![_source assertOriginalProductSessionDeviceV4SourceCurrent:&e]||e||_registry->current()!=phys::Code::ok)return [self reject:e?:captureError(@"IDE_HELD_SESSION_LATE_CURRENT") out:error];return YES;
}
- (NSDictionary *)readMetadata:(NSError **)error {if(![self assertCurrent:error])return nil;NSData*d=[NSJSONSerialization dataWithJSONObject:_metadata options:0 error:error];NSDictionary*out=d?[NSJSONSerialization JSONObjectWithData:d options:0 error:error]:nil;return [self assertCurrent:error]?out:nil;}
- (NSString *)readOriginal:(NSString *)key error:(NSError **)error {if(![self assertCurrent:error])return nil;NSString*out=[_store readOriginal:key error:error];if(error&&*error)return nil;return [self assertCurrent:error]?out:nil;}
- (BOOL)revocationRequested {NSError*e=nil;return ![self assertCurrent:&e]||[_store revocationRequested];}
- (void)retire {if(!pthread_equal(_thread,pthread_self()))@throw captureError(@"IDE_HELD_SESSION_ORIGINAL_ACTOR");_retired=YES;[_store retire];if(_registry)_registry->retire();}
- (BOOL)join:(NSError **)error {return !_store||[_store join:error];}
- (BOOL)close:(NSError **)error {
 if(_closed)return YES;if(!pthread_equal(_thread,pthread_self())){if(error)*error=captureError(@"IDE_HELD_SESSION_ORIGINAL_ACTOR");return NO;}
 if(_closeSelected){if(error)*error=_first?:captureError(@"IDE_HELD_SESSION_CLOSE_UNKNOWN");return NO;}
 [self retire];if(![self join:error])return NO;_closeSelected=YES;
 NSError*e=nil;if(_store&&![_store close:&e])return [self reject:e?:captureError(@"IDE_HELD_SESSION_STORE_CLOSE_UNKNOWN") out:error];
 if(_registry){(void)_registry->close();if(!_registry->closed())return [self reject:captureError(@"IDE_HELD_SESSION_REGISTRY_CLOSE_UNKNOWN") out:error];}
 _store=nil;_registry.reset();_source=nil;_metadata=nil;_closed=YES;return YES;
}
- (BOOL)closed{return _closed;}
- (void)dealloc {if(!_closed)abort();}
@end
