#pragma once
#include "original-ide-project-authority-data.h"
// DATA shape/binding only. Actual Source/profile/custody/current is independently
// required by the owning Native method; this helper cannot approve any caller.
static bool SourceProjectServiceRegistration(id value,NSDictionary*principal,NSString*project,uint64_t now,uint64_t&expires){
 if(!SourceProjectKeys(value,@[@"version",@"registrationId",@"revision",@"currentReference",@"serviceInstanceId",@"projectId",@"account",@"apiEndpoint",@"tlsSPKISHA256",@"audience",@"productId",@"clientId",@"scopes",@"issuedAtMs",@"expiresAtMs",@"revoked"])||![value[@"version"]isEqual:@"YNX-IDE-SERVICE-REGISTRATION/v1"]||![value[@"account"]isEqual:principal[@"account"]]||![value[@"projectId"]isEqual:project]||!SourceProofBoolean(value[@"revoked"],false)||!SourceProofHex(value[@"tlsSPKISHA256"]))return false;
 for(NSString*k in @[@"registrationId",@"currentReference",@"serviceInstanceId",@"projectId",@"account",@"audience",@"productId",@"clientId"])if(!SourceProjectText(value[k]))return false;
 uint64_t revision=0,issued=0,principalExpires=0;
 if(!SourceProofU64(value[@"revision"],revision,true)||!SourceProjectMS(value[@"issuedAtMs"],issued)||!SourceProjectMS(value[@"expiresAtMs"],expires)||!SourceProjectMS(principal[@"expiresMS"],principalExpires)||issued>now||expires<=issued||now>=expires||now>=principalExpires)return false;
 NSString*endpoint=value[@"apiEndpoint"];if(![endpoint isKindOfClass:NSString.class]||!endpoint.length||endpoint.length>2048)return false;
 NSURLComponents*u=[NSURLComponents componentsWithString:endpoint];
 if(![u.scheme isEqual:@"https"]||!u.host.length||u.user||u.password||u.port||u.query||u.fragment||![u.string isEqual:endpoint]||[u.percentEncodedPath rangeOfString:@"%"].location!=NSNotFound||[u.path rangeOfString:@"//"].location!=NSNotFound)return false;
 for(NSString*component in [u.path componentsSeparatedByString:@"/"])if([component isEqual:@"."]||[component isEqual:@".."])return false;
 id scopes=value[@"scopes"];if(![scopes isKindOfClass:NSArray.class]||![scopes count]||[scopes count]>8)return false;
 NSString*previous=nil;for(id scope in scopes){if(!SourceProjectText(scope)||[scope lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>64||(previous&&[previous compare:scope]!=NSOrderedAscending))return false;previous=scope;}
 return true;
}
