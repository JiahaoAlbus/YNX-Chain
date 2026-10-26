#pragma once
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/file.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <unistd.h>
#import "ynx-project-service-observation.h"
#import "ynx-service-read-scope.h"

// Native capabilities only. This is not an authentication authority: the
// canonical SDK still verifies Wallet approvals and the Gateway's responses.
// No private key, arbitrary signing method, endpoint or project client exists
// in this interface. The caller must obtain explicit native user consent.
static NSString *const YNXDeviceStorageBase=@"ynx.product-session.v2:developer:macos:com.ynxweb4.developer.testnetpreview";
static NSString *YNXDeviceB64(NSData *data) {return [[[[data base64EncodedStringWithOptions:0] stringByReplacingOccurrencesOfString:@"+" withString:@"-"] stringByReplacingOccurrencesOfString:@"/" withString:@"_"] stringByReplacingOccurrencesOfString:@"=" withString:@""];}
static BOOL YNXDevicePattern(id value,NSString *pattern) {return [value isKindOfClass:NSString.class]&&[value rangeOfString:pattern options:NSRegularExpressionSearch].location!=NSNotFound;}
static NSData *YNXDeviceDecode(id value,NSUInteger limit) {
    if(!YNXDevicePattern(value,@"^[A-Za-z0-9_-]+$")||[value length]>limit*2)return nil;
    NSString *s=[value stringByReplacingOccurrencesOfString:@"-" withString:@"+"];s=[s stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
    s=[s stringByPaddingToLength:((s.length+3)/4)*4 withString:@"=" startingAtIndex:0];
    NSData *d=[[NSData alloc]initWithBase64EncodedString:s options:0];return d.length<=limit&&[YNXDeviceB64(d) isEqual:value]?d:nil;
}
static NSString *YNXDeviceCanonical(id value) {
    if([value isKindOfClass:NSDictionary.class]){NSMutableArray *parts=[NSMutableArray new];for(NSString *key in [[value allKeys] sortedArrayUsingSelector:@selector(compare:)]){NSString *k=YNXDeviceCanonical(key),*v=YNXDeviceCanonical(value[key]);if(!k||!v)return nil;[parts addObject:[NSString stringWithFormat:@"%@:%@",k,v]];}return [NSString stringWithFormat:@"{%@}",[parts componentsJoinedByString:@","]];}
    if([value isKindOfClass:NSArray.class]){NSMutableArray *parts=[NSMutableArray new];for(id child in value){NSString *s=YNXDeviceCanonical(child);if(!s)return nil;[parts addObject:s];}return [NSString stringWithFormat:@"[%@]",[parts componentsJoinedByString:@","]];}
    if([value isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)value)!=CFBooleanGetTypeID()&&[value isEqual:@1])return @"1";
    if(value!=NSNull.null&&![value isKindOfClass:NSString.class])return nil;
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed|NSJSONWritingWithoutEscapingSlashes error:nil];return data?[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]:nil;
}
static NSString *YNXDeviceHash(NSString *text) {NSData *data=[text dataUsingEncoding:NSUTF8StringEncoding];if(!data)return nil;unsigned char bytes[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,(CC_LONG)data.length,bytes);NSMutableString *hash=[NSMutableString new];for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++)[hash appendFormat:@"%02x",bytes[i]];return hash;}
static NSString *YNXDeviceDigest(NSString *domain,id object) {NSString *json=YNXDeviceCanonical(object);return json?YNXDeviceHash([NSString stringWithFormat:@"%@\n%@",domain,json]):nil;}
static BOOL YNXDeviceFields(NSDictionary *value,NSString *fields) {return [value isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:value.allKeys] isEqual:[NSSet setWithArray:[fields componentsSeparatedByString:@" "]]];}
static NSDate *YNXDeviceDate(id text) {
    if(!YNXDevicePattern(text,@"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"))return nil;
    NSISO8601DateFormatter *f=[NSISO8601DateFormatter new];f.formatOptions=NSISO8601DateFormatWithInternetDateTime|NSISO8601DateFormatWithFractionalSeconds;NSDate *d=[f dateFromString:text];return d&&[[f stringFromDate:d] isEqual:text]?d:nil;
}
static BOOL YNXDeviceLifetime(NSDictionary *value,NSTimeInterval maximum) {NSDate *i=YNXDeviceDate(value[@"issuedAt"]),*e=YNXDeviceDate(value[@"expiresAt"]);NSTimeInterval now=NSDate.date.timeIntervalSince1970;return i&&e&&i.timeIntervalSince1970<=now+30&&e.timeIntervalSince1970>now&&[e timeIntervalSinceDate:i]>0&&[e timeIntervalSinceDate:i]<=maximum;}
static BOOL YNXDeviceStorageAllowed(id key) {return [key isKindOfClass:NSString.class]&&[@[YNXDeviceStorageBase,[YNXDeviceStorageBase stringByAppendingString:@":pending"],[YNXDeviceStorageBase stringByAppendingString:@":return"]] containsObject:key];}

