#pragma once
#import <Foundation/Foundation.h>
#include "ai_task_client_source_release_private.hpp"
#include <unistd.h>
static inline bool YNXAITaskExact(NSDictionary*v,NSArray<NSString*>*keys){return[v isKindOfClass:NSDictionary.class]&&v.count==keys.count&&[[NSSet setWithArray:v.allKeys]isEqual:[NSSet setWithArray:keys]];}
static inline NSDictionary*YNXOriginalAITaskClientPolicyDATA(const ynx::ai::client::SourceRelease&p){
 if(p.uid!=getuid()||p.source.purpose!="ai-native-task-action-source-v6"||p.product_id!="ai"||p.application_id!="com.ynxweb4.ai"||(p.platform!="ios"&&p.platform!="android"))return nil;
 auto str=[](const std::string&s)->NSString*{if(s.empty()||s.find('\0')!=std::string::npos)return nil;return[[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];};
 NSString*r=str(p.source.rootDigest),*e=str(p.source.enrollmentDigest),*ep=str(p.source.endpoint),*spki=str(p.source.spki),*ef=str(p.source.enrollmentFrame),*pf=str(p.source.profileFrame),*cf=str(p.source.currentFrame),*platform=str(p.platform);
 if(!r||!e||!ep||!spki||!ef||!pf||!cf||!platform)return nil;
 return@{@"rootDigest":r,@"enrollmentDigest":e,@"endpoint":ep,@"spki":spki,@"signatureContract":@{@"purpose":@"ai-native-task-action-source-v6",@"enrollmentFrame":ef,@"profileFrame":pf,@"currentFrame":cf},@"applicationId":@"com.ynxweb4.ai",@"productId":@"ai",@"platform":platform,@"sourceRole":@"client"};
}
