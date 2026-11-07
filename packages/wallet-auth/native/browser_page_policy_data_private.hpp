#pragma once
#import <Foundation/Foundation.h>
#include "browser_page_source_release_private.hpp"
#include <unistd.h>
/* Native DATA producer used by the ORIGINAL Source core before its actual sole
 * SDK mathematical verifier. Shape is not verification/admission and this is
 * not a second wire/signature codec. Exact frames come from the independent row. */
static inline NSDictionary *YNXOriginalBrowserSourcePolicyDATA(const ynx::browser::page::BrowserPageSourceRelease&p){
 if(p.source.purpose!="browser-selected-pages-source-v1"||p.application_id!="com.ynxweb4.browser.macos"||
    p.product_id!="browser"||p.platform!="macos"||p.uid!=getuid())return nil;
 auto str=[](const std::string&v)->NSString*{
  if(v.empty()||v.find('\0')!=std::string::npos)return nil;
  return [[NSString alloc]initWithBytes:v.data() length:v.size() encoding:NSUTF8StringEncoding];
 };
 NSString*root=str(p.source.rootDigest),*enrollment=str(p.source.enrollmentDigest),*endpoint=str(p.source.endpoint),*spki=str(p.source.spki),
 *ef=str(p.source.enrollmentFrame),*pf=str(p.source.profileFrame),*cf=str(p.source.currentFrame);
 if(!root||!enrollment||!endpoint||!spki||!ef||!pf||!cf)return nil;
 return @{@"rootDigest":root,@"enrollmentDigest":enrollment,@"endpoint":endpoint,@"spki":spki,
  @"signatureContract":@{@"purpose":@"browser-selected-pages-source-v1",@"enrollmentFrame":ef,@"profileFrame":pf,@"currentFrame":cf},
  @"applicationId":@"com.ynxweb4.browser.macos",@"productId":@"browser",@"platform":@"macos"};
}
