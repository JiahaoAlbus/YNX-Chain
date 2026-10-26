#import "original-ide-wallet-identity-source.h"
#import "original-auth-identity-source-authority.h"
#include "original-ide-parent-kernel.h"
#include <pthread.h>
#include <unistd.h>
#include <chrono>

static BOOL WalletIdentityExact(NSDictionary *d,NSArray *keys){return [d isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:d.allKeys]isEqual:[NSSet setWithArray:keys]];}
static uint64_t WalletIdentityMono(){return (uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static BOOL WalletIdentityDecimal(id x,uint64_t *v){if(![x isKindOfClass:NSString.class]||![x length]||[x length]>20||([x length]>1&&[x characterAtIndex:0]=='0'))return NO;uint64_t n=0;for(NSUInteger i=0;i<[x length];i++){unichar c=[x characterAtIndex:i];if(c<'0'||c>'9'||n>(UINT64_MAX-(c-'0'))/10)return NO;n=n*10+c-'0';}*v=n;return YES;}
@implementation YNXOriginalIDEWalletIdentitySource {
 YNXAuthIdentitySourceAuthority *_source;
 NSDictionary *_selection,*_registration;
 NSData *_request,*_invocation;
 ynx_auth_ide_private::KernelProcess _wallet;
 NSError *_first,*_closeFirst;
 pthread_t _thread;
 uint64_t _issued,_expires,_deadline,_wallFloor,_monoFloor;
 BOOL _ready,_bound,_retired,_closeSelected,_closed;
}
- (BOOL)fail:(NSString *)code error:(NSError **)error{_ready=NO;if(!_first)_first=[NSError errorWithDomain:@"YNXOriginalIDEWalletIdentitySource" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_first;return NO;}
- (BOOL)thread:(NSError **)error{if(!pthread_main_np()||!pthread_equal(_thread,pthread_self())){if(error)*error=[NSError errorWithDomain:@"YNXOriginalIDEWalletIdentitySource" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_WALLET_THREAD_REQUIRED"}];return NO;}return YES;}
+ (instancetype)acquire:(NSError **)error{
 YNXOriginalIDEWalletIdentitySource *s=[self new];s->_thread=pthread_self();
 if(![s thread:error])return s;
 @try{try{
  if(getuid()!=geteuid()||getgid()!=getegid()){[s fail:@"AUTH_IDENTITY_WALLET_IDENTITY_REQUIRED" error:error];return s;}
  // SAME existing protected registry custody. Do NOT construct old four-op
  // SourceBinding or acquire an administration/login/Host Source instead.
  NSError *e=nil;s->_source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEIdentityWalletSource:&e];
  // Retain returned partial BEFORE observing error; original caller owns close.
  if(e||!s->_source){[s fail:e.localizedDescription?:@"AUTH_IDENTITY_WALLET_SOURCE_UNAVAILABLE" error:error];return s;}
  s->_selection=[s->_source copyOriginalSelection:&e];s->_registration=s->_selection[@"identityPeerBinding"];
  if(e||!WalletIdentityExact(s->_registration,@[@"walletCodeIdentity",@"ideCodeIdentity",@"nodeCodeIdentity",@"nodeSHA256",@"entrySHA256",@"provenanceSHA256"])){[s fail:@"AUTH_IDENTITY_WALLET_REGISTRATION_REQUIRED" error:error];return s;}
  for(NSString *key in @[@"walletCodeIdentity",@"ideCodeIdentity",@"nodeCodeIdentity"]){id text=s->_registration[key];NSData *raw=[text isKindOfClass:NSString.class]?[[NSData alloc]initWithBase64EncodedString:text options:0]:nil;if(raw.length<20||raw.length>64||![[raw base64EncodedStringWithOptions:0]isEqual:text]){[s fail:@"AUTH_IDENTITY_WALLET_REGISTRATION_INVALID" error:error];return s;}}
  for(NSString *key in @[@"nodeSHA256",@"entrySHA256",@"provenanceSHA256"]){id text=s->_registration[key];if(![text isKindOfClass:NSString.class]||[text length]!=64||[text rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]invertedSet]].location!=NSNotFound){[s fail:@"AUTH_IDENTITY_WALLET_REGISTRATION_INVALID" error:error];return s;}}
  s->_wallet=ynx_auth_ide_private::observeKernel(getpid());
  if(s->_wallet.original.uid!=getuid()||![[s->_wallet.codeIdentity base64EncodedStringWithOptions:0]isEqual:s->_registration[@"walletCodeIdentity"]]){[s fail:@"AUTH_IDENTITY_WALLET_CODE_IDENTITY_MISMATCH" error:error];return s;}
  s->_ready=YES;[s assertCurrent:error];return s;
 }catch(...){[s fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];return s;}}@catch(NSException *){[s fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];return s;}
}
- (BOOL)clock:(NSError **)error{
 uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),mono=WalletIdentityMono();
 if(now<_issued||now>=_expires||now<_wallFloor||mono<_monoFloor||!_deadline||mono>=_deadline)return [self fail:@"AUTH_IDENTITY_ORIGINAL_WINDOW_EXPIRED" error:error];
 _wallFloor=now;_monoFloor=mono;return YES;
}
- (BOOL)assertCurrent:(NSError **)error{
 if(![self thread:error])return NO;
 if(!_ready||_first||_retired||_closeSelected)return [self fail:@"AUTH_IDENTITY_WALLET_SOURCE_NOT_CURRENT" error:error];
 if(_bound&&![self clock:error])return NO;
 NSError *e=nil;
 @try{try{
  if(![_source assertAuthenticatedNativePurpose:&e]||e||![[ _source copyOriginalSelection:&e]isEqual:_selection]||e||!ynx_auth_ide_private::sameKernel(_wallet,ynx_auth_ide_private::observeKernel(getpid())))return [self fail:e.localizedDescription?:@"AUTH_IDENTITY_WALLET_SOURCE_CHANGED" error:error];
  if(_bound&&(![_source assertOriginalIDEIdentityRequestCurrent:_request invocation:_invocation error:&e]||e))return [self fail:e.localizedDescription?:@"AUTH_IDENTITY_WALLET_REQUEST_CHANGED" error:error];
  if(_first||_retired||_closeSelected)return [self fail:@"AUTH_IDENTITY_WALLET_SOURCE_NOT_CURRENT" error:error];
  return !_bound||[self clock:error];
 }catch(...){return [self fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];}}@catch(NSException *){return [self fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];}
}
- (BOOL)bindRequest:(NSData *)request invocation:(NSData *)invocation error:(NSError **)error{
 if(![self assertCurrent:error])return NO;if(_bound)return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_ONCE" error:error];
 _bound=YES;_request=[request copy];_invocation=[invocation copy];
 if(![_request isKindOfClass:NSData.class]||!_request.length||_request.length>16384||![_invocation isKindOfClass:NSData.class]||_invocation.length>16384)return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_INVALID" error:error];
 NSDictionary *body=[NSJSONSerialization JSONObjectWithData:_request options:0 error:nil];
 NSData *canonical=[body isKindOfClass:NSDictionary.class]?[NSJSONSerialization dataWithJSONObject:body options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil]:nil;
 id nonce=body[@"nonce"];
 if(![canonical isEqual:_request]||body.count!=17||![@[@"AUTH-IDENTITY-RECEIVE",@"AUTH-IDENTITY-RECOVER",@"AUTH-PROTECTED-KEY-CALL"]containsObject:body[@"purpose"]]||![nonce isKindOfClass:NSString.class]||[nonce length]!=43||[nonce rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"]invertedSet]].location!=NSNotFound||!WalletIdentityDecimal(body[@"issuedAtMs"],&_issued)||!WalletIdentityDecimal(body[@"expiresAtMs"],&_expires)||_expires<=_issued||_expires-_issued>30000)return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_INVALID" error:error];
 uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),mono=WalletIdentityMono();if(now<_issued||now>=_expires||mono>UINT64_MAX-(_expires-now))return [self fail:@"AUTH_IDENTITY_ORIGINAL_WINDOW_EXPIRED" error:error];
 _wallFloor=now;_monoFloor=mono;_deadline=mono+(_expires-now);
 NSError *e=nil;if(![_source assertOriginalIDEIdentityRequestCurrent:_request invocation:_invocation error:&e]||e||![_source assertOriginalIDEIdentityProofConsumerReady:_request error:&e]||e)return [self fail:e.localizedDescription?:@"AUTH_IDENTITY_WALLET_REQUEST_UNQUALIFIED" error:error];
 return [self assertCurrent:error];
}
- (NSData *)copyRequest:(NSError **)error{if(!_bound||![self assertCurrent:error])return nil;NSData *raw=[_request copy];return [self assertCurrent:error]?raw:nil;}
- (NSDictionary *)copyRegistration:(NSError **)error{if(![self assertCurrent:error])return nil;NSDictionary *v=[_registration copy];return [self assertCurrent:error]?v:nil;}
- (NSNumber *)copySourceExpiresAtMs:(NSError **)error{
 if(![self assertCurrent:error])return nil;
 NSError *e=nil;NSDictionary *raw=[_source copyOriginalProvisioningPublicOriginals:&e];
 NSData *current=raw[@"currentOriginal"];id envelope=[current isKindOfClass:NSData.class]?[NSJSONSerialization JSONObjectWithData:current options:0 error:nil]:nil;
 id text=[envelope isKindOfClass:NSDictionary.class]?envelope[@"body"]:nil;
 if(e||![envelope[@"version"]isEqual:@2]||![text isKindOfClass:NSString.class]||[text length]>87384)return [self fail:@"AUTH_IDENTITY_WALLET_SOURCE_WINDOW_REQUIRED" error:error],nil;
 NSString *base=[text stringByReplacingOccurrencesOfString:@"-" withString:@"+"];base=[base stringByReplacingOccurrencesOfString:@"_" withString:@"/"];if(base.length%4==1)return [self fail:@"AUTH_IDENTITY_WALLET_SOURCE_WINDOW_REQUIRED" error:error],nil;while(base.length%4)base=[base stringByAppendingString:@"="];
 NSData *bytes=[[NSData alloc]initWithBase64EncodedString:base options:0];NSString *encoded=[[[bytes base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];encoded=[encoded stringByReplacingOccurrencesOfString:@"=" withString:@""];
 NSDictionary *body=bytes.length<=65536?[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil]:nil;id end=[body isKindOfClass:NSDictionary.class]?body[@"expiresAtMs"]:nil;
 const uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
 if(![encoded isEqual:text]||![end isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)end)==CFBooleanGetTypeID()||[end doubleValue]!=(double)[end unsignedLongLongValue]||[end unsignedLongLongValue]>9007199254740991ULL||[end unsignedLongLongValue]<=now)return [self fail:@"AUTH_IDENTITY_WALLET_SOURCE_WINDOW_REQUIRED" error:error],nil;
 return [self assertCurrent:error]?[end copy]:nil;
}
- (BOOL)verifyProof:(NSData *)proof error:(NSError **)error{
 if(!_bound||![self assertCurrent:error])return NO;NSError *e=nil;
 if(![proof isKindOfClass:NSData.class]||!proof.length||proof.length>262144||![_source verifyOriginalIDEIdentityProof:proof expectedRequest:_request invocation:_invocation error:&e]||e)return [self fail:e.localizedDescription?:@"AUTH_IDENTITY_WALLET_PROOF_REFUSED" error:error];
 return [self assertCurrent:error];
}
- (void)retire{if(pthread_equal(_thread,pthread_self())){_retired=YES;_ready=NO;[_source retire];}}
- (BOOL)join:(NSError **)error{if(![self thread:error])return NO;if(!_retired)return NO;return !_source||[_source join:error];}
- (BOOL)close:(NSError **)error{
 if(![self thread:error])return NO;if(_closeSelected){if(error)*error=_closeFirst;return _closed;}
 [self retire];if(![self join:error])return NO;_closeSelected=YES;
 NSError *e=nil;_closed=!_source||[_source close:&e];if(!_closed||e){_closed=NO;_closeFirst=e?:[NSError errorWithDomain:@"YNXOriginalIDEWalletIdentitySource" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_WALLET_CLOSE_UNKNOWN"}];if(error)*error=_closeFirst;return NO;}
 _source=nil;return YES;
}
@end
