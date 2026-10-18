#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <unistd.h>

// Private transport matching only. No record/receipt here supplies Source,
// Native terminal proof, an account grant or evidence that a human received it.
static const NSUInteger YNXOriginalServiceInputLimit=262144;
static const NSUInteger YNXOriginalServiceFrameLimit=576*1024;
static const NSUInteger YNXOriginalServiceResultFileLimit=192*1024;
static NSString *const YNXOriginalServiceSchema=@"ynx-ide-original-service-pipe/v1";
static BOOL YNXOriginalServiceFields(id value,NSArray<NSString *> *keys) {
    return [value isKindOfClass:NSDictionary.class]&&[value count]==keys.count
        &&[[NSSet setWithArray:[value allKeys]]isEqual:[NSSet setWithArray:keys]];
}
static BOOL YNXOriginalServiceBool(id value,BOOL expected) {
    return [value isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID()&&[value boolValue]==expected;
}
static NSString *YNXOriginalServiceDigest(NSString *raw) {
    if(![raw isKindOfClass:NSString.class])return nil;
    NSData *data=[raw dataUsingEncoding:NSUTF8StringEncoding];
    if(!data||data.length>65536)return nil;
    unsigned char bytes[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,(CC_LONG)data.length,bytes);
    NSMutableString *hex=[NSMutableString new];for(NSUInteger i=0;i<sizeof(bytes);i++)[hex appendFormat:@"%02x",bytes[i]];return hex;
}
static NSDictionary *YNXOriginalServiceReadRecord(NSString *file) {
    int fd=open(file.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return nil;
    struct stat st;BOOL valid=fstat(fd,&st)==0&&S_ISREG(st.st_mode)&&st.st_uid==getuid()&&st.st_nlink==1
        &&(st.st_mode&0077)==0&&st.st_size>0&&(uint64_t)st.st_size<=YNXOriginalServiceResultFileLimit;
    NSMutableData *buffer=valid?[NSMutableData dataWithLength:(NSUInteger)st.st_size+1]:nil;
    ssize_t count=buffer?pread(fd,buffer.mutableBytes,buffer.length,0):-1;
    struct stat after;if(valid)valid=fstat(fd,&after)==0&&after.st_dev==st.st_dev&&after.st_ino==st.st_ino&&after.st_size==st.st_size
        &&after.st_nlink==1&&after.st_uid==st.st_uid&&after.st_mode==st.st_mode
        &&after.st_mtimespec.tv_sec==st.st_mtimespec.tv_sec&&after.st_mtimespec.tv_nsec==st.st_mtimespec.tv_nsec
        &&after.st_ctimespec.tv_sec==st.st_ctimespec.tv_sec&&after.st_ctimespec.tv_nsec==st.st_ctimespec.tv_nsec;
    close(fd);if(!valid||count!=st.st_size)return nil;
    id value=[NSJSONSerialization JSONObjectWithData:[buffer subdataWithRange:NSMakeRange(0,(NSUInteger)count)] options:0 error:NULL];
    return [value isKindOfClass:NSDictionary.class]?value:nil;
}
static BOOL YNXOriginalServiceBinding(NSDictionary *record,NSDictionary *row) {
    if(![record[@"schema"]isEqual:YNXOriginalServiceSchema])return NO;
    for(NSString *key in @[@"id",@"document",@"instance",@"projectId",@"workspace"])
        if(![record[key]isKindOfClass:NSString.class]||![record[key]isEqual:row[key]])return NO;
    return YES;
}
static BOOL YNXOriginalServiceProvisional(NSDictionary *record,NSDictionary *row) {
    return YNXOriginalServiceFields(record,@[@"schema",@"id",@"document",@"instance",@"projectId",@"workspace",@"status",@"entered",@"unknown",@"resultRaw",@"resultDigest"])
        &&YNXOriginalServiceBinding(record,row)&&[record[@"status"]isEqual:@"response-pending-terminal"]
        &&YNXOriginalServiceBool(record[@"entered"],YES)&&YNXOriginalServiceBool(record[@"unknown"],YES)
        &&[record[@"resultDigest"]isKindOfClass:NSString.class]&&[YNXOriginalServiceDigest(record[@"resultRaw"])isEqual:record[@"resultDigest"]];
}
static BOOL YNXOriginalServiceTerminal(NSDictionary *record,NSDictionary *row) {
    return YNXOriginalServiceFields(record,@[@"schema",@"id",@"document",@"instance",@"projectId",@"workspace",@"status",@"entered",@"unknown",@"resultDigest"])
        &&YNXOriginalServiceBinding(record,row)&&[record[@"status"]isEqual:@"terminal"]
        &&YNXOriginalServiceBool(record[@"entered"],YES)&&YNXOriginalServiceBool(record[@"unknown"],NO)
        &&[record[@"resultDigest"]isEqual:row[@"resultDigest"]]&&[YNXOriginalServiceDigest(row[@"resultRaw"])isEqual:record[@"resultDigest"]];
}
static BOOL YNXOriginalServiceFailure(NSDictionary *record,NSDictionary *row) {
    return YNXOriginalServiceFields(record,@[@"schema",@"id",@"document",@"instance",@"projectId",@"workspace",@"status",@"entered",@"unknown",@"error"])
        &&YNXOriginalServiceBinding(record,row)&&[record[@"status"]isEqual:@"failed"]&&YNXOriginalServiceBool(record[@"entered"],NO)
        &&(YNXOriginalServiceBool(record[@"unknown"],YES)||YNXOriginalServiceBool(record[@"unknown"],NO))
        &&[@[@"ORIGINAL_PRIVATE_SOURCE_UNRESOLVED",@"ORIGINAL_PRIVATE_REQUEST_INVALID"]containsObject:record[@"error"]];
}
