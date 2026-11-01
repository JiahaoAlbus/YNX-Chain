#import "ide-original-session-store-private.h"
#import <Security/Security.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#include <pthread.h>

namespace {
NSError *failure(NSString *code) { return [NSError errorWithDomain:@"YNXIDEOriginalSessionRead" code:1 userInfo:@{NSLocalizedDescriptionKey:code}]; }
NSString *canonical(id v) {
 if([v isKindOfClass:NSDictionary.class]){NSMutableArray *a=[NSMutableArray new];for(id k in [[v allKeys] sortedArrayUsingSelector:@selector(compare:)]){if(![k isKindOfClass:NSString.class])return nil;NSString *x=canonical(k),*y=canonical(v[k]);if(!x||!y)return nil;[a addObject:[NSString stringWithFormat:@"%@:%@",x,y]];}return [NSString stringWithFormat:@"{%@}",[a componentsJoinedByString:@","]];}
 if([v isKindOfClass:NSArray.class]){NSMutableArray *a=[NSMutableArray new];for(id c in v){NSString *x=canonical(c);if(!x)return nil;[a addObject:x];}return [NSString stringWithFormat:@"[%@]",[a componentsJoinedByString:@","]];}
 if(v!=NSNull.null&&![v isKindOfClass:NSString.class])return nil;
 NSData *d=[NSJSONSerialization dataWithJSONObject:v options:NSJSONWritingFragmentsAllowed|NSJSONWritingWithoutEscapingSlashes error:nil];return d?[[NSString alloc]initWithData:d encoding:NSUTF8StringEncoding]:nil;
}
bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink;}
bool validLock(const struct stat&s,const YNXIDEOriginalSessionStoreReference&r){return S_ISREG(s.st_mode)&&s.st_nlink==1&&s.st_dev==r.lockDevice&&s.st_ino==r.lockInode&&s.st_uid==r.ownerUID&&s.st_gid==r.ownerGID&&(s.st_mode&0777)==0600;}
// PUBLIC test variant replaces this function at compile time, never a runtime
// setter. Production always reads the real existing Keychain service/account.
NSString *readProtected(NSString *service,NSString *key,NSError **error) {
#ifdef YNX_IDE_PUBLIC_STORE_CONTROLS
 extern NSString *YNXIDEPublicReadProtected(NSString *,NSString *,NSError **);
 return YNXIDEPublicReadProtected(service,key,error);
#else
 NSDictionary *q=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:service,(__bridge id)kSecAttrAccount:key,(__bridge id)kSecReturnData:@YES,(__bridge id)kSecMatchLimit:(__bridge id)kSecMatchLimitOne};
 CFTypeRef result=nullptr;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)q,&result);NSData *d=CFBridgingRelease(result);
 if(status==errSecItemNotFound)return nil;
 if(status!=errSecSuccess||![d isKindOfClass:NSData.class]||d.length>1048576){if(error)*error=failure(@"IDE_ORIGINAL_STORE_READ_UNAVAILABLE");return nil;}
 NSString *raw=[[NSString alloc]initWithData:d encoding:NSUTF8StringEncoding];if(!raw&&error)*error=failure(@"IDE_ORIGINAL_STORE_UTF8_INVALID");return raw;
#endif
}
int closeOriginal(int fd){
#ifdef YNX_IDE_PUBLIC_STORE_CONTROLS
 extern int YNXIDEPublicClose(int);return YNXIDEPublicClose(fd);
#else
 return close(fd);
#endif
}
}

