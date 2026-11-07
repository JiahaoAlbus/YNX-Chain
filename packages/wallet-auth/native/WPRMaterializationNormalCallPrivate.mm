#import "WPRMaterializationNormalCallPrivate.h"
BOOL YNXConfigureOriginalWPRMaterializationConnectionV1(NSXPCConnection*connection,NSError**error){
 NSError*cause=nil;YNXWPRPublicationPeer*peer=[YNXWPRPublicationPeer acceptOriginalConnection:connection error:&cause];
 // Adopt the actual partial before the paired error. A failed accept has not
 // entered a Source/FD/key operation; only that peer inventory is released.
 if(cause||!peer){[peer close];if(error)*error=cause;return NO;}
 auto server=[YNXWPRMaterializationServerPrivate forOriginalPeer:peer];
 connection.exportedInterface=YNXWPRMaterializationRPCInterfaceV1();connection.exportedObject=server;
 connection.invalidationHandler=^{[peer retire];[peer close];};
 [connection activate];return YES;
}
