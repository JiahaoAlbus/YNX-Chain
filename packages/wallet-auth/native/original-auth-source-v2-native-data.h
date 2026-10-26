#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
// DATA hints only. Sole SDK under same Native root/node/runtime pins verifies.
static NSDictionary *SourceOriginalBodyHint(NSData *raw){
 if(![raw isKindOfClass:NSData.class]||!raw.length||raw.length>393216)return nil;
 id envelope=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];if(![envelope isKindOfClass:NSDictionary.class])return nil;
 id body=envelope[@"body"];
 if([body isKindOfClass:NSDictionary.class]&&![envelope[@"version"]isEqual:@2])return body;
 if(![envelope[@"version"]isEqual:@2]||![envelope[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||![body isKindOfClass:NSString.class]||![body length]||[body length]>87384)return nil;
 NSString*base64=[[body stringByReplacingOccurrencesOfString:@"-" withString:@"+"]stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
 if(base64.length%4==1)return nil;while(base64.length%4)base64=[base64 stringByAppendingString:@"="];
 NSData*bytes=[[NSData alloc]initWithBase64EncodedString:base64 options:0];if(!bytes.length||bytes.length>65536)return nil;
 NSString*again=[[[[bytes base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""];
 if(![again isEqual:body])return nil;
 id decoded=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];return [decoded isKindOfClass:NSDictionary.class]?decoded:nil;
}
#endif
