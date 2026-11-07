#import <Foundation/Foundation.h>
#import <TargetConditionals.h>
#include "SelectedAppDirectoryPrivate.h"
#if !TARGET_OS_IOS
#error This application-directory getter requires the actual iOS target
#endif
namespace ynx::mobilepq::directories {
int32_t platformApplicationDirectory(std::string&out)noexcept{
 @autoreleasepool {
  @try{try{
   // Actual process sandbox. No URL/path/account arrives from JS or Root.
   if(!NSBundle.mainBundle.bundleIdentifier.length)return notSupplied;
   NSString*home=NSHomeDirectory();const char*path=home.fileSystemRepresentation;
   if(!path||!home.length)return notSupplied;out.assign(path);return 0;
  }catch(...){return io;}}@catch(id){return io;}
 }
}
}
