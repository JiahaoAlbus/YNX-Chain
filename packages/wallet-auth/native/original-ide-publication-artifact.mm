#import "original-ide-publication-artifact.h"
#include <CommonCrypto/CommonDigest.h>
#include <cstring>
static BOOL PublicationFail(NSError **error,NSString *code){if(error&&!*error)*error=[NSError errorWithDomain:@"YNXOriginalIDEPublicationArtifact" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];return NO;}
static NSString *PublicationHash(NSData *raw){unsigned char out[CC_SHA256_DIGEST_LENGTH];CC_SHA256(raw.bytes,(CC_LONG)raw.length,out);NSMutableString*s=[NSMutableString string];for(unsigned char c:out)[s appendFormat:@"%02x",c];return s;}
static BOOL PublicationText(id value){
 if(![value isKindOfClass:NSString.class])return NO;
 NSData *utf8=[value dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
 return utf8.length>0&&utf8.length<=256&&[value isEqual:[value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]]&&[value rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location==NSNotFound;
}
@implementation YNXOriginalIDEPublicationArtifact {
 NSData *_manifest,*_artifact;NSDictionary *_binding;NSString *_manifestHash;
}
- (instancetype)initCapturedManifest:(NSData*)manifest artifact:(NSData*)artifact binding:(NSDictionary*)binding{
 if((self=[super init])){_manifest=manifest;_artifact=artifact;_binding=[binding copy];_manifestHash=PublicationHash(manifest);}return self;
}
+ (instancetype)captureOriginalManifest:(NSData*)manifest artifact:(NSData*)artifact error:(NSError**)error{
 if(![manifest isKindOfClass:NSData.class]||manifest.length==0||manifest.length>16384||![artifact isKindOfClass:NSData.class]||artifact.length==0||artifact.length>67108864){PublicationFail(error,@"IDE_PUBLICATION_ARTIFACT_BOUNDS");return nil;}
 // Copy BEFORE parse/hash/review. Consumers sign this snapshot, never a path
 // reopened after approval or mutable caller backing storage.
 NSData *m=[manifest copy],*a=[artifact copy];
 NSDictionary *parsed=YNXParseOriginalIDEPublicationManifest(m,error);if(!parsed)return nil;
 if([parsed[@"byteSize"]unsignedLongLongValue]!=a.length){PublicationFail(error,@"IDE_PUBLICATION_ARTIFACT_SIZE");return nil;}
 if(![parsed[@"contentDigest"]isEqual:PublicationHash(a)]){PublicationFail(error,@"IDE_PUBLICATION_ARTIFACT_DIGEST");return nil;}
 return [[self alloc]initCapturedManifest:m artifact:a binding:parsed];
}
- (NSData*)copyOriginalManifest{return [_manifest copy];}
- (NSData*)copyOriginalArtifact{return [_artifact copy];}
- (NSDictionary*)copyOriginalBinding{return [_binding copy];}
- (NSString*)copyOriginalManifestSHA256{return [_manifestHash copy];}
- (BOOL)matchesOriginalManifest:(NSData*)manifest artifact:(NSData*)artifact error:(NSError**)error{
 // A changed file or manifest requires a NEW visible review/approval. Never
 // repair the old original request, signature, nonce or UNKNOWN operation.
 if(![manifest isKindOfClass:NSData.class]||![artifact isKindOfClass:NSData.class]||![manifest isEqual:_manifest]||![artifact isEqual:_artifact])return PublicationFail(error,@"IDE_PUBLICATION_ORIGINAL_CHANGED_REAPPROVAL_REQUIRED");return YES;
}
@end
NSDictionary *YNXParseOriginalIDEPublicationManifest(NSData *manifest,NSError **error){
 if(![manifest isKindOfClass:NSData.class]||manifest.length==0||manifest.length>16384){PublicationFail(error,@"IDE_PUBLICATION_MANIFEST_BOUNDS");return nil;}
 NSData *m=[manifest copy];
 id parsed=[NSJSONSerialization JSONObjectWithData:m options:0 error:nil];
 NSSet *keys=[NSSet setWithArray:@[@"projectId",@"version",@"contentDigest",@"publishPurpose",@"targetEnvironment",@"byteSize"]];
 if(![parsed isKindOfClass:NSDictionary.class]||![keys isEqual:[NSSet setWithArray:[parsed allKeys]]]){PublicationFail(error,@"IDE_PUBLICATION_MANIFEST_FIELDS");return nil;}
 // Original identity invocation already uses canonical JSON. This typed
 // manifest accepts that same canonical encoding. Exact original bytes are
 // retained, not reconstructed as signature input. Noncanonical JSON (incl.
 // duplicate/escaped duplicate fields) refuses; Cloud may parse a wider DATA
 // subset, but cannot turn it into a valid Auth publication operation.
 NSData *canonical=[NSJSONSerialization dataWithJSONObject:parsed options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 if(![canonical isEqual:m]){PublicationFail(error,@"IDE_PUBLICATION_MANIFEST_CANONICAL_REQUIRED");return nil;}
 for(NSString *name in @[@"projectId",@"version",@"publishPurpose",@"targetEnvironment"])if(!PublicationText(parsed[name])){PublicationFail(error,@"IDE_PUBLICATION_MANIFEST_TEXT");return nil;}
 id size=parsed[@"byteSize"];const char *type=[size isKindOfClass:NSNumber.class]?[size objCType]:"";
 if(![size isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)size)==CFBooleanGetTypeID()||!std::strchr("cCsSiIlLqQ",type[0])||type[0]==0||[size longLongValue]<=0||[size unsignedLongLongValue]>67108864){PublicationFail(error,@"IDE_PUBLICATION_ARTIFACT_SIZE");return nil;}
 NSString *hash=parsed[@"contentDigest"];
 if(![hash isKindOfClass:NSString.class]||hash.length!=64){PublicationFail(error,@"IDE_PUBLICATION_ARTIFACT_DIGEST");return nil;}
 for(NSUInteger i=0;i<hash.length;i++){unichar c=[hash characterAtIndex:i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f'))){PublicationFail(error,@"IDE_PUBLICATION_ARTIFACT_DIGEST");return nil;}}
 return [parsed copy];
}
