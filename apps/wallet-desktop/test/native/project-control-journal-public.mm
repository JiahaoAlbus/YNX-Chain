#if !defined(YNX_CONTROL_JOURNAL_PUBLIC_TEST)
#error PUBLIC fixture must not invoke system Keychain
#endif
#import "../../native/original-project-control-journal.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <cassert>
#include <cstdio>
static NSMutableDictionary*items;static NSUInteger adds,reads;static BOOL commitUnknown,corruptRead;static OSStatus addStatus,readStatus;
static NSString*key(NSDictionary*q){
 assert([q[(__bridge id)kSecAttrService]isEqual:@"com.ynxweb4.wallet.ide-project-control-decision.v1"]);
 assert([q[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]);assert([q[(__bridge id)kSecUseDataProtectionKeychain]isEqual:@YES]);
 LAContext*c=q[(__bridge id)kSecUseAuthenticationContext];assert(c.interactionNotAllowed);
 NSString*k=q[(__bridge id)kSecAttrAccount];assert(k.length==64);return k;
}
extern "C" OSStatus YNXControlJournalPublicAdd(CFDictionaryRef raw,CFTypeRef*){
 NSDictionary*q=(__bridge NSDictionary*)raw;NSString*k=key(q);adds++;
 assert([q[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]);
 if(items[k])return errSecDuplicateItem;
 if(addStatus==errSecSuccess||commitUnknown)items[k]=[q copy];return addStatus;
}
extern "C" OSStatus YNXControlJournalPublicCopy(CFDictionaryRef raw,CFTypeRef*out){
 NSDictionary*q=(__bridge NSDictionary*)raw;NSString*k=key(q);reads++;*out=nullptr;
 if(readStatus!=errSecSuccess)return readStatus;if(!items[k])return errSecItemNotFound;
 NSMutableDictionary*a=[items[k]mutableCopy];if(corruptRead)a[(__bridge id)kSecValueData]=[@"PUBLIC-corrupt" dataUsingEncoding:NSUTF8StringEncoding];
 *out=CFBridgingRetain(a);return errSecSuccess;
}
static NSData*bytes(NSString*s){return [s dataUsingEncoding:NSUTF8StringEncoding];}
int main(){@autoreleasepool{
 items=[NSMutableDictionary new];auto journal=[YNXOriginalProjectControlJournal new];NSError*e=nil;
 NSData*request=bytes(@"PUBLIC-original-principal-command-binding"),*decision=bytes(@"PUBLIC original approve decision; DATA only");
 assert([journal reserveOriginalDecision:decision forOriginalRequest:request error:&e]&&!e&&adds==1&&reads==1);
 assert(![journal reserveOriginalDecision:bytes(@"PUBLIC replacement cancel")forOriginalRequest:request error:&e]&&e.code==errSecDuplicateItem&&![e.userInfo[@"operationMayHaveCommitted"]boolValue]);
 assert([[journal copyOriginalDecisionForRequest:request error:&e]isEqual:decision]);
 NSData*second=bytes(@"PUBLIC second request");addStatus=errSecInteractionNotAllowed;commitUnknown=YES;
 assert(![journal reserveOriginalDecision:decision forOriginalRequest:second error:&e]&&[e.userInfo[@"operationMayHaveCommitted"]boolValue]);
 addStatus=errSecSuccess;commitUnknown=NO;assert([[journal copyOriginalDecisionForRequest:second error:&e]isEqual:decision]);
 assert(![journal reserveOriginalDecision:decision forOriginalRequest:second error:&e]&&e.code==errSecDuplicateItem);
 NSData*third=bytes(@"PUBLIC readback failure");readStatus=errSecInteractionNotAllowed;
 assert(![journal reserveOriginalDecision:decision forOriginalRequest:third error:&e]&&[e.userInfo[@"operationMayHaveCommitted"]boolValue]&&e.userInfo[NSUnderlyingErrorKey]);
 readStatus=errSecSuccess;assert([[journal copyOriginalDecisionForRequest:third error:&e]isEqual:decision]);
 corruptRead=YES;assert(![journal reserveOriginalDecision:decision forOriginalRequest:bytes(@"PUBLIC mismatch")error:&e]&&[e.userInfo[@"operationMayHaveCommitted"]boolValue]);corruptRead=NO;
 NSUInteger before=adds;assert(![journal reserveOriginalDecision:[NSData data]forOriginalRequest:request error:&e]&&adds==before);
 assert(![journal reserveOriginalDecision:decision forOriginalRequest:[NSMutableData dataWithLength:65537]error:&e]&&adds==before);
 printf("{\"cases\":10,\"systemKeychainCalls\":0,\"SourceQualified\":false,\"signing\":false}\n");
}return 0;}
