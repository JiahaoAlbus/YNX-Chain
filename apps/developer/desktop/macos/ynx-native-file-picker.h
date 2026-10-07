// Pure native picker boundary helpers. No caller-supplied path is an admission.
#import <Foundation/Foundation.h>
#import <sys/stat.h>
#import <stdlib.h>
static BOOL YNXNativePickerPayload(id body) {
    return [body isKindOfClass:NSDictionary.class]&&[body count]==3&&[body[@"action"] isEqual:@"pick-file"]&&[body[@"requestId"] isKindOfClass:NSString.class]&&[[NSUUID alloc]initWithUUIDString:body[@"requestId"]]&&[@[@"file",@"folder",@"workspace",@"any"] containsObject:body[@"kind"]];
}
static NSString *YNXNativePickedPath(NSURL *url) {
    if(![url isKindOfClass:NSURL.class]||!url.isFileURL||!url.path.isAbsolutePath)return nil;
    char *resolved=realpath(url.path.fileSystemRepresentation,NULL);if(!resolved)return nil;
    NSString *path=[NSString stringWithUTF8String:resolved];free(resolved);struct stat st;
    return lstat(path.fileSystemRepresentation,&st)==0&&(S_ISREG(st.st_mode)||S_ISDIR(st.st_mode))?path:nil;
}
static BOOL YNXNativePathInside(NSString *path,NSString *root) {
    return path&&root&&([path isEqual:root]||[path hasPrefix:[root stringByAppendingString:@"/"]]);
}
static NSString *YNXNativeInitialFile(id input,NSString *root,id selection) {
    if(![selection isEqual:@"native-panel"]||![input isKindOfClass:NSString.class]||![input isAbsolutePath])return nil;
    NSString *canonical=YNXNativePickedPath([NSURL fileURLWithPath:input]);struct stat st;
    return canonical&&[canonical isEqual:input]&&[canonical.stringByDeletingLastPathComponent isEqual:root]&&lstat(canonical.fileSystemRepresentation,&st)==0&&S_ISREG(st.st_mode)?canonical:nil;
}
