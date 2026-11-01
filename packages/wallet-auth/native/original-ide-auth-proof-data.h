#pragma once
#import <Foundation/Foundation.h>
#include <cstdint>
#include <climits>
static NSData *SourceProofCanonical(id value){return [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];}
static NSDictionary *SourceProofDictionary(NSData *raw,NSUInteger maximum){
 if(![raw isKindOfClass:NSData.class]||!raw.length||raw.length>maximum)return nil;
 id value=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
 return [value isKindOfClass:NSDictionary.class]&&[SourceProofCanonical(value)isEqual:raw]?value:nil;
}
static bool SourceProofHex(id text,NSUInteger n=64){
 if(![text isKindOfClass:NSString.class]||[text length]!=n)return false;
 for(NSUInteger i=0;i<n;i++){unichar c=[text characterAtIndex:i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;}return true;
}
static bool SourceProofU64(id text,uint64_t&out,bool positive=false){
 if(![text isKindOfClass:NSString.class]||![text length]||[text length]>20||([text length]>1&&[text characterAtIndex:0]=='0'))return false;
 uint64_t n=0;for(NSUInteger i=0;i<[text length];i++){unichar c=[text characterAtIndex:i];if(c<'0'||c>'9'||n>(UINT64_MAX-(c-'0'))/10)return false;n=n*10+c-'0';}if(positive&&!n)return false;out=n;return true;
}
static bool SourceProofPurpose(id text){return [@[@"AUTH-IDENTITY-RECEIVE",@"AUTH-IDENTITY-RECOVER",@"AUTH-PROTECTED-KEY-CALL"]containsObject:text];}
static bool SourceProofBoolean(id value,bool expected){return value&&CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID()&&[value boolValue]==expected;}
