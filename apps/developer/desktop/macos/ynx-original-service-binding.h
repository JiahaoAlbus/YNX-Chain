#import <Foundation/Foundation.h>

// Local custody of the exact bytes being dispatched. This is NOT a Wallet,
// Root, project or executor capability and cannot manufacture a Native borrow.
@interface YNXOriginalServiceRequest : NSObject
@property(nonatomic,readonly) NSString *raw;
@property(nonatomic,readonly) NSString *requestID;
@property(nonatomic,readonly) NSString *operation;
@property(nonatomic,readonly) NSString *phase;
+ (instancetype)captureCanonicalInput:(NSString *)raw error:(NSError **)error;
@end

// Node only receives its owning module's opaque reference. The original Cocoa
// guard and the Wallet/Vault remain in their actual processes. No pointer,
// descriptor, provider callback or renderer DTO is a qualified Native reference.
