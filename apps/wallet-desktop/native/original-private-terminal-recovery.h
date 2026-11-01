#pragma once
#include "original-private-reference-carrier.h"
#include <CommonCrypto/CommonDigest.h>
// Pure data validation only. Called by the actual Native owner after Source,
// inode/permission/dirfd/current checks, never authenticates caller dictionaries.
static NSString *const YNXPrivateTerminalRecoveryContract=@"c33235dd5bc86950af188792aa8169700b2723eb76341f0b06ecc2c6f799f6ad";
static NSString *YNXTerminalSHA(NSData *data) {
 if(!data)return nil;unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,(CC_LONG)data.length,digest);
 NSMutableString *s=[NSMutableString string];for(unsigned char c:digest)[s appendFormat:@"%02x",c];return s;
}
static BOOL YNXTerminalHex(id value){
 if(![value isKindOfClass:NSString.class]||[value length]!=64)return NO;
 return [value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location==NSNotFound;
}
static NSDictionary *YNXTerminalObject(NSData *raw,NSUInteger limit){
 if(!raw||!raw.length||raw.length>limit)return nil;id value=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
 return [value isKindOfClass:NSDictionary.class]&&[YNXPrivateCanonical(value) isEqual:raw]?value:nil;
}
static NSString *YNXOriginalPrivateSnapshotDigest(NSDictionary *state){
 if(!YNXPrivateExact(state,@[@"schemaVersion",@"snapshot",@"snapshotDigest"])||![state[@"schemaVersion"] isEqual:@1]||CFGetTypeID((__bridge CFTypeRef)state[@"schemaVersion"])==CFBooleanGetTypeID()||![state[@"snapshot"] isKindOfClass:NSDictionary.class]||!YNXTerminalHex(state[@"snapshotDigest"])||![state[@"snapshotDigest"] isEqual:YNXTerminalSHA(YNXPrivateCanonical(state[@"snapshot"]))])return nil;
 return state[@"snapshotDigest"];
}
static BOOL YNXOriginalPrivateTerminalRecoveryRegistered(NSDictionary *selection){
 if(!YNXOriginalPrivateReferenceRegistered(selection))return NO;
 NSDictionary *r=selection[@"privateTerminalRecovery"],*expected=selection[@"expectedRequest"];
 if(!YNXPrivateExact(r,@[@"version",@"contractDigest",@"recordFormat",@"consumerManifestDigest",@"gatewayManifestDigest",@"registryDigest",@"currentReference"])||
 ![r[@"version"] isEqual:@"YNX-PRIVATE-TERMINAL-RECOVERY/v1"]||
 ![r[@"contractDigest"] isEqual:YNXPrivateTerminalRecoveryContract]||![r[@"recordFormat"] isEqual:@"YNX-ORIGINAL-PRIVATE-TERMINAL/v3"])return NO;
 for(NSString *key in @[@"consumerManifestDigest",@"gatewayManifestDigest",@"registryDigest",@"currentReference"])if(!YNXTerminalHex(r[key])||![r[key] isEqual:expected[key]])return NO;
 return YES;
}
static NSUInteger YNXOriginalRecoverablePrivateCarrierBudget(NSDictionary *input,NSData *raw,NSDictionary *selection){
 NSUInteger budget=YNXOriginalQualifiedPrivateCarrierBudget(input,raw,selection);
 if(budget&&[input[@"carrierVersion"] isEqual:@"YNX-PRODUCT-SESSION-PRIVATE/v4"]&&[input[@"referenceAction"] isEqual:@"complete"]&&!YNXOriginalPrivateTerminalRecoveryRegistered(selection))return 0;
 return budget;
}
static NSDictionary *YNXOriginalTerminalCustodyResult(NSData *enteredRaw,NSData *terminalRaw,NSData *stateRaw,NSData *inputRaw,NSData *associationRaw,NSData *lateResponseRaw,NSString **error){
 auto reject=[&](NSString *code)->NSDictionary *{if(error)*error=code;return nil;};
 NSDictionary *input=YNXTerminalObject(inputRaw,262144),*association=YNXTerminalObject(associationRaw,8192),*entered=YNXTerminalObject(enteredRaw,8192),*terminal=YNXTerminalObject(terminalRaw,8192),*state=YNXTerminalObject(stateRaw,32*1024*1024);
 if(!input||!association||!entered||!terminal||!state)return reject(@"AUTH_IDENTITY_TERMINAL_ORIGINAL_INVALID");
 if(!YNXPrivateExact(input,@[@"requestId",@"operation",@"phase",@"body",@"proofHeader",@"carrierVersion",@"referenceAction"])||
 ![input[@"carrierVersion"] isEqual:@"YNX-PRODUCT-SESSION-PRIVATE/v4"]||![input[@"operation"] isEqual:@"handleReturn"]||![input[@"phase"] isEqual:@"effect"]||![input[@"referenceAction"] isEqual:@"complete"]||input[@"proofHeader"]!=NSNull.null)return reject(@"AUTH_IDENTITY_TERMINAL_INPUT_MISMATCH");
 if(!YNXPrivateExact(association,@[@"account",@"clientId",@"productId",@"platform",@"applicationId",@"deviceId"])||
 !YNXPrivateExact(entered,@[@"version",@"kind",@"requestDigest",@"associationDigest",@"operation",@"phase",@"requestId",@"stateBeforeDigest"])||
 ![entered[@"version"] isEqual:@1]||CFGetTypeID((__bridge CFTypeRef)entered[@"version"])==CFBooleanGetTypeID()||![entered[@"kind"] isEqual:@"entered"]||
 ![entered[@"requestDigest"] isEqual:YNXTerminalSHA(inputRaw)]||![entered[@"associationDigest"] isEqual:YNXTerminalSHA(associationRaw)]||!YNXTerminalHex(entered[@"stateBeforeDigest"]))return reject(@"AUTH_IDENTITY_TERMINAL_ENTERED_MISMATCH");
 for(NSString *key in association)if(![association[key] isKindOfClass:NSString.class]||![association[key] length]||[association[key] lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>512)return reject(@"AUTH_IDENTITY_TERMINAL_ENTERED_MISMATCH");
 for(NSString *key in @[@"operation",@"phase",@"requestId"])if(![entered[key] isEqual:input[key]])return reject(@"AUTH_IDENTITY_TERMINAL_ENTERED_MISMATCH");
 BOOL v3=[terminal[@"v"] isEqual:@3]&&CFGetTypeID((__bridge CFTypeRef)terminal[@"v"])!=CFBooleanGetTypeID();
 BOOL v2=[terminal[@"v"] isEqual:@2]&&CFGetTypeID((__bridge CFTypeRef)terminal[@"v"])!=CFBooleanGetTypeID();
 NSString *e=nil,*q=nil,*a=nil,*o=nil,*p=nil,*requestID=nil,*r=nil,*b=nil,*s=nil;NSData *responseRaw=lateResponseRaw;
 if(v3){
  if(!YNXPrivateExact(terminal,@[@"v",@"k",@"e",@"s",@"x"])||![terminal[@"k"] isEqual:@"terminal"]||![terminal[@"x"] isKindOfClass:NSString.class])return reject(@"AUTH_IDENTITY_TERMINAL_RECORD_INVALID");
  e=terminal[@"e"];s=terminal[@"s"];
  // Derive only AFTER exact entered/input/association verification above and
  // before final entered hash equality below. No completed DTO reconstruction.
  q=entered[@"requestDigest"];a=entered[@"associationDigest"];o=entered[@"operation"];p=entered[@"phase"];requestID=entered[@"requestId"];b=entered[@"stateBeforeDigest"];
  NSData *stored=[terminal[@"x"] dataUsingEncoding:NSUTF8StringEncoding];if(responseRaw&&![responseRaw isEqual:stored])return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_SUBSTITUTED");responseRaw=stored;r=YNXTerminalSHA(stored);
 }else if(v2){
  if(!YNXPrivateExact(terminal,@[@"v",@"k",@"e",@"q",@"a",@"o",@"p",@"id",@"r",@"b",@"s",@"x"])||![terminal[@"k"] isEqual:@"terminal"]||![terminal[@"x"] isKindOfClass:NSString.class])return reject(@"AUTH_IDENTITY_TERMINAL_RECORD_INVALID");
  e=terminal[@"e"];q=terminal[@"q"];a=terminal[@"a"];o=terminal[@"o"];p=terminal[@"p"];requestID=terminal[@"id"];r=terminal[@"r"];b=terminal[@"b"];s=terminal[@"s"];
  NSData *stored=[terminal[@"x"] dataUsingEncoding:NSUTF8StringEncoding];if(responseRaw&&![responseRaw isEqual:stored])return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_SUBSTITUTED");responseRaw=stored;
 }else{
  if(!YNXPrivateExact(terminal,@[@"version",@"kind",@"enteredDigest",@"requestDigest",@"associationDigest",@"operation",@"phase",@"requestId",@"responseDigest",@"stateBeforeDigest",@"stateAfterDigest"])||
 ![terminal[@"version"] isEqual:@1]||CFGetTypeID((__bridge CFTypeRef)terminal[@"version"])==CFBooleanGetTypeID()||![terminal[@"kind"] isEqual:@"terminal"])return reject(@"AUTH_IDENTITY_TERMINAL_RECORD_INVALID");
  e=terminal[@"enteredDigest"];q=terminal[@"requestDigest"];a=terminal[@"associationDigest"];o=terminal[@"operation"];p=terminal[@"phase"];requestID=terminal[@"requestId"];r=terminal[@"responseDigest"];b=terminal[@"stateBeforeDigest"];s=terminal[@"stateAfterDigest"];
  if(!responseRaw)return reject(@"AUTH_IDENTITY_ORIGINAL_TERMINAL_RESPONSE_UNAVAILABLE");
 }
 if(![e isEqual:YNXTerminalSHA(enteredRaw)]||![q isEqual:entered[@"requestDigest"]]||![a isEqual:entered[@"associationDigest"]]||![o isEqual:input[@"operation"]]||![p isEqual:input[@"phase"]]||![requestID isEqual:input[@"requestId"]]||![b isEqual:entered[@"stateBeforeDigest"]]||!YNXTerminalHex(r)||!YNXTerminalHex(s))return reject(@"AUTH_IDENTITY_TERMINAL_BINDING_MISMATCH");
 // Node's persisted identity digest is snapshotDigest, not hash(envelope file).
 if(![s isEqual:YNXOriginalPrivateSnapshotDigest(state)])return reject(@"AUTH_IDENTITY_TERMINAL_STATE_MISMATCH");
 NSDictionary *response=YNXTerminalObject(responseRaw,65536);
 if(!YNXPrivateExact(response,@[@"status",@"headers",@"body"])||![r isEqual:YNXTerminalSHA(responseRaw)]||![response[@"status"] isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)response[@"status"])==CFBooleanGetTypeID()||[response[@"status"] doubleValue]!=[response[@"status"] integerValue]||[response[@"status"] integerValue]<200||[response[@"status"] integerValue]>599||![response[@"body"] isKindOfClass:NSString.class])return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 NSDictionary *headers=response[@"headers"];if(![headers isKindOfClass:NSDictionary.class]||headers.count>32)return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 for(id key in headers)if(![key isKindOfClass:NSString.class]||![headers[key] isKindOfClass:NSString.class]||[headers[key] lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>16384)return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 NSString *type=headers[@"content-type"],*cache=headers[@"cache-control"];
 if(![type isKindOfClass:NSString.class]||![@[@"application/json",@"application/json; charset=utf-8"] containsObject:type]||![cache isKindOfClass:NSString.class]||![cache isEqual:@"no-store"]||![headers[@"x-request-id"] isEqual:requestID])return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 NSData *bodyRaw=[response[@"body"] dataUsingEncoding:NSUTF8StringEncoding];if(headers[@"content-length"]&&![headers[@"content-length"] isEqual:[NSString stringWithFormat:@"%lu",(unsigned long)bodyRaw.length]])return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 NSDictionary *payload=YNXTerminalObject(bodyRaw,65536);BOOL success=[response[@"status"] integerValue]<300;
 if(!YNXPrivateExact(payload,success?@[@"ok",@"requestId",@"result",@"schemaVersion"]:@[@"ok",@"requestId",@"error",@"schemaVersion"])||![payload[@"ok"] isEqual:@(success)]||CFGetTypeID((__bridge CFTypeRef)payload[@"ok"])!=CFBooleanGetTypeID()||![payload[@"requestId"] isEqual:requestID]||![payload[@"schemaVersion"] isEqual:@2]||CFGetTypeID((__bridge CFTypeRef)payload[@"schemaVersion"])==CFBooleanGetTypeID())return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 if(success){
  NSDictionary *session=payload[@"result"];if(![session isKindOfClass:NSDictionary.class])return reject(@"AUTH_IDENTITY_TERMINAL_SESSION_MISMATCH");
  for(NSString *key in association)if(![session[key] isEqual:association[key]])return reject(@"AUTH_IDENTITY_TERMINAL_SESSION_MISMATCH");
  NSDictionary *authority=state[@"snapshot"][@"authority"];if(![authority isKindOfClass:NSDictionary.class])return reject(@"AUTH_IDENTITY_TERMINAL_SESSION_MISMATCH");
  NSArray *sessions=authority[@"sessions"];if(![sessions isKindOfClass:NSArray.class]||![sessions containsObject:session])return reject(@"AUTH_IDENTITY_TERMINAL_SESSION_MISMATCH");
 }else if(!YNXPrivateExact(payload[@"error"],@[@"code",@"message"])||![payload[@"error"][@"code"] isKindOfClass:NSString.class]||![payload[@"error"][@"message"] isKindOfClass:NSString.class])return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 NSString *text=[[NSString alloc]initWithData:responseRaw encoding:NSUTF8StringEncoding];if(!text)return reject(@"AUTH_IDENTITY_TERMINAL_RESPONSE_INVALID");
 return @{@"responseRaw":text,@"responseDigest":r,@"requestDigest":q,@"associationDigest":a,@"stateBeforeDigest":b,@"stateAfterDigest":s,@"stateFileDigest":YNXTerminalSHA(stateRaw),@"enteredDigest":e,@"recordVersion":v3?@3:(v2?@2:@1),@"success":@(success)};
}
