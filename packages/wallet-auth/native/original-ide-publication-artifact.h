#pragma once
#import <Foundation/Foundation.h>
// Native request construction uses this typed DATA parser before requesting
// proof. It validates no artifact/signature/ACL; only capture below hashes the
// actual immutable content. Signature domain remains original AUTH identity.
FOUNDATION_EXPORT NSDictionary *YNXParseOriginalIDEPublicationManifest(NSData *manifest,NSError **error);
// Private typed DATA captured before review/signing. This class is NOT the
// YNXOriginalIDEIdentityPrivateEffect protocol, ACL, publisher or signer.
@interface YNXOriginalIDEPublicationArtifact : NSObject
+ (instancetype)captureOriginalManifest:(NSData *)manifest artifact:(NSData *)artifact error:(NSError **)error;
- (NSData *)copyOriginalManifest;
- (NSData *)copyOriginalArtifact;
- (NSDictionary *)copyOriginalBinding;
- (NSString *)copyOriginalManifestSHA256;
- (BOOL)matchesOriginalManifest:(NSData *)manifest artifact:(NSData *)artifact error:(NSError **)error;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end
