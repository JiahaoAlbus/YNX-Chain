#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <mach/mach.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <unistd.h>

// Only public SDK APIs. This reads identity for the one explicitly supplied PID/token;
// it does not enumerate processes, obtain task ports for another app, or read networking.
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        pid_t pid = getpid(); NSData *tokenData = nil;
        if (argc == 3 && strcmp(argv[1], "--pid") == 0) pid = (pid_t)strtol(argv[2], NULL, 10);
        else if (argc == 3 && strcmp(argv[1], "--audit-token") == 0) {
            NSString *hex = [NSString stringWithUTF8String:argv[2]];
            if (hex.length != sizeof(audit_token_t) * 2) return 64;
            NSMutableData *data = [NSMutableData dataWithLength:sizeof(audit_token_t)];
            for (NSUInteger index = 0; index < data.length; index++) {
                unsigned value = 0; NSString *pair = [hex substringWithRange:NSMakeRange(index * 2, 2)];
                NSScanner *scanner = [NSScanner scannerWithString:pair]; if (![scanner scanHexInt:&value] || !scanner.isAtEnd) return 64;
                ((uint8_t *)data.mutableBytes)[index] = value;
            }
            tokenData = data; audit_token_t token; memcpy(&token, data.bytes, sizeof(token)); pid = (pid_t)token.val[5];
        } else if (!(argc == 1 || (argc == 2 && strcmp(argv[1], "--self") == 0))) return 64;
        if (pid < 2) return 64;
        if (!tokenData && pid == getpid()) {
            audit_token_t token; mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
            kern_return_t status = task_info(mach_task_self(), TASK_AUDIT_TOKEN, (task_info_t)&token, &count);
            if (status == KERN_SUCCESS) tokenData = [NSData dataWithBytes:&token length:sizeof(token)];
        }
        struct proc_bsdinfo before = {0}, after = {0};
        int bytes = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before));
        if (bytes != sizeof(before)) { fprintf(stderr, "proc_pidinfo failed: %d\n", errno); return 74; }
        char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
        int pathResult;
        if (tokenData) { audit_token_t token; memcpy(&token, tokenData.bytes, sizeof(token)); pathResult = proc_pidpath_audittoken(&token, path, sizeof(path)); }
        else pathResult = proc_pidpath(pid, path, sizeof(path));
        if (pathResult <= 0) { fprintf(stderr, "proc_pidpath[_audittoken] failed: %d\n", errno); return 74; }
        NSDictionary *attributes = tokenData ? @{(__bridge id)kSecGuestAttributeAudit: tokenData} : @{(__bridge id)kSecGuestAttributePid: @(pid)};
        SecCodeRef code = NULL; OSStatus guestStatus = SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code);
        OSStatus validity = errSecCSNoSuchCode, appleValidity = errSecCSNoSuchCode; NSString *identifier = @"";
        if (guestStatus == errSecSuccess) {
            validity = SecCodeCheckValidity(code, kSecCSStrictValidate, NULL);
            SecRequirementRef apple = NULL; SecRequirementCreateWithString(CFSTR("anchor apple"), kSecCSDefaultFlags, &apple);
            if (apple) { appleValidity = SecCodeCheckValidity(code, kSecCSStrictValidate, apple); CFRelease(apple); }
            CFDictionaryRef information = NULL;
            if (SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information) == errSecSuccess) {
                id found = ((__bridge NSDictionary *)information)[(__bridge id)kSecCodeInfoIdentifier]; if ([found isKindOfClass:NSString.class]) identifier = [found copy];
                CFRelease(information);
            }
            CFRelease(code);
        }
        proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after));
        BOOL stable = before.pbi_pid == after.pbi_pid && before.pbi_start_tvsec == after.pbi_start_tvsec && before.pbi_start_tvusec == after.pbi_start_tvusec;
        NSMutableDictionary *output = [@{@"schema": @"P05_PUBLIC_PROCESS_IDENTITY_V1", @"pid": @(pid), @"ppid": @(before.pbi_ppid), @"path": @(path), @"startSeconds": @(before.pbi_start_tvsec), @"startMicroseconds": @(before.pbi_start_tvusec), @"identityStable": @(stable), @"guestStatus": @(guestStatus), @"signatureStatus": @(validity), @"appleAnchorStatus": @(appleValidity), @"signingIdentifier": identifier, @"responsibleProcessClaimed": @NO} mutableCopy];
        if (tokenData) { NSMutableString *hex = [NSMutableString string]; const uint8_t *token = tokenData.bytes; for (NSUInteger index = 0; index < tokenData.length; index++) [hex appendFormat:@"%02x", token[index]]; output[@"auditTokenHex"] = hex; }
        NSData *json = [NSJSONSerialization dataWithJSONObject:output options:NSJSONWritingSortedKeys error:NULL]; fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
        return stable ? 0 : 75;
    }
}
