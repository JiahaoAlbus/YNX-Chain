#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <unistd.h>
#import <errno.h>

// One explicit PID only. No enumeration, task port, networking, payload or file-content read.
static NSDictionary *codeIdentity(pid_t pid) {
    SecCodeRef guest = NULL; SecStaticCodeRef code = NULL; CFDictionaryRef raw = NULL;
    OSStatus status = SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)@{(__bridge id)kSecGuestAttributePid:@(pid)}, kSecCSDefaultFlags, &guest);
    OSStatus validity = status; NSString *identifier = @"", *cdhash = @"", *path = @"";
    if (status == errSecSuccess) {
        validity = SecCodeCheckValidity(guest, kSecCSStrictValidate, NULL);
        if (SecCodeCopyStaticCode(guest, kSecCSDefaultFlags, &code) == errSecSuccess &&
            SecCodeCopySigningInformation(code, kSecCSSigningInformation, &raw) == errSecSuccess) {
            NSDictionary *info = (__bridge NSDictionary *)raw;
            if ([info[(__bridge id)kSecCodeInfoIdentifier] isKindOfClass:NSString.class]) identifier = info[(__bridge id)kSecCodeInfoIdentifier];
            NSData *hash = info[(__bridge id)kSecCodeInfoUnique];
            if ([hash isKindOfClass:NSData.class]) {
                NSMutableString *hex = [NSMutableString string]; const uint8_t *bytes = hash.bytes;
                for (NSUInteger i=0;i<hash.length;i++) [hex appendFormat:@"%02x",bytes[i]];
                cdhash = hex;
            }
            NSURL *url = info[(__bridge id)kSecCodeInfoMainExecutable];
            if ([url isKindOfClass:NSURL.class]) path = url.standardizedURL.path;
        }
    }
    if (raw) CFRelease(raw); if (code) CFRelease(code); if (guest) CFRelease(guest);
    return @{@"guestStatus":@(status),@"signatureStatus":@(validity),@"signingIdentifier":identifier,@"codeDirectoryHash":cdhash,@"signedExecutablePath":path};
}
static int emit(NSDictionary *value, int status) {
    NSData *json=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:NULL];
    fwrite(json.bytes,1,json.length,stdout); fputc('\n',stdout); return status;
}
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        if (argc!=3 || strcmp(argv[1],"--pid")!=0 || !argv[2][0]) return 64;
        char *end=NULL; errno=0; long parsed=strtol(argv[2],&end,10);
        if (errno || *end || parsed<2 || parsed>INT32_MAX) return 64;
        pid_t pid=(pid_t)parsed; struct proc_bsdinfo before={0},after={0};
        if (proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&before,sizeof(before))!=sizeof(before))
            return emit(@{@"schema":@"P05_PUBLIC_DIAGNOSTIC_PROCESS_IDENTITY_V1",@"pid":@(pid),@"stage":@"proc-info-before",@"errno":@(errno)},74);
        char path[PROC_PIDPATHINFO_MAXSIZE]={0},lastPath[PROC_PIDPATHINFO_MAXSIZE]={0};
        if (proc_pidpath(pid,path,sizeof(path))<=0)
            return emit(@{@"schema":@"P05_PUBLIC_DIAGNOSTIC_PROCESS_IDENTITY_V1",@"pid":@(pid),@"stage":@"proc-path-before",@"errno":@(errno)},74);
        NSDictionary *first=codeIdentity(pid),*last=codeIdentity(pid);
        BOOL sampled=proc_pidpath(pid,lastPath,sizeof(lastPath))>0 && proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&after,sizeof(after))==sizeof(after);
        BOOL stable=sampled && before.pbi_pid==after.pbi_pid && before.pbi_uid==after.pbi_uid && before.pbi_ruid==after.pbi_ruid &&
            before.pbi_start_tvsec==after.pbi_start_tvsec && before.pbi_start_tvusec==after.pbi_start_tvusec &&
            strcmp(path,lastPath)==0 && [first isEqualToDictionary:last] && [first[@"signedExecutablePath"] isEqualToString:@(path)];
        NSMutableDictionary *output=[first mutableCopy];
        [output addEntriesFromDictionary:@{@"schema":@"P05_PUBLIC_DIAGNOSTIC_PROCESS_IDENTITY_V1",@"pid":@(pid),@"ppid":@(before.pbi_ppid),
            @"uid":@(before.pbi_ruid),@"euid":@(before.pbi_uid),@"path":@(path),@"startSeconds":@(before.pbi_start_tvsec),
            @"startMicroseconds":@(before.pbi_start_tvusec),@"identityStable":@(stable),@"auditTokenResponsibilityObserved":@NO}];
        return emit(output,stable ? 0 : 75);
    }
}
