#pragma once
#import <Foundation/Foundation.h>
// Exact two-string DATA from the original child, not qualification. Preserve
// duplicate visibility, unlike parsing directly into an NSDictionary.
static NSDictionary*PQSourceReceipt(NSData*data){
 if(!data.length||data.length>16384||![[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding])return nil;
 const unsigned char*b=(const unsigned char*)data.bytes;NSUInteger at=0,n=data.length;
 auto ws=[&](){while(at<n&&(b[at]==' '||b[at]=='\r'||b[at]=='\n'||b[at]=='\t'))at++;};
 auto string=[&]()->NSString*{ws();if(at>=n||b[at]!='"')return nil;NSUInteger start=at++;BOOL done=NO;while(at<n){unsigned char c=b[at++];if(c=='\\'){if(at>=n)return nil;at++;}else if(c=='"'){done=YES;break;}}if(!done)return nil;NSMutableData*array=[NSMutableData dataWithBytes:"[" length:1];[array appendBytes:b+start length:at-start];[array appendBytes:"]" length:1];id v=[NSJSONSerialization JSONObjectWithData:array options:0 error:nil];return [v isKindOfClass:NSArray.class]&&[v count]==1&&[v[0]isKindOfClass:NSString.class]?v[0]:nil;};
 ws();if(at>=n||b[at++]!='{')return nil;NSMutableDictionary*out=[NSMutableDictionary dictionary];
 for(unsigned i=0;i<2;i++){NSString*k=string();if(!k||out[k]||![@[@"catalogPath",@"catalogSha256"]containsObject:k])return nil;ws();if(at>=n||b[at++]!=':')return nil;NSString*v=string();if(!v)return nil;out[k]=v;ws();if(at>=n||b[at++]!=(i==0?',':'}'))return nil;}
 ws();return at==n&&out.count==2?[out copy]:nil;
}
