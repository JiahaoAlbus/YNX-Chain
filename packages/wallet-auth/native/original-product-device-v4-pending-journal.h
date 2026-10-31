#pragma once
#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
namespace ynx_auth_private {
// Observed existing identities are authenticated by the pending Source profile.
// No creation, reset, recovery grant, mutable mtime or guessed future inode.
static inline bool originalPendingDeviceV4JournalCurrent(NSDictionary*s){
 NSDictionary*j=s[@"originalPendingDeviceJournal"];
 if(![j isKindOfClass:NSDictionary.class]||j.count!=2)return false;
 NSString*p=s[@"originalHostTerminalDirectory"],*d=s[@"productSessionDeviceV4Pending"][@"expected"][@"registrationDigest"];
 if(![p isKindOfClass:NSString.class]||![d isKindOfClass:NSString.class]||d.length!=64||[d rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]invertedSet]].location!=NSNotFound)return false;
 NSArray*paths=@[p,[p stringByAppendingPathComponent:[@"device-v4-pending-" stringByAppendingString:d]]];
 for(unsigned i=0;i<2;i++){
  NSDictionary*t=j[i?@"directory":@"parent"];if(![t isKindOfClass:NSDictionary.class]||t.count!=5)return false;
  NSSet*keys=[NSSet setWithArray:@[@"device",@"inode",@"uid",@"gid",@"mode"]];if(![[NSSet setWithArray:t.allKeys]isEqual:keys])return false;
  NSString*path=paths[i];struct stat st{};char resolved[PATH_MAX];
  if(lstat(path.fileSystemRepresentation,&st)||!S_ISDIR(st.st_mode)||!realpath(path.fileSystemRepresentation,resolved)||strcmp(resolved,path.fileSystemRepresentation)||st.st_uid!=getuid()||(st.st_mode&07777)!=0700)return false;
  if(![t[@"device"]isEqual:[NSString stringWithFormat:@"%llu",(unsigned long long)st.st_dev]]||![t[@"inode"]isEqual:[NSString stringWithFormat:@"%llu",(unsigned long long)st.st_ino]]||![t[@"uid"]isEqual:@(st.st_uid)]||![t[@"gid"]isEqual:@(st.st_gid)]||![t[@"mode"]isEqual:@448])return false;
 }
 return true;
}
}
