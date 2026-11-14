#include "IdentityBridge.h"
#include <Security/Security.h>
#include <CommonCrypto/CommonDigest.h>
#include <mach/mach.h>
#include <bsm/libbsm.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

// No task_for_pid, private XPC audit selector, global process enumeration or payload reads.
bool YNXCopyOwnAuditToken(uint8_t *output, size_t length) {
    if (length != sizeof(audit_token_t)) return false;
    audit_token_t token; mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
    if (task_info(mach_task_self(), TASK_AUDIT_TOKEN, (task_info_t)&token, &count) != KERN_SUCCESS) return false;
    memcpy(output, &token, length); return true;
}
static int digest_file(const char *path, char output[65]) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); if (fd < 0) return errno;
    struct stat before, after; if (fstat(fd, &before) || !S_ISREG(before.st_mode)) { close(fd); return EINVAL; }
    CC_SHA256_CTX context; CC_SHA256_Init(&context); unsigned char buffer[32768], digest[32]; ssize_t count;
    while ((count = read(fd, buffer, sizeof(buffer))) > 0) CC_SHA256_Update(&context, buffer, (CC_LONG)count);
    int failure = count < 0 ? errno : 0;
    if (fstat(fd, &after) || before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_size != after.st_size || before.st_mtimespec.tv_sec != after.st_mtimespec.tv_sec || before.st_mtimespec.tv_nsec != after.st_mtimespec.tv_nsec) failure = ESTALE;
    close(fd); if (failure) return failure; CC_SHA256_Final(digest, &context);
    for (size_t index = 0; index < 32; index++) snprintf(output + index * 2, 3, "%02x", digest[index]);
    return 0;
}
int YNXInspectAuditIdentity(const uint8_t *bytes, size_t length, const char *requirement, YNXProcessIdentity *output) {
    if (!bytes || !output || length != sizeof(audit_token_t) || !requirement || !*requirement) return EINVAL;
    memset(output, 0, sizeof(*output)); audit_token_t token; memcpy(&token, bytes, length);
    output->pid = audit_token_to_pid(token); output->pidVersion = audit_token_to_pidversion(token);
    output->euid = audit_token_to_euid(token); output->auditSession = audit_token_to_asid(token);
    if (output->pid < 2 || output->pidVersion <= 0) return EINVAL;
    if (proc_pidpath_audittoken(&token, output->path, sizeof(output->path)) <= 0) return errno ?: ESRCH;
    struct proc_bsdinfo before = {0}, after = {0};
    if (proc_pidinfo(output->pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before)) != sizeof(before)) return errno ?: ESRCH;
    output->startSeconds = before.pbi_start_tvsec; output->startMicroseconds = before.pbi_start_tvusec;
    CFDataRef data = CFDataCreate(NULL, bytes, length);
    const void *keys[] = { kSecGuestAttributeAudit }, *values[] = { data };
    CFDictionaryRef attributes = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    SecCodeRef code = NULL; OSStatus status = SecCodeCopyGuestWithAttributes(NULL, attributes, kSecCSDefaultFlags, &code);
    CFRelease(attributes); CFRelease(data); if (status != errSecSuccess) return (int)status;
    output->signatureStatus = SecCodeCheckValidity(code, kSecCSStrictValidate, NULL);
    CFStringRef string = CFStringCreateWithCString(NULL, requirement, kCFStringEncodingUTF8); SecRequirementRef rule = NULL;
    status = SecRequirementCreateWithString(string, kSecCSDefaultFlags, &rule); CFRelease(string);
    output->requirementStatus = status == errSecSuccess ? SecCodeCheckValidity(code, kSecCSStrictValidate, rule) : status;
    if (rule) CFRelease(rule); CFRelease(code);
    if (output->signatureStatus || output->requirementStatus) return output->signatureStatus ?: output->requirementStatus;
    int failure = digest_file(output->path, output->sha256); if (failure) return failure;
    char rechecked[4096];
    if (proc_pidpath_audittoken(&token, rechecked, sizeof(rechecked)) <= 0 || strcmp(rechecked, output->path)) return ESTALE;
    if (proc_pidinfo(output->pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) != sizeof(after) || before.pbi_start_tvsec != after.pbi_start_tvsec || before.pbi_start_tvusec != after.pbi_start_tvusec) return ESTALE;
    return 0;
}
int YNXOwnsLoopbackTCPListener(const uint8_t *bytes, size_t length, const char *host, uint16_t port) {
    if (!bytes || length != sizeof(audit_token_t) || !host || (strcmp(host,"127.0.0.1") && strcmp(host,"::1")) || port < 1024) return -EINVAL;
    audit_token_t token; memcpy(&token, bytes, length); pid_t pid = audit_token_to_pid(token);
    char path[4096]; if (proc_pidpath_audittoken(&token, path, sizeof(path)) <= 0) return -(errno ?: ESRCH);
    int size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0); if (size <= 0) return -(errno ?: ESRCH);
    if (size > 4096 * sizeof(struct proc_fdinfo)) return -E2BIG;
    struct proc_fdinfo *fds = calloc(1, size); if (!fds) return -ENOMEM;
    int actual = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, size), result = 0;
    if (actual <= 0) { free(fds); return -(errno ?: ESRCH); }
    for (int index = 0; index < actual / sizeof(*fds); index++) {
        if (fds[index].proc_fdtype != PROX_FDTYPE_SOCKET) continue;
        struct socket_fdinfo info;
        if (proc_pidfdinfo(pid, fds[index].proc_fd, PROC_PIDFDSOCKETINFO, &info, sizeof(info)) != sizeof(info)) continue;
        if (info.psi.soi_kind != SOCKINFO_TCP || info.psi.soi_protocol != IPPROTO_TCP || info.psi.soi_proto.pri_tcp.tcpsi_state != TSI_S_LISTEN) continue;
        struct in_sockinfo *address = &info.psi.soi_proto.pri_tcp.tcpsi_ini;
        if (ntohs((uint16_t)address->insi_lport) != port) continue;
        if (!strcmp(host,"127.0.0.1") && (address->insi_vflag & INI_IPV4) && address->insi_laddr.ina_46.i46a_addr4.s_addr == htonl(INADDR_LOOPBACK)) result = 1;
        struct in6_addr loopback = IN6ADDR_LOOPBACK_INIT;
        if (!strcmp(host,"::1") && (address->insi_vflag & INI_IPV6) && !memcmp(&address->insi_laddr.ina_6, &loopback, sizeof(loopback))) result = 1;
    }
    free(fds); if (proc_pidpath_audittoken(&token, path, sizeof(path)) <= 0) return -(errno ?: ESTALE);
    return result;
}
