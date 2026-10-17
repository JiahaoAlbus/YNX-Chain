// Pure native picker boundary helpers. No caller-supplied path is an admission.
#import <Foundation/Foundation.h>
#import <sys/stat.h>
#import <stdlib.h>
#import <errno.h>
static BOOL YNXNativePickerPayload(id body) {
    return [body isKindOfClass:NSDictionary.class]&&[body count]==3&&[body[@"action"] isEqual:@"pick-file"]&&[body[@"requestId"] isKindOfClass:NSString.class]&&[[NSUUID alloc]initWithUUIDString:body[@"requestId"]]&&[@[@"file",@"folder",@"workspace",@"any"] containsObject:body[@"kind"]];
}
static BOOL YNXNativeSavePayload(id body) {
    if(![body isKindOfClass:NSDictionary.class]||[body count]!=3||![body[@"action"] isEqual:@"save-file"]||![body[@"requestId"] isKindOfClass:NSString.class]||![[NSUUID alloc]initWithUUIDString:body[@"requestId"]]||![body[@"name"] isKindOfClass:NSString.class])return NO;
    NSString *name=body[@"name"];
    return [name lengthOfBytesUsingEncoding:NSUTF8StringEncoding]<=255&&[name rangeOfString:@"/"].location==NSNotFound&&[name rangeOfString:[NSString stringWithFormat:@"%C",(unichar)0]].location==NSNotFound&&![name isEqual:@"."]&&![name isEqual:@".."];
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
// A new filename has no realpath yet. Resolve only its existing parent and
// reject existing symlinks/devices/directories; this never grants a new root.
static NSString *YNXNativeSavePath(NSURL *url,NSString *root) {
    if(!url.isFileURL||!url.path.isAbsolutePath||!root)return nil;
    NSString *leaf=url.lastPathComponent;
    if(!leaf.length||[leaf isEqual:@"."]||[leaf isEqual:@".."])return nil;
    NSString *parent=YNXNativePickedPath(url.URLByDeletingLastPathComponent);
    struct stat st;
    if(!parent||lstat(parent.fileSystemRepresentation,&st)!=0||!S_ISDIR(st.st_mode))return nil;
    NSString *selected=[parent stringByAppendingPathComponent:leaf];
    if(!YNXNativePathInside(selected,root))return nil;
    if(lstat(selected.fileSystemRepresentation,&st)==0)return S_ISREG(st.st_mode)?selected:nil;
    return errno==ENOENT?selected:nil;
}
static NSString *YNXNativeInitialFile(id input,NSString *root,id selection) {
    if(![selection isEqual:@"native-panel"]||![input isKindOfClass:NSString.class]||![input isAbsolutePath])return nil;
    NSString *canonical=YNXNativePickedPath([NSURL fileURLWithPath:input]);struct stat st;
    return canonical&&[canonical isEqual:input]&&[canonical.stringByDeletingLastPathComponent isEqual:root]&&lstat(canonical.fileSystemRepresentation,&st)==0&&S_ISREG(st.st_mode)?canonical:nil;
}
