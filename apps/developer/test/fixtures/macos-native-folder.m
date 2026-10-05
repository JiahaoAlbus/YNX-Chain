#define main YNXProductionMain
#include "../../desktop/macos/main.m"
#undef main
static void Require(BOOL ok,NSString *message){if(!ok){fprintf(stderr,"%s\n",message.UTF8String);exit(1);}}
int main(int argc,const char *argv[]){@autoreleasepool{
 Require(argc==2,@"fixture root required");NSString *root=@(argv[1]);NSString *folder=[root stringByAppendingPathComponent:@"Chosen Project"];
 Require(YNXCanonicalLocalDirectory(folder)!=nil,@"canonical directory rejected");
 Require(YNXCanonicalPickedLocalDirectory([NSURL fileURLWithPath:folder])!=nil,@"native directory rejected");
 Require(YNXCanonicalLocalDirectory([folder stringByAppendingString:@"/."])==nil,@"dot segment accepted");
 Require(YNXCanonicalLocalDirectory([folder stringByAppendingString:@"/../Chosen Project"])==nil,@"parent segment accepted");
 Require(YNXCanonicalLocalDirectory(@"Chosen Project")==nil,@"relative directory accepted");
 Require(YNXCanonicalPickedLocalDirectory([NSURL URLWithString:@"https://example.invalid/project"])==nil,@"network URL accepted");
 Require(YNXCanonicalPickedLocalDirectory([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"file.txt"]])==nil,@"file accepted as directory");
 Require(YNXCanonicalPickedLocalDirectory([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"missing"]])==nil,@"missing directory accepted");
 NSString *alias=[root stringByAppendingPathComponent:@"alias"];
 Require(YNXCanonicalLocalDirectory(alias)==nil,@"launch accepted symlink alias");
 Require([YNXCanonicalPickedLocalDirectory([NSURL fileURLWithPath:alias]) isEqual:folder],@"explicit picker alias was not canonicalized");
 if([folder hasPrefix:@"/private/tmp/"]){NSString *shortAlias=[folder substringFromIndex:8];Require(YNXCanonicalLocalDirectory(shortAlias)==nil,@"launch accepted /tmp alias");Require([YNXCanonicalPickedLocalDirectory([NSURL fileURLWithPath:shortAlias]) isEqual:folder],@"native /tmp alias was not canonicalized");}
 puts("native folder path boundaries PASS");return 0;
}}
