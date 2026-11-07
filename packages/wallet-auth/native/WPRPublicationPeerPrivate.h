#pragma once
#import <Foundation/Foundation.h>
#include "WPRPublicationReleasePrivate.hpp"
// Existing privileged normal executor/listener only, no new listener/service.
// No user ID, path, audit bytes, signing requirement or approval DTO input.
@interface YNXWPRPublicationPeer:NSObject
+ (instancetype)acceptOriginalConnection:(NSXPCConnection*)connection error:(NSError**)error;
+ (BOOL)isOriginalPeer:(id)peer;
- (BOOL)assertCurrentMessage:(NSError**)error;
- (BOOL)assertOriginalCustodyMessage:(NSError**)error;
- (const ynx::wallet::product::publication::InstallationRelease*)originalRegisteredRelease:(NSError**)error;
- (void)retire;
- (void)close;
@end
