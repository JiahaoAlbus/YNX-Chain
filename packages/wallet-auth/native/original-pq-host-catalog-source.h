#pragma once
#import <Foundation/Foundation.h>
// Private original Source channel; raw/context DATA, Go receipts and ordinary
// signing permission cannot construct this owner or borrow its purpose.
@interface YNXOriginalPQHostCatalogSource:NSObject
+ (instancetype)acquire:(NSError **)error;
- (BOOL)assertCurrentForJournal:(NSDictionary *)journal error:(NSError **)error;
// Prepare on original thread, run ONLY the retained task on its joined worker,
// then complete back on the original thread. No caller path/pin/command input.
- (BOOL)prepareHandoff:(NSDictionary *)journal error:(NSError **)error;
- (void)runPreparedHandoff;
- (void)cancelPreparedHandoff;
- (NSDictionary *)completeHandoff:(NSError **)error;
- (NSDictionary *)observeRevocation;
- (NSDictionary *)status;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@end
