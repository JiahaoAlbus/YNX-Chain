#import "../../desktop/macos/ynx-desktop-profile.h"
int main(void) {
 @autoreleasepool {
  NSString *home=@"/PUBLIC-HOME",*id1=@"0123456789abcdef0123456789abcdef01234567-12345678-1234-1234-1234-123456789abc",*id2=@"0123456789abcdef0123456789abcdef01234567-87654321-1234-1234-1234-123456789abc";
  NSString *normal=YNXDesktopProfileSupportRoot(@{},@{},home);
  if(![normal isEqual:@"/PUBLIC-HOME/Library/Application Support/YNXDeveloper"])return 1;
  NSDictionary *info=@{@"YNXQAProfileIdentifier":id1};
  NSString *qa=YNXDesktopProfileSupportRoot(@{},info,home);
  if(![qa isEqual:[@"/PUBLIC-HOME/Library/Application Support/YNXDeveloper-QA/" stringByAppendingString:id1]])return 2;
  if(![qa isEqual:YNXDesktopProfileSupportRoot(@{},info,home)])return 3;
  if([qa isEqual:YNXDesktopProfileSupportRoot(@{},@{@"YNXQAProfileIdentifier":id2},home)])return 4;
  if(![YNXDesktopProfileSupportRoot(@{@"YNX_CODE_DESKTOP_SUPPORT_DIR":@"/PUBLIC-EXPLICIT"},info,home) isEqual:@"/PUBLIC-EXPLICIT"])return 5;
  if(![YNXDesktopProfileNamespace(@"PUBLIC-KEYCHAIN",@{}) isEqual:@"PUBLIC-KEYCHAIN"])return 7;
  if([YNXDesktopProfileNamespace(@"PUBLIC-KEYCHAIN",info) isEqual:YNXDesktopProfileNamespace(@"PUBLIC-KEYCHAIN",@{@"YNXQAProfileIdentifier":id2})])return 8;
  if(![YNXDesktopQAWebsiteIdentifier(info).UUIDString.lowercaseString isEqual:@"12345678-1234-1234-1234-123456789abc"]||YNXDesktopQAWebsiteIdentifier(@{}))return 9;
  for(id bad in @[@"../../normal",@"",@YES,@"0123456789abcdef0123456789abcdef01234567-12345678-1234-1234-1234-123456789abc\n"])
   if(YNXDesktopProfileSupportRoot(@{},@{@"YNXQAProfileIdentifier":bad},home))return 6;
  puts("native default QA isolation, stable reopen, distinct build, explicit override and invalid package refusal passed");return 0;
 }
}