static NSArray *YNXAtomicKeys(void) {return @[YNXDeviceStorageBase,[YNXDeviceStorageBase stringByAppendingString:@":pending"],[YNXDeviceStorageBase stringByAppendingString:@":return"],[YNXDeviceStorageBase stringByAppendingString:@":completion"],[YNXDeviceStorageBase stringByAppendingString:@":revoke"],[YNXDeviceStorageBase stringByAppendingString:@":revoke-completions"]];}
static id YNXAtomicJSON(NSString *s) {return [s isKindOfClass:NSString.class]?[NSJSONSerialization JSONObjectWithData:[s dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingFragmentsAllowed error:nil]:nil;}
static BOOL YNXAtomicASCII(NSString *s,NSUInteger max) {return [s isKindOfClass:NSString.class]&&s.length<=max&&[s canBeConvertedToEncoding:NSASCIIStringEncoding];}
static BOOL YNXAtomicKey(id key) {return [YNXAtomicKeys() containsObject:key]||YNXDevicePattern(key,@"^native-session-anchor:[0-9a-f]{64}$")||YNXDevicePattern(key,@"^native-consumer-journal:[A-Za-z0-9_-]{32,64}$");}
static NSString *const YNXAtomicFormat=@"ynx-developer-protected-state/v1";
@interface YNXWalletDeviceBridge : NSObject
@property(nonatomic,readonly) NSString *publicKey;
@property(nonatomic,readonly) NSString *instanceID;
- (instancetype)initWithTag:(NSString *)tag storageService:(NSString *)service lockDirectory:(NSString *)directory;
- (NSDictionary *)beginUserOperation:(NSError **)error;
- (NSString *)saveRevocationIntent:(NSString *)key rawIntent:(NSString *)raw error:(NSError **)error;
- (NSString *)finishRevocationIntentWithCompletion:(NSString *)key expectedRawIntent:(NSString *)raw receiptRaw:(NSString *)receipt error:(NSError **)error;
- (NSString *)getRevocationCompletions:(NSString *)key error:(NSError **)error;
- (NSString *)getRevocationCompletion:(NSString *)key intentId:(NSString *)intentID error:(NSError **)error;
- (BOOL)acknowledgeRevocationCompletion:(NSString *)key expectedReceiptRaw:(NSString *)raw error:(NSError **)error;
- (NSString *)consumerJournalPersist:(NSString *)raw error:(NSError **)error;
- (NSString *)consumerJournalRead:(NSString *)intentID error:(NSError **)error;
- (void)endUserOperation;
- (BOOL)approveServiceRead:(id<YNXProjectServiceObservationReader>)observer requestID:(NSString *)requestID error:(NSError **)error;
- (BOOL)endServiceRead:(NSError **)error;
- (BOOL)finishServiceReadRequest:(NSString *)requestID error:(NSError **)error;
- (id)performServiceReadPort:(NSDictionary *)input requestID:(NSString *)requestID error:(NSError **)error;
- (BOOL)prepareAuthorizationURL:(NSString *)url error:(NSError **)error;
- (BOOL)acceptCallbackURL:(NSString *)url;
- (NSString *)routeCallback:(NSString *)url;
- (NSString *)takeRoutedCallback;
- (NSString *)sign:(NSDictionary *)input error:(NSError **)error;
- (NSString *)stored:(NSString *)key error:(NSError **)error;
- (BOOL)store:(NSString *)value key:(NSString *)key error:(NSError **)error;
- (BOOL)remove:(NSString *)key error:(NSError **)error;
@end

@implementation YNXWalletDeviceBridge {
    NSString *_tag,*_service,*_lockDirectory,*_instanceID;int _lockFD;SecKeyRef _privateKey;NSDate *_consentUntil;
    NSDictionary *_request,*_approval,*_signedChallenge;NSMutableSet *_signedNonces;
    id<YNXProjectServiceObservationReader> _serviceReadObserver;
    NSDictionary *_serviceReadSession;NSArray *_serviceReadPaths;NSString *_serviceReadRequestID;
    NSTimeInterval _serviceReadBeganMono,_serviceReadBudget;
}
- (instancetype)initWithTag:(NSString *)tag storageService:(NSString *)service lockDirectory:(NSString *)directory {if((self=[super init])){_tag=[tag copy];_service=[service copy];_lockDirectory=[directory copy];_instanceID=NSUUID.UUID.UUIDString.lowercaseString;_lockFD=-1;_signedNonces=[NSMutableSet new];}return self;}
- (NSString *)instanceID {return _instanceID;}
- (void)dealloc {if(_privateKey)CFRelease(_privateKey);if(_lockFD>=0)close(_lockFD);}
- (BOOL)fail:(NSError **)error reason:(NSString *)reason {if(error)*error=[NSError errorWithDomain:@"YNXDeveloperNativeWallet" code:1 userInfo:@{NSLocalizedDescriptionKey:reason}];return NO;}
- (BOOL)consented {return _consentUntil&&[_consentUntil timeIntervalSinceNow]>0;}
- (NSDictionary *)keyQuery {return @{(__bridge id)kSecClass:(__bridge id)kSecClassKey,(__bridge id)kSecAttrKeyType:(__bridge id)kSecAttrKeyTypeECSECPrimeRandom,(__bridge id)kSecAttrApplicationTag:[_tag dataUsingEncoding:NSUTF8StringEncoding],(__bridge id)kSecAttrKeyClass:(__bridge id)kSecAttrKeyClassPrivate};}
- (BOOL)loadKeyCreating:(BOOL)create error:(NSError **)error {
    if(_privateKey)return YES;NSMutableDictionary *query=[[self keyQuery] mutableCopy];query[(__bridge id)kSecReturnRef]=@YES;CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
    if(status==errSecSuccess){_privateKey=(SecKeyRef)result;NSDictionary *attributes=CFBridgingRelease(SecKeyCopyAttributes(_privateKey));if(![attributes[(__bridge id)kSecAttrKeySizeInBits] isEqual:@256]){CFRelease(_privateKey);_privateKey=NULL;return [self fail:error reason:@"Existing device key does not match the protected P256 contract; it was preserved."];}return YES;}
    if(status!=errSecItemNotFound||!create){[self fail:error reason:@"Native device key is unavailable; no existing key was replaced."];return NO;}
    CFErrorRef failure=NULL;_privateKey=SecKeyCreateRandomKey((__bridge CFDictionaryRef)@{(__bridge id)kSecAttrKeyType:(__bridge id)kSecAttrKeyTypeECSECPrimeRandom,(__bridge id)kSecAttrKeySizeInBits:@256,(__bridge id)kSecPrivateKeyAttrs:@{(__bridge id)kSecAttrIsPermanent:@YES,(__bridge id)kSecAttrIsExtractable:@NO,(__bridge id)kSecAttrApplicationTag:[_tag dataUsingEncoding:NSUTF8StringEncoding],(__bridge id)kSecAttrLabel:_tag,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly}},&failure);
    if(failure)CFRelease(failure);if(!_privateKey){[self fail:error reason:@"Keychain could not protect the Developer device key."];return NO;}return YES;
}
- (NSString *)publicKey {
    if(![self loadKeyCreating:NO error:nil])return nil;SecKeyRef key=SecKeyCopyPublicKey(_privateKey);CFErrorRef error=NULL;NSData *raw=CFBridgingRelease(SecKeyCopyExternalRepresentation(key,&error));CFRelease(key);if(error)CFRelease(error);if(raw.length!=65||((const unsigned char *)raw.bytes)[0]!=4)return nil;
    unsigned char prefix=2|(((const unsigned char *)raw.bytes)[64]&1);NSMutableData *compressed=[NSMutableData dataWithBytes:&prefix length:1];[compressed appendData:[raw subdataWithRange:NSMakeRange(1,32)]];return YNXDeviceB64(compressed);
}
- (BOOL)acquireStateLock:(NSError **)error {
    if(_lockFD<0){struct stat s;char *real=realpath(_lockDirectory.fileSystemRepresentation,NULL);BOOL safe=real&&[_lockDirectory isEqual:[NSString stringWithUTF8String:real]]&&lstat(_lockDirectory.fileSystemRepresentation,&s)==0&&S_ISDIR(s.st_mode)&&s.st_uid==getuid()&&(s.st_mode&0077)==0;if(real)free(real);if(!safe){[self fail:error reason:@"Private native Wallet lock directory is unavailable."];return NO;}
        int directory=open(_lockDirectory.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(directory<0){[self fail:error reason:@"Private native Wallet lock directory could not be opened."];return NO;}_lockFD=openat(directory,"native-wallet-connection.lock",O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC,0600);close(directory);
        if(_lockFD<0||fstat(_lockFD,&s)!=0||!S_ISREG(s.st_mode)||s.st_uid!=getuid()||s.st_nlink!=1||(s.st_mode&0077)!=0||flock(_lockFD,LOCK_EX|LOCK_NB)!=0){if(_lockFD>=0)close(_lockFD);_lockFD=-1;[self fail:error reason:@"Another Developer window has an active Wallet connection; continue there."];return NO;}}
    return YES;
}
- (NSDictionary *)beginUserOperation:(NSError **)error {
    if(![self acquireStateLock:error])return nil;
    if(![self loadKeyCreating:YES error:error]){[self endUserOperation];return nil;}_consentUntil=[NSDate dateWithTimeIntervalSinceNow:300];NSString *key=self.publicKey;if(!key){[self endUserOperation];[self fail:error reason:@"Native public device key could not be read."];return nil;}
    // Explicit consent may resume a previously opened native request. The
    // retained callback is still untrusted approval data for the SDK to verify.
    // A cold process never executes this path until the user confirms Connect.
    NSString *pending=[self stored:[YNXDeviceStorageBase stringByAppendingString:@":pending"] error:nil];NSDictionary *r=pending?[NSJSONSerialization JSONObjectWithData:[pending dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;
    if([self validRequest:r]){NSString *routeKey=[@"native-route:" stringByAppendingString:YNXDeviceHash([NSString stringWithFormat:@"%@\n%@",r[@"nonce"],r[@"state"]])],*raw=[self rawStored:routeKey error:nil];NSDictionary *route=raw?[NSJSONSerialization JSONObjectWithData:[raw dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;NSString *owner=route[@"owner"];
        if([owner isKindOfClass:NSString.class]&&[[NSUUID alloc]initWithUUIDString:owner]&&[YNXDeviceCanonical(route[@"request"]) isEqual:YNXDeviceCanonical(r)]){_request=[r copy];NSString *callback=[self rawStored:[@"native-return:" stringByAppendingString:owner] error:nil];if([self acceptCallbackURL:callback]) [self rawStore:callback key:[YNXDeviceStorageBase stringByAppendingString:@":return"] error:nil];[self rawStore:YNXDeviceCanonical(@{@"owner":_instanceID,@"request":r}) key:routeKey error:nil];}
    }
    return @{ @"id":@"ynx-developer-macos-device-v2",@"key":key,@"algorithm":@"p256-sha256",@"securityLevel":@"os-protected" };
}
- (void)endUserOperation {@synchronized(self){[self endServiceRead:nil];_consentUntil=nil;_request=nil;_approval=nil;_signedChallenge=nil;[_signedNonces removeAllObjects];if(_lockFD>=0){close(_lockFD);_lockFD=-1;}}}
- (BOOL)endServiceRead:(NSError **)error {
    _serviceReadSession=nil;_serviceReadPaths=nil;_serviceReadRequestID=nil;_serviceReadBudget=0;
    if(!_serviceReadObserver)return YES;
    if(![_serviceReadObserver finish:error]||(error&&*error))return NO;
    _serviceReadObserver=nil;return YES;
}
- (BOOL)finishServiceReadRequest:(NSString *)requestID error:(NSError **)error {
    if(!_serviceReadObserver&&!_serviceReadRequestID)return YES;
    if(![_serviceReadRequestID isEqual:requestID])return [self fail:error reason:@"The read request no longer owns native cleanup."];
    return [self endServiceRead:error];
}
- (BOOL)approveServiceRead:(id<YNXProjectServiceObservationReader>)observer requestID:(NSString *)requestID error:(NSError **)error {
    // Called only after the real Cocoa sheet. A renderer can supply a request
    // identifier for review, never the observer, project, endpoint or session.
    if(!observer||_serviceReadObserver)return [self fail:error reason:@"Explicit service read review or earlier cleanup is required."];
    // This fresh native read sheet is independent of the old login window.
    // Load only the existing protected device key; never create or replace it.
    if(![self loadKeyCreating:NO error:error])return NO;
    NSString *stored=[self stored:YNXDeviceStorageBase error:error];
    if(error&&*error)return NO;
    NSDictionary *session=stored?YNXAtomicJSON(stored):nil;
    if(![self validSession:session])return [self fail:error reason:@"Connect the matching protected Wallet session before reviewing a service read."];
    NSDictionary *data=[observer readCurrent:error];NSArray *paths=data?YNXServiceReadPaths(data,requestID):nil;
    if(error&&*error)return NO;
    NSString *anchor=YNXDevicePattern(session[@"sessionBinding"],@"^[0-9a-f]{64}$")?[self rawStored:[@"native-session-anchor:" stringByAppendingString:session[@"sessionBinding"]] error:error]:nil;
    if(error&&*error)return NO;
    if(![self validSession:session]||!paths||!YNXServiceReadSessionMatches(data,session)||![anchor isEqual:YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",session)])return [self fail:error reason:@"The original service and protected Wallet session do not match."];
    NSTimeInterval remaining=MIN([data[@"expiresMS"]doubleValue]/1000,YNXDeviceDate(session[@"expiresAt"]).timeIntervalSince1970)-NSDate.date.timeIntervalSince1970;
    if(remaining<=0)return [self fail:error reason:@"The original service read review expired."];
    _serviceReadObserver=observer;_serviceReadSession=[session copy];_serviceReadPaths=paths;_serviceReadRequestID=[requestID copy];
    _serviceReadBeganMono=NSProcessInfo.processInfo.systemUptime;_serviceReadBudget=MIN(remaining,60);
    return YES;
}
- (BOOL)serviceReadAllows:(NSDictionary *)proof session:(NSDictionary *)session error:(NSError **)error {
    NSTimeInterval elapsed=NSProcessInfo.processInfo.systemUptime-_serviceReadBeganMono;
    if(!_serviceReadObserver||!_serviceReadSession||!_serviceReadPaths||elapsed<0||elapsed>=_serviceReadBudget||![self validSession:session]||![session isEqual:_serviceReadSession]||![_serviceReadPaths containsObject:proof[@"path"]]||![proof[@"method"]isEqual:@"GET"]||![proof[@"bodyDigest"]isEqual:YNXDeviceHash(@"")])return NO;
    NSDictionary *data=[_serviceReadObserver readCurrent:error];
    return data&&!(error&&*error)&&YNXServiceReadSessionMatches(data,session);
}
// Private parent-control caller only. These are existing protected read ports,
// never a login/restore/write capability, even if login consent also exists.
- (id)performServiceReadPort:(NSDictionary *)input requestID:(NSString *)requestID error:(NSError **)error {
    if(![input isKindOfClass:NSDictionary.class]||![_serviceReadRequestID isEqual:requestID]||!_serviceReadPaths.count){
        [self fail:error reason:@"The exact native service read review is unavailable."];return nil;
    }
    NSString *operation=input[@"operation"];
    BOOL shape=([operation isEqual:@"context"]&&YNXDeviceFields(input,@"operation"))||
      ([operation isEqual:@"get"]&&YNXDeviceFields(input,@"operation key"))||
      ([operation isEqual:@"sign"]&&YNXDeviceFields(input,@"operation input"))||
      ([operation isEqual:@"network"]&&YNXDeviceFields(input,@"operation method url"));
    if(!shape){[self fail:error reason:@"Private read port fields are invalid."];return nil;}
    NSString *raw=[self stored:YNXDeviceStorageBase error:error];
    NSDictionary *session=raw?YNXAtomicJSON(raw):nil;
    if((error&&*error)||![session isKindOfClass:NSDictionary.class]||![self validSession:session]){if(!(error&&*error))[self fail:error reason:@"The protected read session is invalid."];return nil;}
    NSString *pendingRevoke=[self stored:[YNXDeviceStorageBase stringByAppendingString:@":revoke"] error:error];
    if((error&&*error)||pendingRevoke){if(!(error&&*error))[self fail:error reason:@"A pending sign-out blocks service reads."];return nil;}
    NSDictionary *probe=@{@"method":@"GET",@"path":_serviceReadPaths.firstObject,@"bodyDigest":YNXDeviceHash(@"")};
    NSString *anchor=[session isKindOfClass:NSDictionary.class]&&YNXDevicePattern(session[@"sessionBinding"],@"^[0-9a-f]{64}$")?[self rawStored:[@"native-session-anchor:" stringByAppendingString:session[@"sessionBinding"]] error:error]:nil;
    if((error&&*error)||![anchor isEqual:YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",session)]||![self serviceReadAllows:probe session:session error:error]){
        if(!(error&&*error))[self fail:error reason:@"The original reviewed session is no longer current."];return nil;
    }
    id value=nil;
    if([operation isEqual:@"context"]){
        NSDictionary *current=[_serviceReadObserver readCurrent:error];
        NSString *key=self.publicKey;
        if(current&&key)value=@{@"requestId":requestID,@"source":current,@"device":@{@"id":@"ynx-developer-macos-device-v2",@"key":key,@"scopes":session[@"scopes"],@"purpose":@"Read reviewed project deployment status and logs"}};
    } else if([operation isEqual:@"network"]){
        // A fresh visible review covers only the original fixed Auth clock and
        // this registered service's two GETs. No global package/egress grant.
        NSDictionary *data=[_serviceReadObserver readCurrent:error];
        if(!data||(error&&*error)){if(!(error&&*error))[self fail:error reason:@"The registered read service is no longer current."];return nil;}
        NSURLComponents *base=[NSURLComponents componentsWithString:data[@"serviceRegistration"][@"apiEndpoint"]];
        base.host=base.host.lowercaseString;base.scheme=base.scheme.lowercaseString;
        NSURLComponents *target=[input[@"url"] isKindOfClass:NSString.class]?[NSURLComponents componentsWithString:input[@"url"]]:nil;target.host=target.host.lowercaseString;target.scheme=target.scheme.lowercaseString;
        NSMutableArray *allowed=[NSMutableArray arrayWithObject:@"https://wallet-auth.ynxweb4.com/v2/product-sessions/time"];
        for(NSString *path in _serviceReadPaths){NSURLComponents *u=[base copy];u.path=path;u.query=nil;u.fragment=nil;if(u.URL.absoluteString)[allowed addObject:u.URL.absoluteString];}
        if(![input[@"method"]isEqual:@"GET"]||![allowed containsObject:target.URL.absoluteString]){
            [self fail:error reason:@"This network request is outside the exact native read review."];return nil;
        }
        value=@YES;
    } else if([operation isEqual:@"get"]){
        // The SDK48 existing-session reader needs only these two records.
        NSString *key=input[@"key"];
        if(![key isEqual:YNXDeviceStorageBase]&&![key isEqual:[YNXDeviceStorageBase stringByAppendingString:@":revoke"]]){
            [self fail:error reason:@"Private read storage key is outside the existing session."];return nil;
        }
        value=[self stored:key error:error]?:NSNull.null;
    } else {
        NSDictionary *sign=input[@"input"];
        NSData *bytes=[sign isKindOfClass:NSDictionary.class]?YNXDeviceDecode(sign[@"payload"],8192):nil;
        NSString *text=bytes?[[NSString alloc]initWithData:bytes encoding:NSUTF8StringEncoding]:nil;
        NSRange line=[text rangeOfString:@"\n"];
        NSDictionary *proof=text&&line.location!=NSNotFound?YNXAtomicJSON([text substringFromIndex:line.location+1]):nil;
        if(![sign isKindOfClass:NSDictionary.class]||![sign[@"purpose"] isEqual:@"http-proof"]||![proof isKindOfClass:NSDictionary.class]||![proof[@"method"] isEqual:@"GET"]){
            [self fail:error reason:@"Private service read signing cannot borrow login or write consent."];return nil;
        }
        value=[self sign:sign error:error];
    }
    if(error&&*error)return nil;
    NSString *after=[self stored:YNXDeviceStorageBase error:error];NSDictionary *current=after?YNXAtomicJSON(after):nil;
    NSString *revocationAfter=[self stored:[YNXDeviceStorageBase stringByAppendingString:@":revoke"] error:error];
    if((error&&*error)||revocationAfter||![after isEqual:raw]||![self serviceReadAllows:probe session:current error:error]){
        if(!(error&&*error))[self fail:error reason:@"The original session changed during the private read port call."];return nil;
    }
    return value;
}
- (BOOL)binding:(NSDictionary *)v {
    NSDictionary *fixed=@{@"version":@"2",@"productId":@"developer",@"clientId":@"ynx-developer-v1",@"applicationId":@"com.ynxweb4.developer.testnetpreview",@"bundleId":@"com.ynxweb4.developer.testnetpreview",@"packageId":NSNull.null,@"origin":@"app://macos/com.ynxweb4.developer.testnetpreview",@"callback":@"ynxdeveloper://wallet-auth/callback",@"deviceId":@"ynx-developer-macos-device-v2"};
    for(NSString *key in fixed)if(![v[key] isEqual:fixed[key]])return NO;
    return [v[@"deviceKey"] isEqual:self.publicKey];
}
- (BOOL)fullBinding:(NSDictionary *)v {return [self binding:v]&&[v[@"chainId"] isEqual:@"ynx_6423-1"]&&[v[@"platform"] isEqual:@"macos"]&&[v[@"deviceAlgorithm"] isEqual:@"p256-sha256"];}
- (BOOL)tokens:(NSDictionary *)v {return YNXDevicePattern(v[@"nonce"],@"^[A-Za-z0-9_-]{32,64}$")&&YNXDevicePattern(v[@"state"],@"^[A-Za-z0-9_-]{32,64}$");}
- (BOOL)scopes:(id)value {return [value isKindOfClass:NSArray.class]&&[value count]>0&&[value count]<=2&&[[NSSet setWithArray:value] count]==[value count]&&[[NSSet setWithArray:value] isSubsetOfSet:[NSSet setWithArray:@[@"account:read",@"developer:deploy"]]];}
- (NSDictionary *)decodeObject:(NSString *)encoded {NSData *data=YNXDeviceDecode(encoded,8192);id value=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;return [value isKindOfClass:NSDictionary.class]?value:nil;}
- (BOOL)validRequest:(NSDictionary *)r {return YNXDeviceFields(r,@"version chainId productId clientId platform applicationId bundleId packageId origin callback deviceId deviceAlgorithm deviceKey nonce state scopes purpose issuedAt expiresAt")&&[self fullBinding:r]&&[self tokens:r]&&[self scopes:r[@"scopes"]]&&[r[@"purpose"] isKindOfClass:NSString.class]&&[r[@"purpose"] length]>0&&[r[@"purpose"] length]<=180&&YNXDeviceLifetime(r,300);}
- (BOOL)prepareAuthorizationURL:(NSString *)url error:(NSError **)error {
    NSURLComponents *parts=[url isKindOfClass:NSString.class]&&url.length<=8192?[NSURLComponents componentsWithString:url]:nil;NSArray *items=parts.queryItems;
    NSDictionary *r=items.count==1&&[[(NSURLQueryItem *)items[0] name] isEqual:@"request"]?[self decodeObject:((NSURLQueryItem *)items[0]).value]:nil;
    NSString *pending=[self stored:[YNXDeviceStorageBase stringByAppendingString:@":pending"] error:error];id saved=pending?[NSJSONSerialization JSONObjectWithData:[pending dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;
    if(![self consented]||![parts.scheme isEqual:@"ynxwallet"]||![parts.host isEqual:@"authorize"]||parts.path.length||parts.fragment.length||parts.user.length||parts.password.length||parts.port||![self validRequest:r]||![YNXDeviceCanonical(saved) isEqual:YNXDeviceCanonical(r)])return [self fail:error reason:@"Wallet authorization must match an explicitly approved native device request."];
    NSString *routeKey=[@"native-route:" stringByAppendingString:YNXDeviceHash([NSString stringWithFormat:@"%@\n%@",r[@"nonce"],r[@"state"]])];
    if(![self rawStore:YNXDeviceCanonical(@{@"owner":_instanceID,@"request":r}) key:routeKey error:error])return NO;
    _request=[r copy];_approval=nil;_signedChallenge=nil;return YES;
}
- (NSString *)routeCallback:(NSString *)url {
    // LaunchServices may deliver to a different existing app instance. Only a
    // random owner identifier is notified; callback bytes stay in Keychain.
    if(![url isKindOfClass:NSString.class]||url.length>4096)return nil;NSURLComponents *p=[NSURLComponents componentsWithString:url];NSMutableDictionary *q=[NSMutableDictionary new];for(NSURLQueryItem *i in p.queryItems){if(q[i.name]||!i.value)return nil;q[i.name]=i.value;}p.query=nil;
    if(![p.URL.absoluteString isEqual:@"ynxdeveloper://wallet-auth/callback"]||!YNXDevicePattern(q[@"nonce"],@"^[A-Za-z0-9_-]{32,64}$")||!YNXDevicePattern(q[@"state"],@"^[A-Za-z0-9_-]{32,64}$")||(!YNXDeviceFields(q,@"result nonce state approval")&&!YNXDeviceFields(q,@"result nonce state reason")))return nil;
    NSString *key=[@"native-route:" stringByAppendingString:YNXDeviceHash([NSString stringWithFormat:@"%@\n%@",q[@"nonce"],q[@"state"]])],*raw=[self rawStored:key error:nil];NSDictionary *route=raw?[NSJSONSerialization JSONObjectWithData:[raw dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;
    NSDictionary *request=route[@"request"];NSString *owner=route[@"owner"];if(![owner isKindOfClass:NSString.class]||![[NSUUID alloc]initWithUUIDString:owner]||!YNXDeviceLifetime(request,300)||![request[@"nonce"] isEqual:q[@"nonce"]]||![request[@"state"] isEqual:q[@"state"]])return nil;
    if(![self rawStore:url key:[@"native-return:" stringByAppendingString:owner] error:nil])return nil;return owner;
}
- (NSString *)takeRoutedCallback {if(![self consented]||!_request)return nil;NSString *key=[@"native-return:" stringByAppendingString:_instanceID],*url=[self rawStored:key error:nil];return [self acceptCallbackURL:url]?url:nil;}
- (BOOL)acceptCallbackURL:(NSString *)url {
    if(![self consented]||!_request||![self validRequest:_request]||![url isKindOfClass:NSString.class]||url.length>4096)return NO;
    NSURLComponents *parts=[NSURLComponents componentsWithString:url];NSMutableDictionary *q=[NSMutableDictionary new];for(NSURLQueryItem *item in parts.queryItems){if(q[item.name]||!item.value)return NO;q[item.name]=item.value;}parts.query=nil;
    if(![parts.URL.absoluteString isEqual:_request[@"callback"]]||![q[@"nonce"] isEqual:_request[@"nonce"]]||![q[@"state"] isEqual:_request[@"state"]])return NO;
    if([q[@"result"] isEqual:@"rejected"]){BOOL exact=YNXDeviceFields(q,@"result nonce state reason")&&[q[@"reason"] isEqual:@"user_rejected"];if(exact){_approval=nil;_signedChallenge=nil;}return exact;}
    NSDictionary *a=[self decodeObject:q[@"approval"]];if(!YNXDeviceFields(q,@"result nonce state approval")||![q[@"result"] isEqual:@"approved"]||!YNXDeviceFields(a,@"version result requestDigest chainId productId clientId platform applicationId bundleId packageId origin callback deviceId deviceAlgorithm deviceKey nonce state account accountPublicKey scopes issuedAt expiresAt walletSignature")||![self fullBinding:a]||![a[@"result"] isEqual:@"approved"]||!YNXDeviceLifetime(a,300)||!YNXDevicePattern(a[@"account"],@"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$")||!YNXDevicePattern(a[@"requestDigest"],@"^[0-9a-f]{64}$"))return NO;
    for(NSString *f in @[@"nonce",@"state",@"scopes"])if(![a[f] isEqual:_request[f]])return NO;
    if(![a[@"requestDigest"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_REQUEST_V2",_request)])return NO;
    _approval=[a copy];return YES;
}
- (NSDictionary *)query:(NSString *)key {return @{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:_service,(__bridge id)kSecAttrAccount:key};}
- (NSString *)protectedRead:(NSString *)key error:(NSError **)error {NSMutableDictionary *q=[[self query:key] mutableCopy];q[(__bridge id)kSecReturnData]=@YES;q[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)q,&result);NSData *data=CFBridgingRelease(result);if(status==errSecItemNotFound)return nil;NSString *s=data.length<=1048576?[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]:nil;if(status!=errSecSuccess||!s)[self fail:error reason:@"Protected Wallet state is unavailable; it was preserved."];return s;}
- (BOOL)protectedReplace:(NSString *)value key:(NSString *)key error:(NSError **)error {NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>1048576)return [self fail:error reason:@"Protected state is too large."];NSDictionary *q=[self query:key];OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)q,(__bridge CFDictionaryRef)@{(__bridge id)kSecValueData:data});if(status==errSecItemNotFound){NSMutableDictionary *add=[q mutableCopy];add[(__bridge id)kSecValueData]=data;add[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;status=SecItemAdd((__bridge CFDictionaryRef)add,NULL);}return status==errSecSuccess?YES:[self fail:error reason:@"Keychain could not protect Wallet state."];}
// Format v1 deliberately replaces the original base account, not a parallel
// authority. Old clients reject its non-session shape before a base overwrite.
// Legacy suffix items are retained forensic snapshots and never read again
// once this envelope exists. Callback routing mailboxes are not session state.
- (NSString *)revocationScope {
    NSString *key=self.publicKey;if(!key)return nil;
    return YNXDeviceDigest(@"YNX_PRODUCT_SESSION_LOCAL_REVOCATION_SCOPE_V1",@{@"chainId":@"ynx_6423-1",@"productId":@"developer",@"clientId":@"ynx-developer-v1",@"platform":@"macos",@"applicationId":@"com.ynxweb4.developer.testnetpreview",@"bundleId":@"com.ynxweb4.developer.testnetpreview",@"packageId":NSNull.null,@"origin":@"app://macos/com.ynxweb4.developer.testnetpreview",@"callback":@"ynxdeveloper://wallet-auth/callback",@"deviceId":@"ynx-developer-macos-device-v2",@"deviceKey":key,@"scopes":@[@"account:read",@"developer:deploy"]});
}
- (BOOL)revocationSession:(NSDictionary *)s {
    if(!YNXDeviceFields(s,@"version sessionBinding chainId productId clientId platform applicationId bundleId packageId origin callback account deviceId deviceAlgorithm deviceKey deviceBinding nonce state scopes requestDigest approvalDigest issuedAt expiresAt")||![self fullBinding:s]||![self tokens:s]||![s[@"scopes"] isEqual:@[@"account:read",@"developer:deploy"]]||!YNXDevicePattern(s[@"account"],@"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$"))return NO;
    for(NSString *key in @[@"sessionBinding",@"deviceBinding",@"requestDigest",@"approvalDigest"])if(!YNXDevicePattern(s[key],@"^[0-9a-f]{64}$"))return NO;
    NSDate *issued=YNXDeviceDate(s[@"issuedAt"]),*expires=YNXDeviceDate(s[@"expiresAt"]);if(!issued||!expires||[expires compare:issued]!=NSOrderedDescending)return NO;
    NSMutableDictionary *b=[NSMutableDictionary new];for(NSString *key in @[@"chainId",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"deviceId",@"deviceAlgorithm",@"deviceKey"])b[key]=s[key];return [s[@"deviceBinding"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_DEVICE_V2",b)];
}
- (NSDictionary *)revocationIntent:(NSString *)raw {
    if(!YNXAtomicASCII(raw,16384))return nil;id v=YNXAtomicJSON(raw);
    if(!YNXDeviceFields(v,@"version intentId scope session")||![YNXDeviceCanonical(v[@"version"]) isEqual:@"1"]||!YNXDevicePattern(v[@"intentId"],@"^[A-Za-z0-9_-]{32,64}$")||![v[@"scope"] isEqual:[self revocationScope]]||(v[@"session"]!=NSNull.null&&![self revocationSession:v[@"session"]]))return nil;return v;
}
- (NSDictionary *)revocationReceipt:(NSString *)raw {
    if(!YNXAtomicASCII(raw,2048))return nil;id v=YNXAtomicJSON(raw);
    if(!YNXDeviceFields(v,@"version intentId scope targetDigest sessionBinding outcome")||![YNXDeviceCanonical(v) isEqual:raw]||![YNXDeviceCanonical(v[@"version"]) isEqual:@"1"]||!YNXDevicePattern(v[@"intentId"],@"^[A-Za-z0-9_-]{32,64}$")||![v[@"scope"] isEqual:[self revocationScope]]||![@[@"server-revoked",@"authority-expired",@"local-only"] containsObject:v[@"outcome"]])return nil;
    if([v[@"outcome"] isEqual:@"local-only"]){if(v[@"targetDigest"]!=NSNull.null||v[@"sessionBinding"]!=NSNull.null)return nil;}else if(!YNXDevicePattern(v[@"targetDigest"],@"^[0-9a-f]{64}$")||!YNXDevicePattern(v[@"sessionBinding"],@"^[0-9a-f]{64}$"))return nil;return v;
}
- (NSArray *)revocationHistory:(NSString *)raw {
    if(!raw)return @[];if(!YNXAtomicASCII(raw,131072))return nil;id values=YNXAtomicJSON(raw);if(![values isKindOfClass:NSArray.class]||[values count]>64||![YNXDeviceCanonical(values) isEqual:raw])return nil;
    NSMutableSet *seen=[NSMutableSet new];for(id value in values){NSDictionary *v=[self revocationReceipt:YNXDeviceCanonical(value)];if(!v||[seen containsObject:v[@"intentId"]])return nil;[seen addObject:v[@"intentId"]];}return values;
}
- (BOOL)validateAtomicRecords:(NSDictionary *)r error:(NSError **)error {
    for(NSString *key in r){NSString *raw=r[key];BOOL ok=NO;id v=YNXAtomicJSON(raw);
        if(YNXDevicePattern(key,@"^native-session-anchor:[0-9a-f]{64}$"))ok=YNXDevicePattern(raw,@"^[0-9a-f]{64}$");
        else if(YNXDevicePattern(key,@"^native-consumer-journal:[A-Za-z0-9_-]{32,64}$")){NSDictionary *receipt=[self revocationReceipt:raw];ok=receipt&&[key isEqual:[@"native-consumer-journal:" stringByAppendingString:receipt[@"intentId"]]];}
        else if([key isEqual:YNXAtomicKeys()[0]])ok=[self revocationSession:v];
        else if([key isEqual:YNXAtomicKeys()[1]])ok=YNXDeviceFields(v,@"version chainId productId clientId platform applicationId bundleId packageId origin callback deviceId deviceAlgorithm deviceKey nonce state scopes purpose issuedAt expiresAt")&&[self fullBinding:v]&&[self tokens:v]&&[self scopes:v[@"scopes"]]&&[v[@"purpose"] isKindOfClass:NSString.class]&&[v[@"purpose"] length]>0&&[v[@"purpose"] length]<=180&&YNXDeviceDate(v[@"issuedAt"])&&YNXDeviceDate(v[@"expiresAt"])&&[YNXDeviceDate(v[@"expiresAt"]) timeIntervalSinceDate:YNXDeviceDate(v[@"issuedAt"])]>0;
        else if([key isEqual:YNXAtomicKeys()[2]]){NSURLComponents *u=[NSURLComponents componentsWithString:raw];NSMutableDictionary *q=[NSMutableDictionary new];BOOL unique=YES;for(NSURLQueryItem *i in u.queryItems){if(!i.value||q[i.name]){unique=NO;break;}q[i.name]=i.value;}u.query=nil;ok=unique&&raw.length<=4096&&[u.URL.absoluteString isEqual:@"ynxdeveloper://wallet-auth/callback"]&&[self tokens:q]&&((YNXDeviceFields(q,@"result nonce state reason")&&[q[@"result"] isEqual:@"rejected"]&&[q[@"reason"] isEqual:@"user_rejected"])||(YNXDeviceFields(q,@"result nonce state approval")&&[q[@"result"] isEqual:@"approved"]&&[self fullBinding:[self decodeObject:q[@"approval"]]]));}
        else if([key isEqual:YNXAtomicKeys()[3]]){id proof=[v isKindOfClass:NSDictionary.class]?v[@"completion"]:nil;id c=[proof isKindOfClass:NSDictionary.class]?proof[@"challenge"]:nil;ok=YNXDeviceFields(v,@"request approval completion")&&YNXDeviceFields(proof,@"challenge deviceSignature")&&[v[@"request"] isKindOfClass:NSDictionary.class]&&[v[@"approval"] isKindOfClass:NSDictionary.class]&&[c isKindOfClass:NSDictionary.class]&&[self fullBinding:v[@"request"]]&&[self fullBinding:v[@"approval"]]&&[self fullBinding:c]&&YNXDeviceDecode(proof[@"deviceSignature"],128)!=nil;
            if(ok){for(NSString *field in @[@"nonce",@"state",@"scopes"])ok=ok&&[c[field] isEqual:v[@"request"][field]]&&[c[field] isEqual:v[@"approval"][field]];
                ok=ok&&[c[@"account"] isEqual:v[@"approval"][@"account"]]&&[c[@"requestDigest"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_REQUEST_V2",v[@"request"])]&&[c[@"approvalDigest"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_APPROVAL_V2",v[@"approval"])];
                if(ok&&[self loadKeyCreating:NO error:error]){SecKeyRef pub=SecKeyCopyPublicKey(_privateKey);NSData *signature=YNXDeviceDecode(proof[@"deviceSignature"],128),*bytes=[[NSString stringWithFormat:@"YNX_PRODUCT_SESSION_CHALLENGE_V2\n%@",YNXDeviceCanonical(c)] dataUsingEncoding:NSUTF8StringEncoding];ok=pub&&SecKeyVerifySignature(pub,kSecKeyAlgorithmECDSASignatureMessageX962SHA256,(__bridge CFDataRef)bytes,(__bridge CFDataRef)signature,NULL);if(pub)CFRelease(pub);}else ok=NO;
            }
        }
        else if([key isEqual:YNXAtomicKeys()[4]])ok=[self revocationIntent:raw]!=nil&&[YNXDeviceCanonical(v) isEqual:raw];
        else if([key isEqual:YNXAtomicKeys()[5]])ok=[self revocationHistory:raw]!=nil;
        if(![raw isKindOfClass:NSString.class]||!ok||(![key isEqual:YNXAtomicKeys()[5]]&&[raw lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>32768))return [self fail:error reason:@"Protected namespace contains corrupt or foreign data; preserved without migration."];
    }return YES;
}
- (NSMutableDictionary *)atomicRecords:(NSError **)error {
    NSError *failure=nil;NSString *base=[self protectedRead:YNXDeviceStorageBase error:&failure];if(failure){if(error)*error=failure;return nil;}
    id object=YNXAtomicJSON(base);
    if([object isKindOfClass:NSDictionary.class]&&object[@"format"]){
        if(!YNXDeviceFields(object,@"format migration records")||![object[@"format"] isEqual:YNXAtomicFormat]||![object[@"migration"] isEqual:@"legacy-v2-snapshot-v1"]||![object[@"records"] isKindOfClass:NSDictionary.class]||![YNXDeviceCanonical(object) isEqual:base]){[self fail:error reason:@"Protected format is corrupt or unsupported; preserved."];return nil;}
        NSMutableDictionary *records=[object[@"records"] mutableCopy];
        for(id key in records)if(!YNXAtomicKey(key)||![records[key] isKindOfClass:NSString.class]||[records[key] length]>131072){[self fail:error reason:@"Protected records are invalid; preserved."];return nil;}
        if(![self validateAtomicRecords:records error:error])return nil;return records;
    }
    if(base&&![self revocationSession:object]){[self fail:error reason:@"Legacy base is foreign or corrupt; migration refused."];return nil;}
    NSMutableDictionary *records=[NSMutableDictionary new];if(base)records[YNXDeviceStorageBase]=base;
    for(NSString *key in YNXAtomicKeys())if(![key isEqual:YNXDeviceStorageBase]){NSString *raw=[self protectedRead:key error:&failure];if(failure){if(error)*error=failure;return nil;}if(raw)records[key]=raw;}
    if(base){NSString *anchorKey=[@"native-session-anchor:" stringByAppendingString:object[@"sessionBinding"]];NSString *anchor=[self protectedRead:anchorKey error:&failure];if(failure){if(error)*error=failure;return nil;}if(anchor)records[anchorKey]=anchor;}
    if(![self validateAtomicRecords:records error:error])return nil;return records;
}
- (id)atomicOperation:(id (^)(NSMutableDictionary *,NSError **))operation error:(NSError **)error {
    @synchronized(self){BOOL temporary=_lockFD<0;if(![self acquireStateLock:error])return nil;
        @try{NSError *failure=nil;NSMutableDictionary *records=[self atomicRecords:&failure];if(!records){if(error)*error=failure;return nil;}
            NSString *before=YNXDeviceCanonical(records);id result=operation(records,&failure);if(failure){if(error)*error=failure;return nil;}
            if(![before isEqual:YNXDeviceCanonical(records)]){
                if(![self validateAtomicRecords:records error:error])return nil;
                NSString *encoded=YNXDeviceCanonical(@{@"format":YNXAtomicFormat,@"migration":@"legacy-v2-snapshot-v1",@"records":records});
                if(!encoded||[encoded lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>1048576){[self fail:error reason:@"Protected state capacity exceeded; preserved."];return nil;}
                if(![self protectedReplace:encoded key:YNXDeviceStorageBase error:&failure]){[self fail:error reason:@"UNKNOWN: protected commit failed; recover exact original intent/completion."];return nil;}
                NSString *readback=[self protectedRead:YNXDeviceStorageBase error:&failure];if(failure||![readback isEqual:encoded]){[self fail:error reason:@"UNKNOWN: protected commit readback failed; no rollback or resend was attempted."];return nil;}
            }return result;
        }@finally{if(temporary&&_lockFD>=0){close(_lockFD);_lockFD=-1;}}
    }
}
- (NSString *)rawStored:(NSString *)key error:(NSError **)error {
    if(!YNXAtomicKey(key))return [self protectedRead:key error:error];
    return [self atomicOperation:^id(NSMutableDictionary *r,NSError **e){return r[key];} error:error];
}
- (BOOL)rawStore:(NSString *)value key:(NSString *)key error:(NSError **)error {
    if(!YNXAtomicKey(key))return [self protectedReplace:value key:key error:error];
    if(![self consented])return [self fail:error reason:@"Native consent is required for protected state mutation."];
    return [[self atomicOperation:^id(NSMutableDictionary *r,NSError **e){NSDictionary *pending=r[YNXAtomicKeys()[4]]?[self revocationIntent:r[YNXAtomicKeys()[4]]]:nil;
        if(pending&&[YNXAtomicKeys() containsObject:key]){
            if(![key isEqual:YNXDeviceStorageBase]){[self fail:e reason:@"REVOCATION_PENDING"];return nil;}
            id target=pending[@"session"];if(target!=NSNull.null&&![YNXDeviceCanonical(target) isEqual:value]){[self fail:e reason:@"REVOCATION_PENDING"];return nil;}
            if(target==NSNull.null){NSMutableDictionary *upgraded=[pending mutableCopy];upgraded[@"session"]=YNXAtomicJSON(value);r[YNXAtomicKeys()[4]]=YNXDeviceCanonical(upgraded);}
        }
        r[key]=value;return @YES;} error:error] boolValue];
}
- (BOOL)removeAtomicKey:(NSString *)key error:(NSError **)error {return [[self atomicOperation:^id(NSMutableDictionary *r,NSError **e){[r removeObjectForKey:key];return @YES;} error:error] boolValue];}
- (NSString *)saveRevocationIntent:(NSString *)key rawIntent:(NSString *)raw error:(NSError **)error {
    NSDictionary *incoming=[self revocationIntent:raw];if(![key isEqual:YNXAtomicKeys()[4]]||![self consented]||!incoming){[self fail:error reason:@"Invalid or unapproved bound revocation intent."];return nil;}
    return [self atomicOperation:^id(NSMutableDictionary *r,NSError **e){
        NSDictionary *old=r[key]?[self revocationIntent:r[key]]:nil;
        NSDictionary *selected=old?:incoming;
        if(old&&old[@"session"]==NSNull.null&&incoming[@"session"]!=NSNull.null&&[old[@"intentId"] isEqual:incoming[@"intentId"]])selected=incoming;
        if(selected[@"session"]==NSNull.null&&r[YNXDeviceStorageBase]){NSMutableDictionary *bound=[selected mutableCopy];bound[@"session"]=YNXAtomicJSON(r[YNXDeviceStorageBase]);selected=bound;}
        NSString *canonical=YNXDeviceCanonical(selected);r[key]=canonical;return canonical;
    } error:error];
}
- (NSString *)finishRevocationIntentWithCompletion:(NSString *)key expectedRawIntent:(NSString *)raw receiptRaw:(NSString *)receipt error:(NSError **)error {
    NSDictionary *intent=[self revocationIntent:raw],*v=[self revocationReceipt:receipt];id target=intent[@"session"];
    if(![key isEqual:YNXAtomicKeys()[4]]||![self consented]||!intent||![YNXDeviceCanonical(intent) isEqual:raw]||!v||![intent[@"intentId"] isEqual:v[@"intentId"]]||![intent[@"scope"] isEqual:v[@"scope"]]||(target==NSNull.null?(![v[@"outcome"] isEqual:@"local-only"]):([v[@"outcome"] isEqual:@"local-only"]||![v[@"targetDigest"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_REVOKED_TARGET_V1",target)]||![v[@"sessionBinding"] isEqual:target[@"sessionBinding"]]))){[self fail:error reason:@"Completion does not match the exact bound intent target."];return nil;}
    return [self atomicOperation:^id(NSMutableDictionary *r,NSError **e){NSArray *history=[self revocationHistory:r[YNXAtomicKeys()[5]]];if(!history){[self fail:e reason:@"Corrupt completion history; preserved."];return nil;}
        for(NSDictionary *existing in history)if([existing[@"intentId"] isEqual:v[@"intentId"]]){if(![YNXDeviceCanonical(existing) isEqual:receipt]){[self fail:e reason:@"REVOCATION_CHANGED: completion differs."];return nil;}return receipt;}
        if(![r[key] isEqual:raw]){[self fail:e reason:@"REVOCATION_CHANGED: pending intent differs."];return nil;}if(history.count==64){[self fail:e reason:@"REVOCATION_COMPLETION_FULL"];return nil;}
        NSMutableArray *next=[history mutableCopy];[next addObject:v];NSString *historyRaw=YNXDeviceCanonical(next);if(historyRaw.length>131072){[self fail:e reason:@"Completion history capacity exceeded."];return nil;}
        NSString *current=r[YNXDeviceStorageBase];BOOL exact=target!=NSNull.null&&[YNXDeviceCanonical(YNXAtomicJSON(current)) isEqual:YNXDeviceCanonical(target)];
        if(exact)[r removeObjectForKey:YNXDeviceStorageBase];
        if(target!=NSNull.null){NSString *anchorKey=[@"native-session-anchor:" stringByAppendingString:target[@"sessionBinding"]];if([r[anchorKey] isEqual:YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",target)])[r removeObjectForKey:anchorKey];}
        // c5 contract: pending revocation prevents new requests in rawStore.
        // A different current base belongs to a newer session; preserve all of it.
        if(!current||exact)for(NSUInteger n=1;n<=3;n++)[r removeObjectForKey:YNXAtomicKeys()[n]];
        [r removeObjectForKey:key];r[YNXAtomicKeys()[5]]=historyRaw;return receipt;
    } error:error];
}
- (NSString *)getRevocationCompletions:(NSString *)key error:(NSError **)error {
    if(![key isEqual:YNXAtomicKeys()[5]]){[self fail:error reason:@"Invalid completion history key."];return nil;}
    return [self atomicOperation:^id(NSMutableDictionary *r,NSError **e){if(![self revocationHistory:r[key]]){[self fail:e reason:@"Corrupt or foreign completion history."];return nil;}return r[key];} error:error];
}
- (NSString *)getRevocationCompletion:(NSString *)key intentId:(NSString *)intentID error:(NSError **)error {
    if(!YNXDevicePattern(intentID,@"^[A-Za-z0-9_-]{32,64}$")){[self fail:error reason:@"Invalid original intent ID."];return nil;}NSString *raw=[self getRevocationCompletions:key error:error];for(NSDictionary *v in (NSArray *)YNXAtomicJSON(raw))if([v[@"intentId"] isEqual:intentID])return YNXDeviceCanonical(v);return nil;
}
- (BOOL)acknowledgeRevocationCompletion:(NSString *)key expectedReceiptRaw:(NSString *)raw error:(NSError **)error {
    NSDictionary *v=[self revocationReceipt:raw];if(![key isEqual:YNXAtomicKeys()[5]]||![self consented]||!v)return [self fail:error reason:@"Invalid or unapproved completion acknowledgement."];
    return [[self atomicOperation:^id(NSMutableDictionary *r,NSError **e){NSArray *history=[self revocationHistory:r[key]];if(!history){[self fail:e reason:@"Corrupt history; preserved."];return nil;}NSMutableArray *next=[history mutableCopy];for(NSDictionary *old in history)if([old[@"intentId"] isEqual:v[@"intentId"]]){if(![YNXDeviceCanonical(old) isEqual:raw]){[self fail:e reason:@"REVOCATION_CHANGED: acknowledgement differs."];return nil;}[next removeObject:old];r[key]=YNXDeviceCanonical(next);break;}return @YES;} error:error] boolValue];
}

- (NSString *)consumerJournalPersist:(NSString *)raw error:(NSError **)error {
    NSDictionary *receipt=[self revocationReceipt:raw];
    if(!receipt||![self consented]){[self fail:error reason:@"A bound receipt and native consent are required for the consumer journal."];return nil;}
    return [self atomicOperation:^id(NSMutableDictionary *r,NSError **e){
        NSString *key=[@"native-consumer-journal:" stringByAppendingString:receipt[@"intentId"]],*old=r[key];
        if(old){if(![old isEqual:raw]){[self fail:e reason:@"REVOCATION_CHANGED: consumer journal differs."];return nil;}return old;}
        BOOL found=NO;for(NSDictionary *v in [self revocationHistory:r[YNXAtomicKeys()[5]]])if([YNXDeviceCanonical(v) isEqual:raw]){found=YES;break;}
        if(!found){[self fail:e reason:@"REVOCATION_CHANGED: exact protected completion is unavailable."];return nil;}
        r[key]=raw;return raw;
    } error:error];
}
- (NSString *)consumerJournalRead:(NSString *)intentID error:(NSError **)error {
    if(!YNXDevicePattern(intentID,@"^[A-Za-z0-9_-]{32,64}$")){[self fail:error reason:@"Invalid consumer journal intent ID."];return nil;}
    return [self atomicOperation:^id(NSMutableDictionary *r,NSError **e){return r[[@"native-consumer-journal:" stringByAppendingString:intentID]];} error:error];
}

- (NSString *)stored:(NSString *)key error:(NSError **)error {if(![YNXAtomicKeys() containsObject:key]){[self fail:error reason:@"Storage key is outside the Developer Product Session."];return nil;}return [self rawStored:key error:error];}
- (BOOL)validSession:(NSDictionary *)s {
    if(!YNXDeviceFields(s,@"version sessionBinding chainId productId clientId platform applicationId bundleId packageId origin callback account deviceId deviceAlgorithm deviceKey deviceBinding nonce state scopes requestDigest approvalDigest issuedAt expiresAt")||![self fullBinding:s]||![self tokens:s]||![self scopes:s[@"scopes"]]||!YNXDeviceLifetime(s,300)||!YNXDevicePattern(s[@"account"],@"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$")||!YNXDevicePattern(s[@"sessionBinding"],@"^[0-9a-f]{64}$"))return NO;
    NSMutableDictionary *binding=[NSMutableDictionary new];for(NSString *key in @[@"chainId",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"deviceId",@"deviceAlgorithm",@"deviceKey"])binding[key]=s[key];return [s[@"deviceBinding"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_DEVICE_V2",binding)];
}
- (BOOL)store:(NSString *)value key:(NSString *)key error:(NSError **)error {
    if((!YNXDeviceStorageAllowed(key)&&![key isEqual:YNXAtomicKeys()[3]])||![value isKindOfClass:NSString.class]||![self consented])return [self fail:error reason:@"Explicit native connection consent is required to change Wallet state."];
    NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>32768)return [self fail:error reason:@"Protected state encoding or size is invalid."];id object=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if(![key hasSuffix:@":return"]&&![key isEqual:YNXAtomicKeys()[3]]){NSString *old=[self rawStored:key error:error];if(error&&*error)return NO;NSDictionary *oldObject=old?[NSJSONSerialization JSONObjectWithData:[old dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;if(old&&![self fullBinding:oldObject])return [self fail:error reason:@"Existing protected state belongs to another device or protocol. It was preserved; no automatic migration is permitted."];}
    if([key hasSuffix:@":pending"]){if(![self validRequest:object])return [self fail:error reason:@"Pending authorization is not bound to this native device."];}
    else if([key hasSuffix:@":return"]){if(![self acceptCallbackURL:value])return [self fail:error reason:@"Callback is not bound to this window's opened request."];}
    else if([key isEqual:YNXAtomicKeys()[3]]){
        id proof=[object isKindOfClass:NSDictionary.class]?object[@"completion"]:nil;id c=[proof isKindOfClass:NSDictionary.class]?proof[@"challenge"]:nil;
        if(!_signedChallenge||![YNXDeviceCanonical(c) isEqual:YNXDeviceCanonical(_signedChallenge)]||![YNXDeviceCanonical(object[@"request"]) isEqual:YNXDeviceCanonical(_request)]||![YNXDeviceCanonical(object[@"approval"]) isEqual:YNXDeviceCanonical(_approval)])return [self fail:error reason:@"Completion must retain the exact native signed challenge and approval."];
        SecKeyRef pub=SecKeyCopyPublicKey(_privateKey);NSData *signature=YNXDeviceDecode(proof[@"deviceSignature"],128),*bytes=[[NSString stringWithFormat:@"YNX_PRODUCT_SESSION_CHALLENGE_V2\n%@",YNXDeviceCanonical(c)] dataUsingEncoding:NSUTF8StringEncoding];BOOL valid=pub&&signature&&SecKeyVerifySignature(pub,kSecKeyAlgorithmECDSASignatureMessageX962SHA256,(__bridge CFDataRef)bytes,(__bridge CFDataRef)signature,NULL);if(pub)CFRelease(pub);if(!valid)return [self fail:error reason:@"Completion signature differs from the native device proof."];
    }
    else {
        if(![self validSession:object]||!_signedChallenge)return [self fail:error reason:@"Session must match a challenge signed in this native connection."];
        for(NSString *f in @[@"account",@"nonce",@"state",@"scopes",@"requestDigest",@"approvalDigest",@"issuedAt"])if(![object[f] isEqual:_signedChallenge[f]])return [self fail:error reason:@"Session differs from the signed challenge."];
        if(![object[@"expiresAt"] isEqual:_signedChallenge[@"sessionExpiresAt"]]||![object[@"sessionBinding"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_BINDING_V2",_signedChallenge)])return [self fail:error reason:@"Session binding differs from the signed challenge."];
        // Anchor does not mean authenticated. Only SDK/Gateway introspection
        // can establish that; it bounds later native proofs across restarts.
        if(![self rawStore:YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",object) key:[@"native-session-anchor:" stringByAppendingString:object[@"sessionBinding"]] error:error])return NO;
    }
    return [self rawStore:value key:key error:error];
}
- (BOOL)remove:(NSString *)key error:(NSError **)error {if((!YNXDeviceStorageAllowed(key)&&![key isEqual:YNXAtomicKeys()[3]])||![self consented])return [self fail:error reason:@"Explicit native connection consent is required to remove Wallet state."];if(![key hasSuffix:@":return"]&&![key isEqual:YNXAtomicKeys()[3]]){NSString *old=[self rawStored:key error:error];if(error&&*error)return NO;NSDictionary *object=old?[NSJSONSerialization JSONObjectWithData:[old dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;if(old&&![self fullBinding:object])return [self fail:error reason:@"Existing state uses another device or protocol and was preserved."];}return [self removeAtomicKey:key error:error];}
- (NSString *)sign:(NSDictionary *)input error:(NSError **)error {
    BOOL loginConsent=[self consented];NSTimeInterval elapsed=NSProcessInfo.processInfo.systemUptime-_serviceReadBeganMono;
    BOOL readConsent=_serviceReadObserver&&_serviceReadSession&&_serviceReadPaths&&elapsed>=0&&elapsed<_serviceReadBudget;
    if((!loginConsent&&!readConsent)||!YNXDeviceFields(input,@"purpose algorithm deviceKey payload")||![input[@"algorithm"] isEqual:@"p256-sha256"]||![input[@"deviceKey"] isEqual:self.publicKey]){[self fail:error reason:@"Signing requires an explicitly approved native device operation."];return nil;}
    NSData *bytes=YNXDeviceDecode(input[@"payload"],8192);NSString *text=bytes?[[NSString alloc]initWithData:bytes encoding:NSUTF8StringEncoding]:nil;NSRange newline=[text rangeOfString:@"\n"];if(!text||newline.location==NSNotFound){[self fail:error reason:@"Signing payload is invalid."];return nil;}
    NSString *domain=[text substringToIndex:newline.location],*json=[text substringFromIndex:newline.location+1];NSDictionary *v=[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];if(![v isKindOfClass:NSDictionary.class]){[self fail:error reason:@"Signing payload must be a Product Session object."];return nil;}BOOL valid=[YNXDeviceCanonical(v) isEqual:json];NSString *replay=nil;BOOL serviceGET=NO;
    if([input[@"purpose"] isEqual:@"challenge"]){
        valid=valid&&loginConsent&&[domain isEqual:@"YNX_PRODUCT_SESSION_CHALLENGE_V2"]&&YNXDeviceFields(v,@"version challenge requestDigest approvalDigest chainId productId clientId platform applicationId bundleId packageId origin callback deviceId deviceAlgorithm deviceKey nonce state account scopes issuedAt expiresAt sessionExpiresAt")&&_request&&_approval&&[self fullBinding:v]&&YNXDeviceLifetime(v,60)&&YNXDevicePattern(v[@"challenge"],@"^[A-Za-z0-9_-]{32,64}$");
        for(NSString *f in @[@"account",@"nonce",@"state",@"scopes",@"requestDigest"])valid=valid&&[v[f] isEqual:_approval[f]];
        NSDate *sessionEnd=YNXDeviceDate(v[@"sessionExpiresAt"]),*approvalEnd=YNXDeviceDate(_approval[@"expiresAt"]),*issue=YNXDeviceDate(v[@"issuedAt"]);valid=valid&&sessionEnd&&approvalEnd&&issue&&[sessionEnd timeIntervalSinceDate:issue]>0&&[sessionEnd timeIntervalSinceDate:issue]<=180&&[sessionEnd compare:approvalEnd]!=NSOrderedDescending&&[YNXDeviceDate(v[@"expiresAt"]) compare:sessionEnd]!=NSOrderedDescending&&[v[@"approvalDigest"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_APPROVAL_V2",_approval)];replay=v[@"challenge"];
    } else if([input[@"purpose"] isEqual:@"http-proof"]){
        valid=valid&&[domain isEqual:@"YNX_PRODUCT_SESSION_HTTP_PROOF_V2"]&&YNXDeviceFields(v,@"version sessionBinding productId clientId applicationId bundleId packageId origin callback account deviceId deviceKey method path bodyDigest nonce issuedAt expiresAt")&&[self binding:v]&&((loginConsent&&[v[@"method"] isEqual:@"POST"]&&[@[@"/v2/product-sessions/introspect",@"/v2/product-sessions/revoke"] containsObject:v[@"path"]])||[v[@"method"]isEqual:@"GET"])&&YNXDeviceLifetime(v,60)&&YNXDevicePattern(v[@"nonce"],@"^[A-Za-z0-9_-]{32,64}$");
        NSString *stored=[self stored:YNXDeviceStorageBase error:error];NSDictionary *session=stored?[NSJSONSerialization JSONObjectWithData:[stored dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;NSString *anchor=YNXDevicePattern(session[@"sessionBinding"],@"^[0-9a-f]{64}$")?[self rawStored:[@"native-session-anchor:" stringByAppendingString:session[@"sessionBinding"]] error:error]:nil;valid=valid&&[self validSession:session]&&[anchor isEqual:YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",session)];
        for(NSString *f in @[@"sessionBinding",@"account"])valid=valid&&[v[f] isEqual:session[f]];
        serviceGET=[v[@"method"]isEqual:@"GET"];if(serviceGET)valid=valid&&[self serviceReadAllows:v session:session error:error];
        NSString *body=serviceGET?@"":[v[@"path"] isEqual:@"/v2/product-sessions/revoke"]?@"{}":YNXDeviceCanonical(@{@"requiredScopes":session[@"scopes"]?:@[]});valid=valid&&[v[@"bodyDigest"] isEqual:YNXDeviceHash(body)]&&[YNXDeviceDate(v[@"expiresAt"]) compare:YNXDeviceDate(session[@"expiresAt"]) ]!=NSOrderedDescending&&[YNXDeviceDate(v[@"issuedAt"]) compare:YNXDeviceDate(session[@"issuedAt"]) ]!=NSOrderedAscending;replay=v[@"nonce"];
    }else valid=NO;
    if(error&&*error)return nil;
    if(!valid||!replay||[_signedNonces containsObject:replay]||_signedNonces.count>=256){[self fail:error reason:@"Payload exceeds the native Product Session signing capability or was already signed."];return nil;}
    CFErrorRef failure=NULL;NSData *signature=CFBridgingRelease(SecKeyCreateSignature(_privateKey,kSecKeyAlgorithmECDSASignatureMessageX962SHA256,(__bridge CFDataRef)bytes,&failure));if(failure)CFRelease(failure);if(!signature){[self fail:error reason:@"Native device signing failed; protected state was preserved."];return nil;}[_signedNonces addObject:replay];
    if(serviceGET){NSString *raw=[self stored:YNXDeviceStorageBase error:error];NSDictionary *session=raw?YNXAtomicJSON(raw):nil;if((error&&*error)||![self serviceReadAllows:v session:session error:error]){if(!(error&&*error))[self fail:error reason:@"Original service or Wallet session changed during device proof."];return nil;}}
    if([input[@"purpose"] isEqual:@"challenge"])_signedChallenge=[v copy];return YNXDeviceB64(signature);
}
@end
