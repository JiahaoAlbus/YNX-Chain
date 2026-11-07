#pragma once
#import "WPRPublicationSourcePrivate.h"
// PUBLIC raw-byte getters only, after the SAME actual Source/current owner.
// Required producer CODE remains the original protected registration capture
// and independent approval/build originals, never a projection-derived brand.
@interface YNXAuthIdentitySourceAuthority(WPRMaterializationRawPrivate)
- (NSData*)copyOriginalWPRRegistrationCapture:(NSError**)error;
- (NSData*)copyOriginalWPRExpectedCaptureInput:(NSError**)error;
- (NSDictionary*)copyOriginalWPRMaterializationCaptureBundle:(NSError**)error;
- (NSDictionary*)copyOriginalWPRMaterializationBuildOriginals:(NSError**)error;
- (NSData*)copyIndependentWPRMaterializationOriginal:(NSError**)error;
@end
