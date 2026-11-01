#pragma once
#include "original-private-session-carrier.h"
// Structural + registered-selection gate only. The selection MUST be copied
// from the actual authenticated Source owner after its original current/adopt
// fences. This function itself never authenticates a dictionary or grants use.
static NSString *const YNXPrivateReferenceContractDigest=@"ab90fbcd71e6386e763ee7a3c4abd2eab8806eb06c5418c7cd5a5bb649e83566";
static BOOL YNXOriginalPrivateReferenceRegistered(NSDictionary *selection) {
 if(![selection isKindOfClass:NSDictionary.class])return NO;
 NSDictionary *r=selection[@"privateReturnTransport"],*expected=selection[@"expectedRequest"];
 NSArray *fields=@[@"version",@"carrierVersion",@"contractDigest",@"consumerManifestDigest",@"gatewayManifestDigest",@"registryDigest",@"currentReference",@"actions"];
 if(!YNXPrivateExact(r,fields)||![expected isKindOfClass:NSDictionary.class]||
    ![r[@"version"] isEqual:@"YNX-PRIVATE-RETURNS/v1"]||
    ![r[@"carrierVersion"] isEqual:@"YNX-PRODUCT-SESSION-PRIVATE/v4"]||
    ![r[@"contractDigest"] isEqual:YNXPrivateReferenceContractDigest]||
    ![r[@"actions"] isEqual:@[@"beginYNX:challenge",@"handleReturn:complete",@"handleReturn:outcome"]])return NO;
 // Existing IDE-only Native purpose is not promoted to another product.
 if(![expected[@"service"] isEqual:@"wallet-product-session-v2"]||
    ![expected[@"productId"] isEqual:@"developer"]||![expected[@"platform"] isEqual:@"macos"]||
    ![expected[@"applicationId"] isEqual:@"com.ynxweb4.developer.testnetpreview"]||
    ![expected[@"gatewayOrigin"] isEqual:@"https://wallet-auth.ynxweb4.com"]||
    ![expected[@"operations"] isEqual:@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"]])return NO;
 NSCharacterSet *bad=[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
 for(NSString *key in @[@"consumerManifestDigest",@"gatewayManifestDigest",@"registryDigest",@"currentReference"]){
  id value=r[key];if(![value isKindOfClass:NSString.class]||[value length]!=64||[value rangeOfCharacterFromSet:bad].location!=NSNotFound||![value isEqual:expected[key]])return NO;
 }
 return YES;
}
static NSUInteger YNXOriginalQualifiedPrivateCarrierBudget(NSDictionary *input,NSData *raw,NSDictionary *authenticatedSelection) {
 if(![input isKindOfClass:NSDictionary.class])return 0;
 if(![input[@"carrierVersion"] isEqual:@"YNX-PRODUCT-SESSION-PRIVATE/v4"])return YNXOriginalPrivateCarrierBudget(input,raw);
 if(!YNXOriginalPrivateReferenceRegistered(authenticatedSelection)||!raw||raw.length>65536||
    !YNXPrivateExact(input,@[@"requestId",@"operation",@"phase",@"body",@"proofHeader",@"carrierVersion",@"referenceAction"])||
    ![YNXPrivateCanonical(input) isEqual:raw]||![input[@"phase"] isEqual:@"effect"]||input[@"proofHeader"]!=NSNull.null)return 0;
 NSString *requestID=input[@"requestId"],*op=input[@"operation"],*action=input[@"referenceAction"],*bodyText=input[@"body"];
 if(![requestID isKindOfClass:NSString.class]||![op isKindOfClass:NSString.class]||![action isKindOfClass:NSString.class]||![bodyText isKindOfClass:NSString.class]||[bodyText lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>49152)return 0;
 NSRegularExpression *ids=[NSRegularExpression regularExpressionWithPattern:@"^req_[A-Za-z0-9_-]{12,80}$" options:0 error:nil];
 NSTextCheckingResult *idMatch=[ids firstMatchInString:requestID options:0 range:NSMakeRange(0,requestID.length)];
 if(!idMatch||!NSEqualRanges(idMatch.range,NSMakeRange(0,requestID.length)))return 0;
 BOOL challenge=[op isEqual:@"beginYNX"]&&[action isEqual:@"challenge"];
 BOOL terminal=[op isEqual:@"handleReturn"]&&[@[@"complete",@"outcome"] containsObject:action];
 if(!challenge&&!terminal)return 0;
 NSData *bodyRaw=[bodyText dataUsingEncoding:NSUTF8StringEncoding];id body=[NSJSONSerialization JSONObjectWithData:bodyRaw options:0 error:nil];
 if(!YNXPrivateExact(body,challenge?@[@"reference",@"request"]:@[@"reference",@"request",@"completion"])||![YNXPrivateCanonical(body) isEqual:bodyRaw])return 0;
 id reference=body[@"reference"],request=body[@"request"];
 if(![reference isKindOfClass:NSString.class]||![request isKindOfClass:NSDictionary.class]||![request[@"version"] isEqual:@"2"])return 0;
 NSRegularExpression *refs=[NSRegularExpression regularExpressionWithPattern:@"^ynxpsr1_[A-Za-z0-9_-]{43}$" options:0 error:nil];
 NSTextCheckingResult *refMatch=[refs firstMatchInString:reference options:0 range:NSMakeRange(0,[reference length])];
 if(!refMatch||!NSEqualRanges(refMatch.range,NSMakeRange(0,[reference length])))return 0;
 if(terminal){
  id completion=body[@"completion"];
  if(!YNXPrivateExact(completion,@[@"challenge",@"deviceSignature"])||![completion[@"challenge"] isKindOfClass:NSDictionary.class]||![completion[@"deviceSignature"] isKindOfClass:NSString.class]||[completion[@"deviceSignature"] lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>4096)return 0;
 }
 // Original SDK must verify full original row/request/device/Source, association,
 // expiry, complete-once and same-state terminal ACK; syntax is not authority.
 return 65536;
}
