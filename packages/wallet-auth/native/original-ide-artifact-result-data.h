#pragma once
#import <Foundation/Foundation.h>
#include <cstdint>
#include <stdexcept>
#include "original-ide-identity-peer-wire.h"
#include <cstring>
// SAME peer kind6 bounded original-byte transport, deliberately UNVERIFIED DATA.
// It does not verify the member, approve its ref, register its carried public R,
// or confer Source/KEY7/LinuxHTTP permission. Caller must independently verify
// actual current registered R13 + SDK dual-AND + Main original approval holder.
namespace ynx_auth_ide_identity_private {
inline constexpr std::size_t ArtifactResultMax=262144,ArtifactMemberMax=98304;
enum class ArtifactTerminalDATA{invalid,result,reject,cancel};
inline ArtifactTerminalDATA classifyOriginalArtifactTerminalDATA(const Frame&f,const unsigned char requestSHA256[32]){
 if(f.kind==Message::result)return !f.payload.empty()&&f.payload.size()<=ArtifactResultMax?ArtifactTerminalDATA::result:ArtifactTerminalDATA::invalid;
 if((f.kind!=Message::reject&&f.kind!=Message::cancel)||f.payload.size()!=32||memcmp(f.payload.data(),requestSHA256,32))return ArtifactTerminalDATA::invalid;
 return f.kind==Message::reject?ArtifactTerminalDATA::reject:ArtifactTerminalDATA::cancel;
}
struct ArtifactResultDATA {
 NSData*__strong original=nil,*__strong publisher=nil,*__strong member=nil;
 NSDictionary*__strong metadata=nil;
};
[[noreturn]] inline void ArtifactResultInvalid(){throw std::runtime_error("IDE_ARTIFACT_RESULT_DATA_INVALID");}
inline bool ArtifactResultKeys(id v,NSArray*keys){return [v isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:[v allKeys]]isEqual:[NSSet setWithArray:keys]];}
inline NSData*ArtifactResultUTF8(id v,NSUInteger cap){if(![v isKindOfClass:NSString.class])ArtifactResultInvalid();NSData*b=[v dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];if(!b.length||b.length>cap||![[[NSString alloc]initWithData:b encoding:NSUTF8StringEncoding]isEqual:v])ArtifactResultInvalid();return [b copy];}
inline NSData*ArtifactResultCanonical(id v){if(![v isKindOfClass:NSDictionary.class])ArtifactResultInvalid();NSData*b=[NSJSONSerialization dataWithJSONObject:v options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!b)ArtifactResultInvalid();return b;}
inline bool ArtifactResultU64(id v){if(![v isKindOfClass:NSString.class]||![v length]||[v length]>20||[v characterAtIndex:0]=='0')return false;uint64_t n=0;for(NSUInteger i=0;i<[v length];i++){unichar c=[v characterAtIndex:i];if(c<'0'||c>'9'||n>(UINT64_MAX-(c-'0'))/10)return false;n=n*10+c-'0';}return n>0;}
inline NSData*ArtifactResultBase64(id v,NSUInteger cap){
 NSData*text=ArtifactResultUTF8(v,(cap*4+2)/3);(void)text;
 if([v rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"]invertedSet]].location!=NSNotFound||[v length]%4==1)ArtifactResultInvalid();
 NSString*s=[v stringByReplacingOccurrencesOfString:@"-" withString:@"+"];s=[s stringByReplacingOccurrencesOfString:@"_" withString:@"/"];while(s.length%4)s=[s stringByAppendingString:@"="];
 NSData*b=[[NSData alloc]initWithBase64EncodedString:s options:0];if(!b.length||b.length>cap)ArtifactResultInvalid();
 NSString*canonical=[[[b base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];canonical=[canonical stringByReplacingOccurrencesOfString:@"=" withString:@""];
 if(![canonical isEqual:v])ArtifactResultInvalid();return [b copy];
}
inline bool ArtifactResultUUID(id v){
 if(![v isKindOfClass:NSString.class]||[v length]!=36)return false;
 for(NSUInteger i=0;i<36;i++){unichar c=[v characterAtIndex:i];if(i==8||i==13||i==18||i==23){if(c!='-')return false;}else if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;}
 return [v characterAtIndex:14]=='4'&&([v characterAtIndex:19]=='8'||[v characterAtIndex:19]=='9'||[v characterAtIndex:19]=='a'||[v characterAtIndex:19]=='b');
}
inline ArtifactResultDATA parseOriginalArtifactResultDATA(NSData*raw,NSData*request,NSData*invocation){
 if(![raw isKindOfClass:NSData.class]||!raw.length||raw.length>ArtifactResultMax||![request isKindOfClass:NSData.class]||!request.length||request.length>16384||![invocation isKindOfClass:NSData.class]||!invocation.length||invocation.length>16384)ArtifactResultInvalid();
 id d=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
 if(!ArtifactResultKeys(d,@[@"version",@"purpose",@"requestOriginal",@"invocationOriginal",@"manifestOriginal",@"publisherOriginal",@"signatureOriginal",@"actualApprovalRef",@"publisherRegistrationRef",@"publisherRevision",@"publisherKeyVersion"])||![ArtifactResultCanonical(d)isEqual:raw]||![d[@"version"]isEqual:@"YNX-IDE-ARTIFACT-RELEASE-RESULT/v1"]||![d[@"purpose"]isEqual:@"ARTIFACT-RELEASE"])ArtifactResultInvalid();
 if(![ArtifactResultUTF8(d[@"requestOriginal"],16384)isEqual:request]||![ArtifactResultUTF8(d[@"invocationOriginal"],16384)isEqual:invocation]||![ArtifactResultUTF8(d[@"manifestOriginal"],16384)isEqual:invocation])ArtifactResultInvalid();
 id expected=[NSJSONSerialization JSONObjectWithData:request options:0 error:nil],manifest=[NSJSONSerialization JSONObjectWithData:invocation options:0 error:nil];
 if(![expected isKindOfClass:NSDictionary.class]||[expected count]!=17||![expected[@"version"]isEqual:@"YNX-AUTH-IDENTITY/v2"]||![expected[@"purpose"]isEqual:@"AUTH-PROTECTED-KEY-CALL"]||![ArtifactResultCanonical(expected)isEqual:request]||!ArtifactResultKeys(manifest,@[@"projectId",@"version",@"contentDigest",@"publishPurpose",@"targetEnvironment",@"byteSize"])||![ArtifactResultCanonical(manifest)isEqual:invocation])ArtifactResultInvalid();
 NSData*ref=ArtifactResultUTF8(d[@"publisherRegistrationRef"],256);
 if([d[@"publisherRegistrationRef"]rangeOfCharacterFromSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]].location!=NSNotFound||[d[@"publisherRegistrationRef"]rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound||!ArtifactResultUUID(d[@"actualApprovalRef"])||!ArtifactResultU64(d[@"publisherRevision"])||!ArtifactResultU64(d[@"publisherKeyVersion"]))ArtifactResultInvalid();(void)ref;
 ArtifactResultDATA result;result.original=[raw copy];result.publisher=ArtifactResultBase64(d[@"publisherOriginal"],8192);result.member=ArtifactResultBase64(d[@"signatureOriginal"],ArtifactMemberMax);result.metadata=[d copy];return result;
}
}
