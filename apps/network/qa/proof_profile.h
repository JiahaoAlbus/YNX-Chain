#import <Foundation/Foundation.h>

// Local launch metadata, never a replacement for the original CORE context.
@interface QAProofProfile : NSObject
@property(readonly) NSString *directory;
@property(readonly) NSString *buildID;
@property(readonly) NSString *sourceRevision;
-(instancetype)initWithDirectory:(NSString*)directory build:(NSDictionary*)build;
-(NSDictionary*)load:(NSError**)error;
// Checks owner/build identity and session replacement, without blessing context.
// Explicit new input can repair a missing/changed public context, preserving it.
-(BOOL)checkStoredRecord:(NSError**)error;
-(NSDictionary*)candidateForPath:(NSString*)path independentSHA256:(NSString*)pin error:(NSError**)error;
-(BOOL)save:(NSDictionary*)candidate error:(NSError**)error;
@end

// Held by the normal launcher for its lifetime; a headless exec inherits it.
int QAAcquireSession(NSString *directory, NSError **error);
