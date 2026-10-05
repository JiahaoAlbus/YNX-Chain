#pragma once
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/file.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <unistd.h>

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

@interface YNXWalletDeviceBridge : NSObject
@property(nonatomic,readonly) NSString *publicKey;
@property(nonatomic,readonly) NSString *instanceID;
- (instancetype)initWithTag:(NSString *)tag storageService:(NSString *)service lockDirectory:(NSString *)directory;
- (NSDictionary *)beginUserOperation:(NSError **)error;
- (void)endUserOperation;
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
- (NSDictionary *)beginUserOperation:(NSError **)error {
    if(_lockFD<0){struct stat s;char *real=realpath(_lockDirectory.fileSystemRepresentation,NULL);BOOL safe=real&&[_lockDirectory isEqual:[NSString stringWithUTF8String:real]]&&lstat(_lockDirectory.fileSystemRepresentation,&s)==0&&S_ISDIR(s.st_mode)&&s.st_uid==getuid()&&(s.st_mode&0077)==0;if(real)free(real);if(!safe){[self fail:error reason:@"Private native Wallet lock directory is unavailable."];return nil;}
        int directory=open(_lockDirectory.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(directory<0){[self fail:error reason:@"Private native Wallet lock directory could not be opened."];return nil;}_lockFD=openat(directory,"native-wallet-connection.lock",O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC,0600);close(directory);
        if(_lockFD<0||fstat(_lockFD,&s)!=0||!S_ISREG(s.st_mode)||s.st_uid!=getuid()||s.st_nlink!=1||(s.st_mode&0077)!=0||flock(_lockFD,LOCK_EX|LOCK_NB)!=0){if(_lockFD>=0)close(_lockFD);_lockFD=-1;[self fail:error reason:@"Another Developer window has an active Wallet connection; continue there."];return nil;}}
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
- (void)endUserOperation {_consentUntil=nil;_request=nil;_approval=nil;_signedChallenge=nil;[_signedNonces removeAllObjects];if(_lockFD>=0){close(_lockFD);_lockFD=-1;}}
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
- (NSString *)rawStored:(NSString *)key error:(NSError **)error {NSMutableDictionary *q=[[self query:key] mutableCopy];q[(__bridge id)kSecReturnData]=@YES;q[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)q,&result);NSData *data=CFBridgingRelease(result);if(status==errSecItemNotFound)return nil;NSString *s=data.length<=32768?[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]:nil;if(status!=errSecSuccess||!s)[self fail:error reason:@"Protected Wallet state is unavailable; it was preserved."];return s;}
- (BOOL)rawStore:(NSString *)value key:(NSString *)key error:(NSError **)error {NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>32768)return [self fail:error reason:@"Protected state is too large."];NSDictionary *q=[self query:key];OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)q,(__bridge CFDictionaryRef)@{(__bridge id)kSecValueData:data});if(status==errSecItemNotFound){NSMutableDictionary *add=[q mutableCopy];add[(__bridge id)kSecValueData]=data;add[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;status=SecItemAdd((__bridge CFDictionaryRef)add,NULL);}return status==errSecSuccess?YES:[self fail:error reason:@"Keychain could not protect Wallet state."];}
- (NSString *)stored:(NSString *)key error:(NSError **)error {if(!YNXDeviceStorageAllowed(key)){[self fail:error reason:@"Storage key is outside the Developer Product Session."];return nil;}return [self rawStored:key error:error];}
- (BOOL)validSession:(NSDictionary *)s {
    if(!YNXDeviceFields(s,@"version sessionBinding chainId productId clientId platform applicationId bundleId packageId origin callback account deviceId deviceAlgorithm deviceKey deviceBinding nonce state scopes requestDigest approvalDigest issuedAt expiresAt")||![self fullBinding:s]||![self tokens:s]||![self scopes:s[@"scopes"]]||!YNXDeviceLifetime(s,300)||!YNXDevicePattern(s[@"account"],@"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$")||!YNXDevicePattern(s[@"sessionBinding"],@"^[0-9a-f]{64}$"))return NO;
    NSMutableDictionary *binding=[NSMutableDictionary new];for(NSString *key in @[@"chainId",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"deviceId",@"deviceAlgorithm",@"deviceKey"])binding[key]=s[key];return [s[@"deviceBinding"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_DEVICE_V2",binding)];
}
- (BOOL)store:(NSString *)value key:(NSString *)key error:(NSError **)error {
    if(!YNXDeviceStorageAllowed(key)||![value isKindOfClass:NSString.class]||![self consented])return [self fail:error reason:@"Explicit native connection consent is required to change Wallet state."];
    NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>32768)return [self fail:error reason:@"Protected state encoding or size is invalid."];id object=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if(![key hasSuffix:@":return"]){NSString *old=[self rawStored:key error:error];if(error&&*error)return NO;NSDictionary *oldObject=old?[NSJSONSerialization JSONObjectWithData:[old dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;if(old&&![self fullBinding:oldObject])return [self fail:error reason:@"Existing protected state belongs to another device or protocol. It was preserved; no automatic migration is permitted."];}
    if([key hasSuffix:@":pending"]){if(![self validRequest:object])return [self fail:error reason:@"Pending authorization is not bound to this native device."];}
    else if([key hasSuffix:@":return"]){if(![self acceptCallbackURL:value])return [self fail:error reason:@"Callback is not bound to this window's opened request."];}
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
- (BOOL)remove:(NSString *)key error:(NSError **)error {if(!YNXDeviceStorageAllowed(key)||![self consented])return [self fail:error reason:@"Explicit native connection consent is required to remove Wallet state."];if(![key hasSuffix:@":return"]){NSString *old=[self rawStored:key error:error];if(error&&*error)return NO;NSDictionary *object=old?[NSJSONSerialization JSONObjectWithData:[old dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;if(old&&![self fullBinding:object])return [self fail:error reason:@"Existing state uses another device or protocol and was preserved."];}OSStatus s=SecItemDelete((__bridge CFDictionaryRef)[self query:key]);return s==errSecSuccess||s==errSecItemNotFound?YES:[self fail:error reason:@"Protected state could not be removed."];}
- (NSString *)sign:(NSDictionary *)input error:(NSError **)error {
    if(![self consented]||!YNXDeviceFields(input,@"purpose algorithm deviceKey payload")||![input[@"algorithm"] isEqual:@"p256-sha256"]||![input[@"deviceKey"] isEqual:self.publicKey]){[self fail:error reason:@"Signing requires an explicitly approved native device operation."];return nil;}
    NSData *bytes=YNXDeviceDecode(input[@"payload"],8192);NSString *text=bytes?[[NSString alloc]initWithData:bytes encoding:NSUTF8StringEncoding]:nil;NSRange newline=[text rangeOfString:@"\n"];if(!text||newline.location==NSNotFound){[self fail:error reason:@"Signing payload is invalid."];return nil;}
    NSString *domain=[text substringToIndex:newline.location],*json=[text substringFromIndex:newline.location+1];NSDictionary *v=[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];BOOL valid=[YNXDeviceCanonical(v) isEqual:json];NSString *replay=nil;
    if([input[@"purpose"] isEqual:@"challenge"]){
        valid=valid&&[domain isEqual:@"YNX_PRODUCT_SESSION_CHALLENGE_V2"]&&YNXDeviceFields(v,@"version challenge requestDigest approvalDigest chainId productId clientId platform applicationId bundleId packageId origin callback deviceId deviceAlgorithm deviceKey nonce state account scopes issuedAt expiresAt sessionExpiresAt")&&_request&&_approval&&[self fullBinding:v]&&YNXDeviceLifetime(v,60)&&YNXDevicePattern(v[@"challenge"],@"^[A-Za-z0-9_-]{32,64}$");
        for(NSString *f in @[@"account",@"nonce",@"state",@"scopes",@"requestDigest"])valid=valid&&[v[f] isEqual:_approval[f]];
        NSDate *sessionEnd=YNXDeviceDate(v[@"sessionExpiresAt"]),*approvalEnd=YNXDeviceDate(_approval[@"expiresAt"]),*issue=YNXDeviceDate(v[@"issuedAt"]);valid=valid&&sessionEnd&&approvalEnd&&issue&&[sessionEnd timeIntervalSinceDate:issue]>0&&[sessionEnd timeIntervalSinceDate:issue]<=180&&[sessionEnd compare:approvalEnd]!=NSOrderedDescending&&[YNXDeviceDate(v[@"expiresAt"]) compare:sessionEnd]!=NSOrderedDescending&&[v[@"approvalDigest"] isEqual:YNXDeviceDigest(@"YNX_PRODUCT_SESSION_APPROVAL_V2",_approval)];replay=v[@"challenge"];
    } else if([input[@"purpose"] isEqual:@"http-proof"]){
        valid=valid&&[domain isEqual:@"YNX_PRODUCT_SESSION_HTTP_PROOF_V2"]&&YNXDeviceFields(v,@"version sessionBinding productId clientId applicationId bundleId packageId origin callback account deviceId deviceKey method path bodyDigest nonce issuedAt expiresAt")&&[self binding:v]&&[v[@"method"] isEqual:@"POST"]&&[@[@"/v2/product-sessions/introspect",@"/v2/product-sessions/revoke"] containsObject:v[@"path"]]&&YNXDeviceLifetime(v,60)&&YNXDevicePattern(v[@"nonce"],@"^[A-Za-z0-9_-]{32,64}$");
        NSString *stored=[self stored:YNXDeviceStorageBase error:error];NSDictionary *session=stored?[NSJSONSerialization JSONObjectWithData:[stored dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;NSString *anchor=YNXDevicePattern(session[@"sessionBinding"],@"^[0-9a-f]{64}$")?[self rawStored:[@"native-session-anchor:" stringByAppendingString:session[@"sessionBinding"]] error:error]:nil;valid=valid&&[self validSession:session]&&[anchor isEqual:YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",session)];
        for(NSString *f in @[@"sessionBinding",@"account"])valid=valid&&[v[f] isEqual:session[f]];
        NSString *body=[v[@"path"] isEqual:@"/v2/product-sessions/revoke"]?@"{}":YNXDeviceCanonical(@{@"requiredScopes":session[@"scopes"]?:@[]});valid=valid&&[v[@"bodyDigest"] isEqual:YNXDeviceHash(body)]&&[YNXDeviceDate(v[@"expiresAt"]) compare:YNXDeviceDate(session[@"expiresAt"]) ]!=NSOrderedDescending&&[YNXDeviceDate(v[@"issuedAt"]) compare:YNXDeviceDate(session[@"issuedAt"]) ]!=NSOrderedAscending;replay=v[@"nonce"];
    }else valid=NO;
    if(!valid||!replay||[_signedNonces containsObject:replay]||_signedNonces.count>=256){[self fail:error reason:@"Payload exceeds the native Product Session signing capability or was already signed."];return nil;}
    CFErrorRef failure=NULL;NSData *signature=CFBridgingRelease(SecKeyCreateSignature(_privateKey,kSecKeyAlgorithmECDSASignatureMessageX962SHA256,(__bridge CFDataRef)bytes,&failure));if(failure)CFRelease(failure);if(!signature){[self fail:error reason:@"Native device signing failed; protected state was preserved."];return nil;}[_signedNonces addObject:replay];if([input[@"purpose"] isEqual:@"challenge"])_signedChallenge=[v copy];return YNXDeviceB64(signature);
}
@end