@implementation YNXIDEOriginalSessionStoreRead {
 YNXIDEOriginalSessionStoreReference _ref;int _fd;struct stat _held;pthread_t _thread;
 NSMutableDictionary<NSString *,NSData *> *_parents;
 NSString *_base,*_revoke;NSError *_first;BOOL _retired,_closed,_closeSelected;
 unsigned _active;
}
- (BOOL)reject:(NSError *)cause out:(NSError **)out {if(!_first)_first=cause?:failure(@"IDE_ORIGINAL_STORE_UNKNOWN");_retired=YES;if(out)*out=_first;return NO;}
+ (instancetype)holdOriginal:(const YNXIDEOriginalSessionStoreReference &)r error:(NSError **)error {
 YNXIDEOriginalSessionStoreRead *o=[self new];o->_fd=-1;o->_thread=pthread_self();o->_ref=r;o->_ref.service=[r.service copy];o->_ref.baseKey=[r.baseKey copy];o->_ref.existingLockPath=[r.existingLockPath copy];
 o->_parents=[NSMutableDictionary new];
 if(!r.service.length||r.service.length>512||!r.baseKey.length||r.baseKey.length>512||![r.existingLockPath hasPrefix:@"/"]||r.ownerUID!=getuid()){[o reject:failure(@"IDE_ORIGINAL_STORE_REFERENCE_INVALID") out:error];return o;}
 char *p=realpath(r.existingLockPath.fileSystemRepresentation,nullptr);BOOL path=p&&[r.existingLockPath isEqual:[NSString stringWithUTF8String:p]];if(p)free(p);
 struct stat before;if(!path||lstat(r.existingLockPath.fileSystemRepresentation,&before)||!validLock(before,r)){[o reject:failure(@"IDE_ORIGINAL_STORE_LOCK_NOT_CURRENT") out:error];return o;}
 for(NSString *parent=[r.existingLockPath stringByDeletingLastPathComponent];;parent=[parent stringByDeletingLastPathComponent]){struct stat s;if(lstat(parent.fileSystemRepresentation,&s)||!S_ISDIR(s.st_mode)){[o reject:failure(@"IDE_ORIGINAL_STORE_PARENT_INVALID") out:error];return o;}o->_parents[parent]=[NSData dataWithBytes:&s length:sizeof(s)];if([parent isEqual:@"/"])break;}
 o->_fd=open(r.existingLockPath.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);
 if(o->_fd<0||fstat(o->_fd,&o->_held)||!same(before,o->_held)||flock(o->_fd,LOCK_SH|LOCK_NB)){[o reject:failure(@"IDE_ORIGINAL_STORE_LOCK_UNAVAILABLE") out:error];return o;}
 NSError *e=nil;o->_base=[readProtected(r.service,r.baseKey,&e) copy];if(e){[o reject:e out:error];return o;}
 o->_revoke=[readProtected(r.service,[r.baseKey stringByAppendingString:@":revoke"],&e) copy];if(e){[o reject:e out:error];return o;}
 if(![o assertCurrent:&e]){if(error)*error=e;return o;}return o;
}
- (BOOL)assertCurrent:(NSError **)error {
 if(!pthread_equal(_thread,pthread_self())){if(error)*error=failure(@"IDE_ORIGINAL_STORE_FOREIGN_THREAD");return NO;}
 if(_retired||_closed||_closeSelected){if(error)*error=_first?:failure(@"IDE_ORIGINAL_STORE_RETIRED");return NO;}
 _active++;@try {
 for(NSString *p in _parents){struct stat old,s;[_parents[p] getBytes:&old length:sizeof(old)];if(lstat(p.fileSystemRepresentation,&s)||!S_ISDIR(s.st_mode)||old.st_dev!=s.st_dev||old.st_ino!=s.st_ino||old.st_uid!=s.st_uid||old.st_gid!=s.st_gid||old.st_mode!=s.st_mode)return [self reject:failure(@"IDE_ORIGINAL_STORE_PARENT_CHANGED") out:error];}
 struct stat a,b;if(_fd<0||fstat(_fd,&a)||lstat(_ref.existingLockPath.fileSystemRepresentation,&b)||!validLock(a,_ref)||!same(_held,a)||!same(a,b))return [self reject:failure(@"IDE_ORIGINAL_STORE_LOCK_SUBSTITUTED") out:error];
 NSError *e=nil;NSString *base=readProtected(_ref.service,_ref.baseKey,&e);if(e)return [self reject:e out:error];
 NSString *revoke=readProtected(_ref.service,[_ref.baseKey stringByAppendingString:@":revoke"],&e);if(e)return [self reject:e out:error];
 if(!((base==nil&&_base==nil)||[base isEqual:_base])||!((revoke==nil&&_revoke==nil)||[revoke isEqual:_revoke]))return [self reject:failure(@"IDE_ORIGINAL_STORE_CHANGED") out:error];
 // Final physical check after external Keychain calls; no output on late drift.
 if(_retired||_closed||fstat(_fd,&a)||lstat(_ref.existingLockPath.fileSystemRepresentation,&b)||!same(_held,a)||!same(a,b))return [self reject:failure(@"IDE_ORIGINAL_STORE_LATE_CHANGE") out:error];
 return YES;
 }@finally{_active--;}
}
- (NSString *)readOriginal:(NSString *)key error:(NSError **)error {
 if(![key isEqual:_ref.baseKey]&&![key isEqual:[_ref.baseKey stringByAppendingString:@":revoke"]]){if(error)*error=failure(@"IDE_ORIGINAL_STORE_KEY_DENIED");return nil;}
 if(![self assertCurrent:error])return nil;
 NSString *result=nil;id v=_base?[NSJSONSerialization JSONObjectWithData:[_base dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingFragmentsAllowed error:nil]:nil;
 if([v isKindOfClass:NSDictionary.class]&&v[@"format"]){
  // Reuse P03's EXISTING atomic container exactly. Unknown format/metadata is
  // not migrated. Contents remain DATA for sole SDK V4/session verification.
  NSSet *keys=[NSSet setWithArray:[v allKeys]];
  if(![keys isEqual:[NSSet setWithArray:@[@"format",@"migration",@"records"]]]||![v[@"format"] isEqual:@"ynx-developer-protected-state/v1"]||![v[@"migration"] isEqual:@"legacy-v2-snapshot-v1"]||![v[@"records"] isKindOfClass:NSDictionary.class]||![canonical(v) isEqual:_base]){[self reject:failure(@"IDE_ORIGINAL_STORE_CONTAINER_UNSUPPORTED") out:error];return nil;}
  result=v[@"records"][key];
 }else result=[key isEqual:_ref.baseKey]?_base:_revoke;
 if(result&&(![result isKindOfClass:NSString.class]||[result lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>16384)){[self reject:failure(@"IDE_ORIGINAL_STORE_RECORD_INVALID") out:error];return nil;}
 NSString *owned=[result copy];return [self assertCurrent:error]?owned:nil;
}
- (void)retire {if(!pthread_equal(_thread,pthread_self()))@throw failure(@"IDE_ORIGINAL_STORE_FOREIGN_THREAD");_retired=YES;}
- (BOOL)revocationRequested {NSError *e=nil;NSString *raw=[self readOriginal:[_ref.baseKey stringByAppendingString:@":revoke"] error:&e];return e!=nil||raw!=nil;}
- (BOOL)join:(NSError **)error {if(!pthread_equal(_thread,pthread_self())||_active){if(error)*error=failure(@"IDE_ORIGINAL_STORE_DRAIN_PENDING");return NO;}return YES;}
- (BOOL)close:(NSError **)error {
 if(_closed)return YES;
 if(!pthread_equal(_thread,pthread_self())){if(error)*error=failure(@"IDE_ORIGINAL_STORE_FOREIGN_THREAD");return NO;}
 if(_active){_retired=YES;if(error)*error=failure(@"IDE_ORIGINAL_STORE_DRAIN_PENDING");return NO;}
 if(_closeSelected){if(error)*error=_first?:failure(@"IDE_ORIGINAL_STORE_CLOSE_UNKNOWN");return NO;}
 _retired=YES;_closeSelected=YES;
 if(_fd>=0&&closeOriginal(_fd)){[self reject:failure(@"IDE_ORIGINAL_STORE_CLOSE_UNKNOWN") out:error];return NO;}
 _fd=-1;_closed=YES;return YES;
}
- (BOOL)closed{return _closed;}
- (NSError *)firstCause{return _first;}
- (void)dealloc {if(!_closed)abort();}
@end
