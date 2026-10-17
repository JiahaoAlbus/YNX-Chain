#import "original-ide-parent-source-binding.h"

namespace ynx_auth_ide_private {
static bool exact(NSDictionary *v,NSArray *keys){return [v isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:v.allKeys] isEqual:[NSSet setWithArray:keys]];}
static bool digest(id value){
 if(![value isKindOfClass:NSString.class]||[value length]!=64)return false;
 return [value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location==NSNotFound;
}
static bool codeIdentity(id value){
 if(![value isKindOfClass:NSString.class])return false;NSData *d=[[NSData alloc]initWithBase64EncodedString:value options:0];
 return d.length>=20&&d.length<=64&&[[d base64EncodedStringWithOptions:0] isEqual:value];
}
bool SourceBinding::fail(NSString *code,NSError **error){
 invalid_=true;if(!first_)first_=[NSError errorWithDomain:@"YNXOriginalIDEParentSource" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=first_;return false;
}
bool SourceBinding::capture(YNXAuthIdentitySourceAuthority *originalSource,NSError **error){
 std::lock_guard<std::recursive_mutex> lock(mutex_);
 if(selected_)return fail(@"IDE_SOURCE_ALREADY_SELECTED",error);selected_=true;source_=originalSource;
 if(!source_||![source_ assertAuthenticatedNativePurpose:error])return fail(@"IDE_ORIGINAL_SOURCE_NOT_ADMITTED",error);
 NSDictionary *s=[source_ copyOriginalSelection:error];
 if(![s isKindOfClass:NSDictionary.class])return fail(@"IDE_ORIGINAL_SOURCE_SELECTION_UNAVAILABLE",error);
 NSDictionary *request=s[@"expectedRequest"],*association=s[@"association"],*registered=s[@"ideParentBinding"];
 if(!exact(request,@[@"version",@"purpose",@"service",@"productId",@"platform",@"applicationId",@"gatewayOrigin",@"registryDigest",@"consumerManifestDigest",@"gatewayManifestDigest",@"instanceId",@"currentReference",@"operations",@"requestNonce",@"requestedAtMs",@"expiresAtMs"])||
    ![request[@"version"] isEqual:@1]||![request[@"purpose"] isEqual:@"wallet-product-session-v2-service-admission/v1"]||
    ![request[@"service"] isEqual:@"wallet-product-session-v2"]||![request[@"productId"] isEqual:@"developer"]||![request[@"platform"] isEqual:@"macos"]||
    ![request[@"applicationId"] isEqual:@"com.ynxweb4.developer.testnetpreview"]||![request[@"gatewayOrigin"] isEqual:@"https://wallet-auth.ynxweb4.com"]||
    ![request[@"operations"] isEqual:@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"]]||
    ![association isKindOfClass:NSDictionary.class]||![association[@"productId"] isEqual:request[@"productId"]]||![association[@"platform"] isEqual:request[@"platform"]]||![association[@"applicationId"] isEqual:request[@"applicationId"]])return fail(@"IDE_SOURCE_FOUR_OPERATION_REGISTRATION_MISMATCH",error);
 for(NSString *key in @[@"registryDigest",@"consumerManifestDigest",@"gatewayManifestDigest",@"currentReference"])if(!digest(request[key]))return fail(@"IDE_SOURCE_REQUEST_DIGEST_INVALID",error);
 // No workspace, NativeTools, project grant, PID or caller-selected path exists
 // in this binding. Parent and future child identities are observed at runtime.
 if(!exact(registered,@[@"walletCodeIdentity",@"ideCodeIdentity",@"nodeCodeIdentity",@"nodeSHA256",@"entrySHA256",@"provenanceSHA256"])||
    !codeIdentity(registered[@"walletCodeIdentity"])||!codeIdentity(registered[@"ideCodeIdentity"])||!codeIdentity(registered[@"nodeCodeIdentity"])||
    !digest(registered[@"nodeSHA256"])||!digest(registered[@"entrySHA256"])||!digest(registered[@"provenanceSHA256"]))return fail(@"IDE_SOURCE_PARENT_REGISTRATION_NOT_SUPPLIED",error);
 if(![request[@"instanceId"] isKindOfClass:NSString.class]||![request[@"instanceId"] length]||![request[@"requestNonce"] isKindOfClass:NSString.class]||[request[@"requestNonce"] length]!=43||
    ![request[@"requestedAtMs"] isKindOfClass:NSNumber.class]||![request[@"expiresAtMs"] isKindOfClass:NSNumber.class])return fail(@"IDE_SOURCE_INTENT_INVALID",error);
 NSString *nonce=request[@"requestNonce"];
 if([nonce rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"] invertedSet]].location!=NSNotFound)return fail(@"IDE_SOURCE_INTENT_INVALID",error);
 NSDictionary *sourceSelection=s[@"sourceSelection"],*receiptSelection=s[@"receiptSelection"];NSString *directory=s[@"receiptDirectory"];
 if(!exact(sourceSelection,@[@"rootPath",@"rootDigest",@"rolePath",@"roleDigest"])||!exact(receiptSelection,@[@"receiptPath",@"receiptDigest"])||!digest(sourceSelection[@"rootDigest"])||!digest(sourceSelection[@"roleDigest"])||!digest(receiptSelection[@"receiptDigest"])||![directory isKindOfClass:NSString.class])return fail(@"IDE_SOURCE_INSTALLED_SELECTION_NOT_SUPPLIED",error);
 for(id path in @[sourceSelection[@"rootPath"]?:NSNull.null,sourceSelection[@"rolePath"]?:NSNull.null,receiptSelection[@"receiptPath"]?:NSNull.null,directory]){
  if(![path isKindOfClass:NSString.class]||![path hasPrefix:@"/"]||![path isEqual:[path stringByStandardizingPath]]||[path rangeOfString:[NSString stringWithFormat:@"%C",(unichar)0]].location!=NSNotFound)return fail(@"IDE_SOURCE_INSTALLED_PATH_INVALID",error);
 }
 if(![receiptSelection[@"receiptPath"] isEqual:[directory stringByAppendingPathComponent:[nonce stringByAppendingString:@".admission.json"]]])return fail(@"IDE_SOURCE_INSTALLED_RECEIPT_PATH_MISMATCH",error);
 uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000),issued=[request[@"requestedAtMs"] unsignedLongLongValue],expires=[request[@"expiresAtMs"] unsignedLongLongValue];
 if(issued>now||expires<=now||expires<=issued||expires-issued>30000)return fail(@"IDE_SOURCE_INTENT_EXPIRED",error);
 selection_=[s copy];request_=[request copy];registration_=[registered copy];return current(error);
}
bool SourceBinding::current(NSError **error){
 std::lock_guard<std::recursive_mutex> lock(mutex_);
 if(invalid_||!source_||!selection_)return fail(@"IDE_SOURCE_RETIRED",error);
 if(![source_ assertAuthenticatedNativePurpose:error])return fail(@"IDE_SOURCE_CURRENT_UNAVAILABLE",error);
 NSDictionary *now=[source_ copyOriginalSelection:error];
 if(![now isEqual:selection_]||(uint64_t)(NSDate.date.timeIntervalSince1970*1000)>=[request_[@"expiresAtMs"] unsignedLongLongValue])return fail(@"IDE_SOURCE_CURRENT_BINDING_CHANGED",error);
 return true;
}
NSNumber *SourceBinding::currentSequence(NSError **error){std::lock_guard<std::recursive_mutex> lock(mutex_);if(!current(error))return nil;return [source_ copyOriginalCurrentSequence:error];}
}
