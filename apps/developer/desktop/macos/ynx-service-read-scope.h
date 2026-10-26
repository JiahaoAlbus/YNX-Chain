#pragma once
#import <Foundation/Foundation.h>
// DATA predicates only. The Cocoa caller must hold the real typed observer and
// obtain a fresh native sheet approval; none of these functions create Source.
static BOOL YNXServiceReadSessionMatches(NSDictionary *data,NSDictionary *session){
 NSDictionary *p=data[@"principal"],*project=data[@"project"],*r=data[@"serviceRegistration"];
 if(![p isKindOfClass:NSDictionary.class]||![project isKindOfClass:NSDictionary.class]||![r isKindOfClass:NSDictionary.class]||![project[@"read"]isEqual:@YES]||CFGetTypeID((__bridge CFTypeRef)project[@"read"])!=CFBooleanGetTypeID()||![r[@"version"]isEqual:@"YNX-IDE-SERVICE-REGISTRATION/v1"]||![r[@"revoked"]isEqual:@NO]||CFGetTypeID((__bridge CFTypeRef)r[@"revoked"])!=CFBooleanGetTypeID()||![r[@"projectId"]isEqual:project[@"projectId"]]||![r[@"account"]isEqual:p[@"account"]])return NO;
 for(NSString *key in @[@"account",@"deviceId"])if(![p[key]isKindOfClass:NSString.class]||![p[key]isEqual:session[key]])return NO;
 if(![p[@"sessionRef"]isKindOfClass:NSString.class]||![p[@"sessionRef"]isEqual:session[@"sessionBinding"]])return NO;
 NSArray *scopes=r[@"scopes"],*approved=session[@"scopes"];
 return [scopes isKindOfClass:NSArray.class]&&scopes.count>0&&scopes.count<=8&&[approved isKindOfClass:NSArray.class]&&[[NSSet setWithArray:scopes]count]==scopes.count&&[[NSSet setWithArray:scopes]isSubsetOfSet:[NSSet setWithArray:approved]];
}
static NSArray *YNXServiceReadPaths(NSDictionary *data,NSString *requestID){
 if(![requestID isKindOfClass:NSString.class]||![[[NSUUID alloc]initWithUUIDString:requestID].UUIDString.lowercaseString isEqual:requestID])return nil;
 NSString *endpoint=data[@"serviceRegistration"][@"apiEndpoint"];
 if(![endpoint isKindOfClass:NSString.class]||endpoint.length>2048)return nil;
 NSURLComponents *parts=[NSURLComponents componentsWithString:endpoint];
 if(![parts.scheme isEqual:@"https"]||!parts.host.length||parts.user||parts.password||parts.port||parts.query||parts.fragment||![parts.URL.absoluteString isEqual:endpoint])return nil;
 NSString *base=parts.percentEncodedPath?:@"";
 if([base containsString:@"%"]||[base containsString:@"\\"]||[base containsString:@"//"])return nil;
 for(NSString *segment in [base componentsSeparatedByString:@"/"])if([segment isEqual:@"."]||[segment isEqual:@".."])return nil;
 while([base hasSuffix:@"/"])base=[base substringToIndex:base.length-1];
 if(![base hasSuffix:@"/api/v1"])base=[base stringByAppendingString:@"/api/v1"];
 NSString *status=[base stringByAppendingFormat:@"/ide/deployments/%@",requestID];
 return @[status,[status stringByAppendingString:@"/logs"]];
}

