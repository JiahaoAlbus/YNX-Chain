#pragma once
#import <Foundation/Foundation.h>
#include "original-ide-auth-proof-data.h"
#include "original-ide-parent-prelude.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <limits.h>
namespace ynx_auth_ide_relay_private {
inline bool contextText(id value,NSUInteger cap,bool absolute){
 if(![value isKindOfClass:NSString.class]||![value length]||![value canBeConvertedToEncoding:NSUTF8StringEncoding]||[value lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>cap||[value rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound)return false;
 if(absolute)return [value hasPrefix:@"/"]&&![value isEqual:@"/"]&&[[(NSString*)value stringByStandardizingPath] isEqual:value];
 for(NSUInteger i=0;i<[value length];i++){unichar c=[value characterAtIndex:i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;}return true;
}
inline bool exactKeys(NSDictionary*d,NSArray*keys){return [d isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:d.allKeys]isEqual:[NSSet setWithArray:keys]];}
inline bool localContext(NSDictionary*d){return exactKeys(d,@[@"workspace",@"profile",@"id"])&&contextText(d[@"workspace"],4096,true)&&contextText(d[@"profile"],4096,true)&&contextText(d[@"id"],128,false);}
inline bool actualLaunch(NSDictionary*launch,NSDictionary*scope,NSDictionary*context,const ynx_auth_ide_private::ProcessOriginal&node){
 if(!localContext(context)||!exactKeys(launch,@[@"projectId",@"projectGeneration",@"localProjectId",@"workspace",@"profile",@"node"])||![launch[@"projectId"]isEqual:scope[@"projectId"]]||![launch[@"projectGeneration"]isEqual:scope[@"projectGeneration"]]||![launch[@"localProjectId"]isEqual:context[@"id"]])return false;
 NSDictionary*n=launch[@"node"];NSArray*keys=@[@"pid",@"parent",@"uid",@"gid",@"startSeconds",@"startMicros"];if(!exactKeys(n,keys))return false;
 const uint64_t values[]={node.pid,node.parent,node.uid,node.gid,node.startSeconds,node.startMicros};
 for(NSUInteger i=0;i<keys.count;i++){uint64_t value=0;if(!SourceProofU64(n[keys[i]],value)||value!=values[i])return false;}
 for(NSString*k in @[@"workspace",@"profile"]){NSDictionary*d=launch[k];uint64_t dev=0,ino=0;
  if(!exactKeys(d,@[@"path",@"device",@"inode"])||!contextText(d[@"path"],4096,true)||![d[@"path"]isEqual:context[k]]||!SourceProofU64(d[@"device"],dev)||!SourceProofU64(d[@"inode"],ino,true))return false;
 }return true;
}
inline bool namedDirectory(NSString*path,const struct stat&original,int fd){
 char canonical[PATH_MAX];struct stat held{},named{};
 return path&&realpath(path.fileSystemRepresentation,canonical)&&[path isEqual:[NSString stringWithUTF8String:canonical]]&&!fstat(fd,&held)&&!lstat(path.fileSystemRepresentation,&named)&&S_ISDIR(held.st_mode)&&S_ISDIR(named.st_mode)&&held.st_nlink>0&&held.st_dev==original.st_dev&&held.st_ino==original.st_ino&&held.st_uid==original.st_uid&&held.st_gid==original.st_gid&&held.st_mode==original.st_mode&&named.st_dev==held.st_dev&&named.st_ino==held.st_ino&&named.st_uid==held.st_uid&&named.st_gid==held.st_gid&&named.st_mode==held.st_mode;
}
}
