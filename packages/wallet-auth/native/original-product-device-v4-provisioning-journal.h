#pragma once
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
namespace ynx_auth_private {
// Independently signed EXISTING namespace; no guessed inode, mkdir or reset.
static inline bool originalProvisioningDeviceV4JournalCurrent(NSDictionary*s){
 NSDictionary*j=s[@"originalProvisioningJournal"];NSString*parent=s[@"originalHostTerminalDirectory"],*stable=s[@"productSessionDeviceV4Provisioning"][@"nativeIntentDATA"][@"stableDeviceIdentity"];
 if(![j isKindOfClass:NSDictionary.class]||j.count!=2||![parent isKindOfClass:NSString.class]||![stable isKindOfClass:NSString.class])return false;
 NSData*b=[stable dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||b.length>1024)return false;unsigned char h[32];CC_SHA256(b.bytes,(CC_LONG)b.length,h);NSMutableString*hex=[NSMutableString new];for(auto c:h)[hex appendFormat:@"%02x",c];
 NSArray*paths=@[parent,[parent stringByAppendingPathComponent:[@"device-v4-provisioning-" stringByAppendingString:hex]]];
 for(unsigned i=0;i<2;i++){NSDictionary*t=j[i?@"directory":@"parent"];if(![t isKindOfClass:NSDictionary.class]||t.count!=5||![[NSSet setWithArray:t.allKeys]isEqual:[NSSet setWithArray:@[@"device",@"inode",@"uid",@"gid",@"mode"]]])return false;NSString*p=paths[i];struct stat st{};char real[PATH_MAX];if(lstat(p.fileSystemRepresentation,&st)||!S_ISDIR(st.st_mode)||!realpath(p.fileSystemRepresentation,real)||strcmp(real,p.fileSystemRepresentation)||st.st_uid!=getuid()||(st.st_mode&07777)!=0700)return false;if(![t[@"device"]isEqual:[NSString stringWithFormat:@"%llu",(unsigned long long)st.st_dev]]||![t[@"inode"]isEqual:[NSString stringWithFormat:@"%llu",(unsigned long long)st.st_ino]]||![t[@"uid"]isEqual:@(st.st_uid)]||![t[@"gid"]isEqual:@(st.st_gid)]||![t[@"mode"]isEqual:@448])return false;}
 return true;
}
}
