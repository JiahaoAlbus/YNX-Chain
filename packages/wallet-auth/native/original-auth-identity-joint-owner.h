#import <Foundation/Foundation.h>

// Private Auth implementation ABI, not a public approval/profile schema.
// Raw custody and current reads alone NEVER qualify an executor or Root.
@interface YNXAuthIdentityCurrentOwner : NSObject
+ (instancetype)acquireOriginalAdministrationProfile:(NSError **)error;
- (NSData *)copyOriginalProfile:(NSError **)error;
- (NSData *)copyOriginalHead:(NSError **)error;
- (BOOL)assertOriginalCurrent:(NSError **)error;
- (BOOL)assertIndependentNativePurposeAdmission:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@property(nonatomic,readonly) BOOL nativeQualified;
@property(nonatomic,readonly) BOOL cleanupComplete;
@end
