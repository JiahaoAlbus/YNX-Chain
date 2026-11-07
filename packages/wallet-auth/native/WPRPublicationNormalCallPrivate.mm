#import "WPRPublicationNormalCallPrivate.h"
@implementation YNXWPRPublicationCall{
 YNXWPRPublicReceiver*_receiver;NSDictionary*_originalReceiptDATA;NSError*_firstError;BOOL _physicalDone;
}
- (YNXWPRPublicReceiver*)receiver{return _receiver;}
- (NSDictionary*)originalReceiptDATA{return _originalReceiptDATA;}
- (NSError*)firstError{return _firstError;}
- (BOOL)physicalDone{return _physicalDone;}
- (void)remember:(NSError*)error{if(!_firstError&&error)_firstError=error;}
+ (instancetype)runOriginalPeer:(YNXWPRPublicationPeer*)peer action:(YNXWPRPublicationAction)action {
 YNXWPRPublicationCall*call=[YNXWPRPublicationCall new];
 if(action!=YNXWPRPublishOriginal&&action!=YNXWPRReadOriginal){[call remember:[NSError errorWithDomain:@"WPRPublicationCall" code:1 userInfo:@{NSLocalizedDescriptionKey:@"WPR_FIXED_OPERATION_REQUIRED"}]];call->_physicalDone=YES;return call;}
 NSError*cause=nil;call->_receiver=[YNXWPRPublicReceiver acquireForOriginalPeer:peer error:&cause]; // adopt first
 [call remember:cause];if(!call->_receiver&&!call->_firstError)[call remember:[NSError errorWithDomain:@"WPRPublicationCall" code:1 userInfo:@{NSLocalizedDescriptionKey:@"WPR_ORIGINAL_RECEIVER_REQUIRED"}]];
 if(!call->_firstError){cause=nil;NSDictionary*actual=action==YNXWPRPublishOriginal?[call->_receiver publishOriginal:&cause]:[call->_receiver copyOriginalReadBack:&cause];call->_originalReceiptDATA=actual?:[call->_receiver copyRetainedReceiptDATA];[call remember:cause];if(!actual&&!cause)[call remember:[NSError errorWithDomain:@"WPRPublicationCall" code:1 userInfo:@{NSLocalizedDescriptionKey:@"WPR_ORIGINAL_RECEIPT_NOT_OBSERVED"}]];}
 [call drainOriginal];return call;
}
- (BOOL)drainOriginal{
 if(_physicalDone)return YES;if(!_receiver){_physicalDone=YES;return YES;}
 [_receiver retire];NSError*cause=nil;BOOL joined=[_receiver join:&cause];[self remember:cause];if(!joined)return NO;
 cause=nil;BOOL closeResult=[_receiver close:&cause];[self remember:cause];
 // Actual physical state is adopted even when the preserved first error or
 // a late close error is nonnil. No status object or nil owner mints success.
 _physicalDone=[_receiver physicallyClosed];return closeResult&&_physicalDone;
}
@end
