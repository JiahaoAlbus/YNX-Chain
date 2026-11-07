#pragma once
#import "WPRMaterializationRPCPrivate.h"
// Existing independently registered privileged listener only; before activate.
// No new Mach service/listener/approval/targetconsumer is created here.
FOUNDATION_EXPORT BOOL YNXConfigureOriginalWPRMaterializationConnectionV1(NSXPCConnection*originalConnection,NSError**error);
