#pragma once
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include <cmath>
namespace ynx_auth_private {
// Actual signed profile uses JSON numbers, not SourceProofU64's canonical
// decimal STRING contract. Reject bool/fraction/negative/unsafe JS integer.
static inline bool originalQueryProfileNumberU64(id value,uint64_t&out){
 if(![value isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID())return false;
 double n=[value doubleValue];if(!std::isfinite(n)||n<0||n>9007199254740991.0||std::floor(n)!=n)return false;out=(uint64_t)n;return true;
}
static inline NSDictionary* originalQueryDeviceV4JournalObserve(NSDictionary*s){
 NSDictionary*q=s[@"productSessionDeviceV4Query"],*binding=q[@"identityBinding"];if(![q isKindOfClass:NSDictionary.class]||![binding isKindOfClass:NSDictionary.class]||binding.count!=12)return nil;
 for(NSString*k in @[@"networkId",@"canonicalOwner",@"account",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"deviceId"]){id v=binding[k];if(([@[@"bundleId",@"packageId"]containsObject:k]&&v==NSNull.null))continue;if(![v isKindOfClass:NSString.class])return nil;}
 // c808 query Root signs the original protected PARENT PATH and exact query
 // identity, NOT a provisioning inode tuple. These are read-only observed
 // OS facts pinned by the same Source and then actual reader dirfds; never
 // mislabel them signed or add an unsupported profile field.
 NSString*parent=s[@"originalHostTerminalDirectory"],*stable=q[@"stableDeviceIdentity"];if(![parent isKindOfClass:NSString.class]||![parent hasPrefix:@"/"]||parent.length>4096||![stable isKindOfClass:NSString.class])return nil;
 NSData*b=[stable dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||b.length>1024)return nil;unsigned char h[32];CC_SHA256(b.bytes,(CC_LONG)b.length,h);NSMutableString*hex=[NSMutableString new];for(auto v:h)[hex appendFormat:@"%02x",v];
 NSArray*paths=@[parent,[parent stringByAppendingPathComponent:[@"device-v4-provisioning-" stringByAppendingString:hex]]];NSMutableDictionary*observed=[NSMutableDictionary new];
 for(unsigned i=0;i<2;i++){NSString*p=paths[i];struct stat st{};char real[PATH_MAX];if(lstat(p.fileSystemRepresentation,&st)||!S_ISDIR(st.st_mode)||!realpath(p.fileSystemRepresentation,real)||strcmp(real,p.fileSystemRepresentation)||st.st_uid!=getuid()||(st.st_mode&07777)!=0700)return nil;observed[i?@"directory":@"parent"]=@{@"device":[NSString stringWithFormat:@"%llu",(unsigned long long)st.st_dev],@"inode":[NSString stringWithFormat:@"%llu",(unsigned long long)st.st_ino],@"uid":@(st.st_uid),@"gid":@(st.st_gid),@"mode":@448};}
 return [observed copy];
}
}
