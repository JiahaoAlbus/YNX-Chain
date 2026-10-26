#pragma once
#import <Foundation/Foundation.h>
#include "original-ide-auth-proof-data.h"
static bool SourceProjectText(id v){
 if(![v isKindOfClass:NSString.class]||![v length]||![v canBeConvertedToEncoding:NSUTF8StringEncoding]||[v lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>256||![[v stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]isEqual:v])return false;
 for(NSUInteger i=0;i<[v length];i++){unichar c=[v characterAtIndex:i];if(c<33||c==127)return false;}return true;
}
static bool SourceProjectKeys(id d,NSArray*keys){return [d isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:[d allKeys]]isEqual:[NSSet setWithArray:keys]];}
static bool SourceProjectMS(id v,uint64_t&value){if(![v isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)v)==CFBooleanGetTypeID()||[v doubleValue]<1||[v doubleValue]>9007199254740991.0||[v doubleValue]!=(double)[v unsignedLongLongValue])return false;value=[v unsignedLongLongValue];return true;}
static NSData*SourceProjectBase64(id text){
 if(![text isKindOfClass:NSString.class]||![text length]||[text length]>10923)return nil;
 NSString*s=[[text stringByReplacingOccurrencesOfString:@"-" withString:@"+"]stringByReplacingOccurrencesOfString:@"_" withString:@"/"];if(s.length%4==1)return nil;while(s.length%4)s=[s stringByAppendingString:@"="];NSData*b=[[NSData alloc]initWithBase64EncodedString:s options:0];
 NSString*again=[[[b base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];again=[again stringByReplacingOccurrencesOfString:@"=" withString:@""];return b.length&&b.length<=8192&&[again isEqual:text]?b:nil;
}
// Exact existing R13 DATA frame, not a second signature/grant parser. Actual
// Source verifier independently checks the registered subject key pair.
static NSDictionary*SourceProjectR13(NSData*raw){
 if(!raw||raw.length<4||raw.length>8192)return nil;const uint8_t*p=(const uint8_t*)raw.bytes;size_t at=0;
 auto integer=[&](uint32_t&n){if(at+4>raw.length)return false;n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|p[at++];return true;};uint32_t count=0;if(!integer(count)||count!=13)return nil;
 const size_t caps[]={64,64,64,64,64,32,42,256,256,256,20,2592,64};NSMutableArray*fields=[NSMutableArray array];
 for(size_t cap:caps){uint32_t n=0;if(!integer(n)||!n||n>cap||n>raw.length-at)return nil;[fields addObject:[NSData dataWithBytes:p+at length:n]];at+=n;}if(at!=raw.length||[fields[5]length]!=32||[fields[11]length]!=2592||[fields[12]length]!=64)return nil;
 NSMutableArray*text=[NSMutableArray array];for(NSUInteger i=0;i<fields.count;i++){NSString*s=(i==5||i==11||i==12)?@"binary":[[NSString alloc]initWithData:fields[i]encoding:NSUTF8StringEncoding];if(!s)return nil;[text addObject:s];}
 if(![text[0]isEqual:@"YNX-IDE-ARTIFACT-PUBLISHER/v1"]||![text[1]isEqual:@"YNX-BATCH/v0.1"]||![text[2]isEqual:@"ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"]||![text[3]isEqual:@"ARTIFACT-RELEASE"]||![text[4]isEqual:@"ide-artifact-publisher"])return nil;
 uint64_t version=0;if(!SourceProjectText(text[7])||!SourceProjectText(text[8])||!SourceProjectText(text[9])||!SourceProofU64(text[10],version,true)||![text[6]hasPrefix:@"0x"]||[text[6]length]!=42)return nil;
 for(NSUInteger i=2;i<42;i++){unichar c=[text[6]characterAtIndex:i];if(!((c>='a'&&c<='f')||(c>='0'&&c<='9')))return nil;}
 NSMutableString*network=[NSMutableString string];for(NSUInteger i=0;i<32;i++)[network appendFormat:@"%02x",((const uint8_t*)[fields[5]bytes])[i]];
 return @{@"networkId":network,@"subjectOwner":text[6],@"account":text[7],@"projectId":text[8],@"publisherId":text[9],@"publisherKeyVersion":text[10]};
}
