#import "original-ide-helper-listener.h"
#include <cstdio>
int main(){@autoreleasepool{NSError*error=nil;if(YNXRunOriginalIDEHelper(&error))return 0;
 NSString*text=error.localizedDescription;NSData*ascii=[text dataUsingEncoding:NSASCIIStringEncoding allowLossyConversion:NO];BOOL safe=ascii.length>0&&ascii.length<=128;
 if(safe)for(NSUInteger i=0;i<ascii.length;i++){unsigned char c=((const unsigned char*)ascii.bytes)[i];if(!((c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_')){safe=NO;break;}}
 std::fprintf(stderr,"%s\n",safe?text.UTF8String:"AUTH_IDENTITY_HELPER_STARTUP_REFUSED");return 1;
}}
