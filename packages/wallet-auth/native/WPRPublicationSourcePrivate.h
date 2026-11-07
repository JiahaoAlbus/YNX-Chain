#pragma once
#import "original-auth-identity-source-authority.h"
#import "WPRPublicationPeerPrivate.h"
#include "WPRStagedOriginalsPrivate.hpp"
// Only the dedicated private WPR receiver uses these methods. No public
// product read/native permission is minted by this publication source owner.
@interface YNXAuthIdentitySourceAuthority(WPRPublicationPrivate)
+ (instancetype)acquireOriginalWPRPublicationForPeer:(YNXWPRPublicationPeer*)peer error:(NSError**)error;
- (NSDictionary*)copyOriginalWPRPublicationOriginals:(NSError**)error;
- (BOOL)closeOriginalWPRPublicationSource:(NSError**)error;
- (BOOL)originalWPRPublicationPhysicallyClosed;
@end
