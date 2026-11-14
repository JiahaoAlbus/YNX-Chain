#ifndef YNX_IDENTITY_BRIDGE_H
#define YNX_IDENTITY_BRIDGE_H
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
typedef struct {
    int32_t pid, pidVersion; uint32_t euid, auditSession;
    int32_t signatureStatus, requirementStatus;
    uint64_t startSeconds, startMicroseconds;
    char path[4096], sha256[65];
} YNXProcessIdentity;
bool YNXCopyOwnAuditToken(uint8_t *output, size_t length);
int YNXInspectAuditIdentity(const uint8_t *token, size_t length, const char *requirement, YNXProcessIdentity *output);
int YNXOwnsLoopbackTCPListener(const uint8_t *token, size_t length, const char *host, uint16_t port);
#endif
