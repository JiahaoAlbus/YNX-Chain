#define main YNXApplicationMain
#include "../../desktop/macos/main.m"
#undef main

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if(argc!=3)return 2;
        NSURL *url=[NSURL fileURLWithPath:@(argv[2])]; NSError *error=nil;
        NSDictionary *project=@{@"id":@"same-project-id",@"name":@"Restart proof",@"revision":@7,@"remoteRevision":@2,@"files":@{@"proof.cpp":@"// native restart proof\n"},@"folders":@[],@"open":@[@"proof.cpp"],@"active":@"proof.cpp",@"walletSession":@"must-not-persist"};
        if(!strcmp(argv[1],"write")) {
            if(!YNXWriteWorkspaceSnapshot(url,project,&error))return 3;
            NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:url.path error:&error];
            if([attributes[NSFilePosixPermissions] unsignedIntValue]!=0600)return 4;
        } else if(!strcmp(argv[1],"read")) {
            NSDictionary *restored=YNXReadWorkspaceSnapshot(url,&error);
            if(error || ![restored[@"id"] isEqual:project[@"id"]] || ![restored[@"files"] isEqual:project[@"files"]] || restored[@"walletSession"])return 5;
        } else if(!strcmp(argv[1],"corrupt")) {
            if(YNXReadWorkspaceSnapshot(url,&error) || !error)return 6;
        } else return 7;
        if(![YNXJSON([NSNull null]) isEqualToString:@"null"])return 8;
        printf("native workspace storage %s passed\n",argv[1]);
        return 0;
    }
}
