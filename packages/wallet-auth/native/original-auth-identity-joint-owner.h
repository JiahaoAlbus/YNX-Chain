#import <Foundation/Foundation.h>

// Private Auth implementation ABI, not a public approval/profile schema.
// Raw custody and current reads alone NEVER qualify an executor or Root.
@interface YNXAuthIdentityCurrentOwner : NSObject
+ (instancetype)acquireOriginalAdministrationProfile:(NSError **)error;
// Actual inherited Node entry only; no path/ENV/caller constructor.
+ (instancetype)acquireOriginalIDEConsumerProfile:(NSError **)error;
+ (instancetype)acquireOriginalIDEContractRelayProfile:(NSError **)error;
+ (instancetype)acquireOriginalIDEProjectAuthorityProfile:(NSError **)error;
// Read-only App observer custody, never a Node/GET/sign grant.
+ (instancetype)acquireOriginalIDEProjectObserverProfile:(NSError **)error;
+ (instancetype)acquireOriginalIDEProjectControlProfile:(NSError **)error;
+ (instancetype)acquireOriginalIDERegistryProfile:(NSError **)error;
+ (instancetype)acquireOriginalWalletPQHostCatalogProfile:(NSError **)error;
// Independent device-v4 PUBLIC profile custody only. No ordinary Auth/IDE/
// account/BIRTH profile fallback or private-key access. Actual Source verifier
// and independently admitted device purpose remain separate requirements.
+ (instancetype)acquireOriginalProductSessionDeviceV4Profile:(NSError **)error;
+ (instancetype)acquireOriginalProductSessionDeviceV4PendingProfile:(NSError **)error;
+ (instancetype)acquireOriginalProductSessionDeviceV4ProvisioningProfile:(NSError **)error;
+ (instancetype)acquireOriginalProductSessionDeviceV4QueryProfile:(NSError **)error;
+ (instancetype)acquireOriginalProductSessionHTTPProofV5Profile:(NSError **)error;
+ (instancetype)acquireOriginalProductSessionDeviceV4RegisteredFinalizationProfile:(NSError **)error;
- (NSString *)copyOriginalResourceDirectory:(NSError **)error;
- (NSData *)copyOriginalProfile:(NSError **)error;
- (NSData *)copyOriginalHead:(NSError **)error;
- (BOOL)assertOriginalCurrent:(NSError **)error;
- (BOOL)assertIndependentNativePurposeAdmission:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@property(nonatomic,readonly) BOOL nativeQualified;
@property(nonatomic,readonly) BOOL cleanupComplete;
@end
