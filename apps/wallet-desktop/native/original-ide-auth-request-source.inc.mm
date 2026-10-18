#import "original-ide-auth-request-source.h"
#import <Security/Security.h>
#include <CommonCrypto/CommonDigest.h>
#include <climits>
#include <algorithm>
static BOOL IDERequestFail(NSError **error,NSString *code){if(error&&!*error)*error=[NSError errorWithDomain:@"YNXOriginalIDEIdentityRequest" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];return NO;}
static NSString *IDERequestHash(NSData *raw){unsigned char bytes[CC_SHA256_DIGEST_LENGTH];CC_SHA256(raw.bytes,(CC_LONG)raw.length,bytes);NSMutableString*s=[NSMutableString string];for(auto b:bytes)[s appendFormat:@"%02x",b];return s;}
static NSData *IDERequestCanonical(id value){return [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];}
static NSDictionary *IDERequestDictionary(NSData *raw,NSUInteger cap){
 if(![raw isKindOfClass:NSData.class]||!raw.length||raw.length>cap)return nil;
 id parsed=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];return [parsed isKindOfClass:NSDictionary.class]&&[IDERequestCanonical(parsed)isEqual:raw]?parsed:nil;
}
static NSDictionary *IDERequestV2Body(NSData *raw){
 NSDictionary *e=IDERequestDictionary(raw,393216);NSString *text=e[@"body"];
 if(![e[@"version"]isEqual:@2]||![e[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||![text isKindOfClass:NSString.class]||text.length>87384)return nil;
 NSString *b64=[[text stringByReplacingOccurrencesOfString:@"-" withString:@"+"]stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
 if(b64.length%4==1)return nil;while(b64.length%4)b64=[b64 stringByAppendingString:@"="];
 NSData *body=[[NSData alloc]initWithBase64EncodedString:b64 options:0];
 NSString *again=[[[body base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
 again=[again stringByReplacingOccurrencesOfString:@"=" withString:@""];
 return [again isEqual:text]?IDERequestDictionary(body,65536):nil;
}
static BOOL IDERequestText(id value,NSUInteger cap){
 if(![value isKindOfClass:NSString.class]||![value length])return NO;
 NSData *bytes=[value dataUsingEncoding:NSASCIIStringEncoding allowLossyConversion:NO];if(!bytes||bytes.length>cap)return NO;
 for(NSUInteger i=0;i<bytes.length;i++){unsigned char c=((const unsigned char*)bytes.bytes)[i];if(c<0x21||c>0x7e)return NO;}return YES;
}
static BOOL IDERequestHex(id value,NSUInteger n){
 if(![value isKindOfClass:NSString.class]||[value length]!=n)return NO;
 for(NSUInteger i=0;i<n;i++){unichar c=[value characterAtIndex:i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return NO;}return YES;
}
static BOOL IDERequestDecimal(id value,uint64_t *out,BOOL positive){
 if(![value isKindOfClass:NSString.class]||![value length]||[value length]>20||([value length]>1&&[value characterAtIndex:0]=='0'))return NO;
 uint64_t n=0;for(NSUInteger i=0;i<[value length];i++){unichar c=[value characterAtIndex:i];if(c<'0'||c>'9'||n>(UINT64_MAX-(c-'0'))/10)return NO;n=n*10+c-'0';}
 if(positive&&!n)return NO;*out=n;return YES;
}
static BOOL IDERequestPurpose(NSString *purpose){return [@[@"AUTH-IDENTITY-RECEIVE",@"AUTH-IDENTITY-RECOVER",@"AUTH-PROTECTED-KEY-CALL"]containsObject:purpose];}
// DATA extraction only AFTER actual Source admission/current. This does not
// authenticate the envelopes itself or let a legacy login Source mint v2.
static NSDictionary *IDERequestContext(YNXAuthIdentitySourceAuthority *source,NSString *purpose,NSData *invocation,NSError **error){
 if([source class]!=YNXAuthIdentitySourceAuthority.class||!IDERequestPurpose(purpose)){IDERequestFail(error,@"AUTH_IDENTITY_ORIGINAL_SOURCE_REQUIRED");return nil;}
 NSDictionary *raw=[source copyOriginalProvisioningPublicOriginals:error];if(!raw|| (error&&*error))return nil;
 for(NSString *name in @[@"rootOriginal",@"enrollmentOriginal",@"profileOriginal",@"currentOriginal"]){NSData*b=raw[name];if(![b isKindOfClass:NSData.class]||!b.length||b.length>([name isEqual:@"rootOriginal"]?16384:393216)){IDERequestFail(error,@"AUTH_IDENTITY_ORIGINAL_SOURCE_BYTES_REQUIRED");return nil;}}
 NSDictionary *root=IDERequestDictionary(raw[@"rootOriginal"],16384),*profile=IDERequestV2Body(raw[@"profileOriginal"]),*current=IDERequestV2Body(raw[@"currentOriginal"]);
 NSDictionary *envelope=IDERequestDictionary(raw[@"currentOriginal"],393216),*selection=profile[@"selection"];
 NSDictionary *association=selection[@"association"];
 NSString *network=root[@"networkId"],*owner=current[@"subjectOwner"],*revision=current[@"subjectKeyVersion"],*height=envelope[@"executionHeight"];
 uint64_t key=0,h=0;
 if(![root[@"version"]isEqual:@2]||![root[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||
  ![root[@"purpose"]isEqual:purpose]||![profile[@"purpose"]isEqual:purpose]||![current[@"purpose"]isEqual:purpose]||
  ![profile[@"subjectOwner"]isEqual:owner]||!IDERequestHex(network,64)||![owner isKindOfClass:NSString.class]||![owner hasPrefix:@"0x"]||!IDERequestHex([owner substringFromIndex:2],40)||
  !IDERequestDecimal(revision,&key,YES)||!IDERequestDecimal(height,&h,NO)||
  !IDERequestText(association[@"account"],512)||![association[@"productId"]isEqual:@"developer"]||
  ![association[@"applicationId"]isEqual:@"com.ynxweb4.developer.testnetpreview"]||!IDERequestText(association[@"deviceId"],512)||
  !IDERequestHex(current[@"head"],64)||!IDERequestText(current[@"sourceId"],128)||
  ![current[@"profileDigest"]isEqual:IDERequestHash(raw[@"profileOriginal"])]){IDERequestFail(error,@"AUTH_IDENTITY_V2_NATIVE_CONTEXT_REQUIRED");return nil;}
 if([purpose isEqual:@"AUTH-PROTECTED-KEY-CALL"]){
  if(!IDERequestDictionary(invocation,16384)){IDERequestFail(error,@"AUTH_IDENTITY_ORIGINAL_INVOCATION_INVALID");return nil;}
 }else if(invocation.length){IDERequestFail(error,@"AUTH_IDENTITY_UNEXPECTED_INVOCATION");return nil;}
 NSDictionary *binding=@{@"purpose":purpose,@"sourceId":current[@"sourceId"],@"head":current[@"head"],@"rootDigest":IDERequestHash(raw[@"rootOriginal"]),
  @"enrollmentDigest":IDERequestHash(raw[@"enrollmentOriginal"]),@"profileDigest":current[@"profileDigest"],@"subjectOwner":owner,@"keyVersion":revision,@"executionHeight":height,@"invocationDigest":IDERequestHash(invocation?:[NSData data])};
 // copyOriginalProvisioningPublicOriginals already returns the SAME admitted
 // immutable originals under its original pre/post fence. Do not refresh the
 // Source again AFTER capturing H/revision and accidentally publish old DATA
 // as if it described the new current. The outer request fixed clock follows.
 return @{@"networkId":network,@"owner":owner,@"keyVersion":revision,@"executionHeight":height,@"principalId":association[@"account"],@"productId":@"developer",
  @"applicationId":association[@"applicationId"],@"deviceId":association[@"deviceId"],@"purpose":purpose,@"credentialDigest":current[@"profileDigest"],
  @"requestDigest":IDERequestHash(IDERequestCanonical(binding)),@"currentExpiresAtMs":current[@"expiresAtMs"]};
}
@implementation YNXAuthIdentitySourceAuthority (OriginalIDEIdentityRequest)
- (NSData *)copyOriginalIDEIdentityRequestForPurpose:(NSString *)purpose invocation:(NSData *)invocation error:(NSError **)error{
 NSDictionary *context=IDERequestContext(self,purpose,invocation,error);if(!context)return nil;
 uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);id end=context[@"currentExpiresAtMs"];
 if(![end isKindOfClass:NSNumber.class]||[end unsignedLongLongValue]<=now||[end unsignedLongLongValue]>9007199254740991ULL){IDERequestFail(error,@"AUTH_IDENTITY_SOURCE_CURRENT_EXPIRED");return nil;}
 uint64_t expires=std::min<uint64_t>(now+30000,[end unsignedLongLongValue]);unsigned char nonce[32];
 if(SecRandomCopyBytes(kSecRandomDefault,sizeof(nonce),nonce)!=errSecSuccess){IDERequestFail(error,@"AUTH_IDENTITY_NONCE_UNAVAILABLE");return nil;}
 unsigned char nonzero=0;for(auto b:nonce)nonzero|=b;if(!nonzero){IDERequestFail(error,@"AUTH_IDENTITY_NONCE_UNAVAILABLE");return nil;}
 NSString *encoded=[[[[NSData dataWithBytes:nonce length:sizeof(nonce)]base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
 encoded=[encoded stringByReplacingOccurrencesOfString:@"=" withString:@""];
 NSMutableDictionary *request=[context mutableCopy];[request removeObjectForKey:@"currentExpiresAtMs"];
 request[@"version"]=@"YNX-AUTH-IDENTITY/v2";request[@"algorithmVersion"]=@"YNX-BATCH/v0.1";request[@"requestId"]=NSUUID.UUID.UUIDString;request[@"nonce"]=encoded;
 request[@"issuedAtMs"]=[NSString stringWithFormat:@"%llu",(unsigned long long)now];request[@"expiresAtMs"]=[NSString stringWithFormat:@"%llu",(unsigned long long)expires];
 NSData *raw=IDERequestCanonical(request);
 if(!raw||raw.length>16384||![self assertOriginalIDEIdentityRequestCurrent:raw invocation:invocation error:error])return nil;return raw;
}
- (BOOL)assertOriginalIDEIdentityRequestCurrent:(NSData *)raw invocation:(NSData *)invocation error:(NSError **)error{
 NSDictionary *request=IDERequestDictionary(raw,16384);NSString *purpose=request[@"purpose"];
 if(request.count!=17||![request[@"version"]isEqual:@"YNX-AUTH-IDENTITY/v2"]||![request[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||!IDERequestPurpose(purpose))return IDERequestFail(error,@"AUTH_IDENTITY_ORIGINAL_REQUEST_INVALID");
 NSDictionary *context=IDERequestContext(self,purpose,invocation,error);if(!context)return NO;
 for(NSString *key in context)if(![key isEqual:@"currentExpiresAtMs"]&&![request[key]isEqual:context[key]])return IDERequestFail(error,@"AUTH_IDENTITY_ORIGINAL_REQUEST_CHANGED");
 uint64_t issued=0,expires=0,now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
 if(!IDERequestDecimal(request[@"issuedAtMs"],&issued,NO)||!IDERequestDecimal(request[@"expiresAtMs"],&expires,NO)||expires<=issued||expires-issued>30000||now<issued||now>=expires||expires>[context[@"currentExpiresAtMs"]unsignedLongLongValue]||
  !IDERequestText(request[@"requestId"],128)||![request[@"nonce"]isKindOfClass:NSString.class]||[request[@"nonce"]length]!=43)return IDERequestFail(error,@"AUTH_IDENTITY_ORIGINAL_REQUEST_EXPIRED");
 return YES;
}
@end
