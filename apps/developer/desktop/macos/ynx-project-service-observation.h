#pragma once
#import <Foundation/Foundation.h>
static inline NSError *YNXServiceObservationFailure(NSString *code){
 return [NSError errorWithDomain:@"YNXIDEProjectServiceObservation" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
}

@protocol YNXProjectServiceObservationReader <NSObject>
- (NSDictionary *)readCurrent:(NSError **)error;
- (void)retire;
- (BOOL)finish:(NSError **)error;
@end
@interface YNXProjectServiceObservation : NSObject <YNXProjectServiceObservationReader>
+ (instancetype)captureOriginal:(NSError **)error;
- (NSDictionary *)readCurrent:(NSError **)error;
- (void)retire;
- (BOOL)finish:(NSError **)error;
- (id)originalFirstCause;
@end
