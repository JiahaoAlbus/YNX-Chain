#import <Foundation/Foundation.h>
#import "../../native/original-project-control-review.h"
static NSUInteger publicControlIDs;
@implementation YNXOriginalProjectControlReview {NSString*_id,*_choice;NSDictionary*_view;BOOL _pending,_effect,_signed;}
+ (instancetype)captureOriginal:(NSError**)error {if(error)*error=nil;auto p=[[self alloc]init];p->_id=[NSString stringWithFormat:@"PUBLIC-control-%lu",(unsigned long)++publicControlIDs];NSString*expires=[NSString stringWithFormat:@"%llu",(unsigned long long)(NSDate.date.timeIntervalSince1970*1000.0)+20000];p->_view=@{@"reviewId":p->_id,@"account":@"ynx1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg36avh43",@"networkId":@"testnet",@"command":@{@"RequestID":p->_id,@"Action":@"project.create",@"ProjectID":@"project",@"TeamID":@"",@"SubjectAccount":@"",@"PublisherID":@"",@"RuntimeOrigin":@"",@"ExpectedRevision":@"0",@"GrantExpiresMS":@"0",@"Read":@NO,@"Publish":@NO,@"Runtime":@NO,@"Revoke":@NO,@"ExpiresMS":expires,@"PublicOriginalSHA256":@""}};return p;}
- (NSDictionary*)copyOriginalReview:(NSError**)error {if(error)*error=nil;return _view;}
- (BOOL)assertCurrent:(NSError**)error {if(error)*error=nil;return YES;}
- (BOOL)selectOriginalDecision:(NSString*)identifier decision:(NSString*)decision error:(NSError**)error {if(error)*error=nil;if(_choice||![_id isEqual:identifier])return NO;_choice=[decision copy];_pending=[decision isEqual:@"PUBLIC-pending"];return YES;}
- (BOOL)signOriginalApproval:(NSError**)error {if(error)*error=nil;if(_effect||![_choice isEqual:@"approve"])return NO;_effect=YES;_signed=YES;if([_id isEqual:@"PUBLIC-control-3"]){if(error)*error=[NSError errorWithDomain:@"PUBLIC-control-late-error" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_PUBLIC_LATE_ERROR"}];return NO;}return YES;}
- (NSDictionary*)copyOriginalDecision:(NSError**)error {if(error)*error=nil;return @{@"reviewId":_id,@"decision":_choice?:@"none",@"phase":_signed?@"approval-proof-retained":[_choice isEqual:@"cancel"]?@"cancelled":[_choice isEqual:@"reject"]?@"rejected":@"decision-retained",@"recorded":@YES,@"effectSelected":@(_effect),@"effectEntered":@(_effect),@"hasSignedResult":@(_signed),@"resultStored":@(_signed),@"cleanupPending":@NO};}
- (BOOL)saveOriginalLifecycle:(NSData*)record error:(NSError**)error {if(error)*error=nil;return record.length>0;}
- (void)retire {}
- (BOOL)close:(NSError**)error {if(error)*error=nil;return !_pending;}
@end
// Existing PUBLIC original-TU harness, not real Source/Keychain/crypto.
#include "artifact-publisher-binding-public.mm"
