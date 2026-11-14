#ifndef YNX_IDENTITY_BRIDGE_H
#define YNX_IDENTITY_BRIDGE_H
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
typedef struct {
    int32_t pid, pidVersion; uint32_t euid, auditSession;
    int32_t signatureStatus, requirementStatus;
    uint64_t startSeconds, startMicroseconds;
    char path[4096], sha256[65], codeDirectoryHash[129];
} YNXProcessIdentity;
bool YNXCopyOwnAuditToken(uint8_t *output, size_t length);
int YNXInspectAuditIdentity(const uint8_t *token, size_t length, const char *requirement, YNXProcessIdentity *output);
int YNXInspectAuditCodeIdentity(const uint8_t *token, size_t length, const char *requirement, YNXProcessIdentity *output);
int YNXOwnsLoopbackTCPListener(const uint8_t *token, size_t length, const char *host, uint16_t port);
// A nonzero generation is returned only for an unambiguous exact listener.
int YNXLoopbackTCPListenerGeneration(const uint8_t *token, size_t length, const char *host, uint16_t port, uint64_t *generation);
// Only chooses the exact requirement subsequently installed on an NSXPC connection. PID alone
// is never authorization: XPC checks that same code requirement for every received message.
int YNXMatchesCodeForPID(int32_t pid, const char *requirement);
int YNXCopyAuditViaTaskName(int32_t pid, uint8_t *output, size_t length, int32_t *taskNameStatus, int32_t *taskInfoStatus);
#endif
