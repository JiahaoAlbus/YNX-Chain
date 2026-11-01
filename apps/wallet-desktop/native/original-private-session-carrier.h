#pragma once
#import <Foundation/Foundation.h>

// Purpose-specific transport bounds only; never a Source/Native/crypto grant.
// The original protected Node decoder must still validate N1/index0/empty paths
// using the sole provider codec, then both signatures and trusted current source.
static NSData *YNXPrivateCanonical(id value) {
 return [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
}
static BOOL YNXPrivateExact(id value,NSArray *keys) {
 return [value isKindOfClass:NSDictionary.class] && [[NSSet setWithArray:[value allKeys]] isEqual:[NSSet setWithArray:keys]];
}
static NSUInteger YNXOriginalPrivateCarrierBudget(NSDictionary *input,NSData *raw) {
 if(![input isKindOfClass:NSDictionary.class]||!raw||raw.length>262144) return 0;
 BOOL pq=input[@"carrierVersion"]!=nil;
 NSArray *base=@[@"requestId",@"operation",@"phase",@"body",@"proofHeader"];
 if(!YNXPrivateExact(input,pq?[base arrayByAddingObject:@"carrierVersion"]:base))return 0;
 if(![input[@"requestId"] isKindOfClass:NSString.class]||![input[@"operation"] isKindOfClass:NSString.class]||![input[@"phase"] isKindOfClass:NSString.class])return 0;
 NSRegularExpression *pattern=[NSRegularExpression regularExpressionWithPattern:@"^req_[A-Za-z0-9_-]{12,80}$" options:0 error:nil];
 NSString *requestID=input[@"requestId"];
 NSTextCheckingResult *match=[pattern firstMatchInString:requestID options:0 range:NSMakeRange(0,requestID.length)];if(!match||!NSEqualRanges(match.range,NSMakeRange(0,requestID.length)))return 0;
 if(![@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"] containsObject:input[@"operation"]]||![@[@"time",@"effect"] containsObject:input[@"phase"]])return 0;
 if(![YNXPrivateCanonical(input) isEqual:raw])return 0;
 if([input[@"phase"] isEqual:@"time"])return !pq&&input[@"body"]==NSNull.null&&input[@"proofHeader"]==NSNull.null&&raw.length<=65536?65536:0;
 if(![input[@"body"] isKindOfClass:NSString.class])return 0;
 NSUInteger bodyBytes=[input[@"body"] lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
 if(!pq)return raw.length<=65536&&bodyBytes<=49152?65536:0;
 if(![input[@"carrierVersion"] isEqual:@"YNX-PRODUCT-SESSION-PRIVATE/v3"]||![input[@"phase"] isEqual:@"effect"]||![@[@"beginYNX",@"handleReturn"] containsObject:input[@"operation"]]||input[@"proofHeader"]!=NSNull.null||bodyBytes>196608)return 0;
 NSData *bodyRaw=[input[@"body"] dataUsingEncoding:NSUTF8StringEncoding];
 id body=[NSJSONSerialization JSONObjectWithData:bodyRaw options:0 error:nil];
 NSArray *bodyFields=[input[@"operation"] isEqual:@"beginYNX"]?@[@"request",@"approval"]:@[@"request",@"approval",@"completion"];
 if(!YNXPrivateExact(body,bodyFields)||![YNXPrivateCanonical(body) isEqual:bodyRaw])return 0;
 id request=body[@"request"],approval=body[@"approval"];
 if(![request isKindOfClass:NSDictionary.class]||![approval isKindOfClass:NSDictionary.class]||![request[@"version"] isEqual:@"2"]||![approval[@"version"] isEqual:@"3"])return 0;
 id authorization=approval[@"accountAuthorization"];
 if(![authorization isKindOfClass:NSDictionary.class]||![authorization[@"algorithmVersion"] isEqual:@"YNX-BATCH/v0.1"]||![approval[@"walletProof"] isKindOfClass:NSString.class])return 0;
 return 262144;
}
