#pragma once
#import <Foundation/Foundation.h>
// Internal owning implementation; NAPI registry recognizes the exact object.
// No caller may import a DTO/descriptor/Source pointer as a delivery owner.
@class YNXAuthIdentitySourceAuthority;
@interface YNXOriginalIDENodeDelivery : NSObject
- (BOOL)acquireActualEntry:(NSString *)entryFileURL error:(NSError **)error;
- (BOOL)assertCurrentExpected:(NSDictionary *)expectedOrNil error:(NSError **)error;
- (BOOL)closeOriginal:(NSError **)error;
// Internal borrowed references only; Source/current + actual once Node delivery.
- (YNXAuthIdentitySourceAuthority *)borrowOriginalPrivateClientSource:(NSError **)error;
- (NSDictionary *)copyOriginalPrivateClientSelection:(NSError **)error;
@property(nonatomic,readonly) int descriptor;
@property(nonatomic,readonly) id firstCause;
@end
