#pragma once
#import <Foundation/Foundation.h>
@class YNXAuthIdentitySourceAuthority;
// Internal Native custody, NOT a JS-selectable path/fd/provider factory.
// A source receipt/DTO is not a YNXAuthIdentitySourceAuthority instance.
@interface YNXOriginalPrivateServiceChannel : NSObject
- (BOOL)acquireOriginalSource:(YNXAuthIdentitySourceAuthority *)source error:(NSError **)error;
// Nonblocking poll. nil/NO with error=nil is idle/partial pending, NOT failure
// or admission. Accepted partial peer/deadline/bytes are retained. Caller must
// serialize bounded timer polls, never busy-spin or redispatch an old effect.
- (NSData *)readOriginalRequest:(NSError **)error;
- (BOOL)writeOriginalResponse:(NSData *)response error:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (BOOL)closeOriginal:(NSError **)error;
@property(nonatomic,readonly) NSError *firstCause;
@property(nonatomic,readonly) NSError *cleanupCause;
@end
