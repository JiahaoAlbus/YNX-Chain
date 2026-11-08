#ifndef YNX_SECURELINK_NATIVE_BRIDGE_H
#define YNX_SECURELINK_NATIVE_BRIDGE_H
#include <openssl/ssl.h>
#include <stdint.h>

typedef struct {
    char protocol[24], group[64], cipher[64], peer_san[256], local_san[256];
    char peer_fingerprint[65], root_fingerprint[65], signature[64];
    int64_t not_after;
    int verified, mutual, resumed, chain_pq;
} ynx_tls_state;

SSL_CTX *ynx_ctx_new(const char *, const char *, const char *, int, char *, size_t);
/* Additive Native credential import. Only owned duplicate FDs are closed;
 * original FD offsets/ownership and all private key bytes stay out of callers.
 * A close error is UNKNOWN: preserve this DATA and the owning Source debt,
 * never retry close on a possibly reused numeric descriptor. */
typedef struct {
    int32_t certificate_fd, private_key_fd;
    uint32_t close_unknown;
} ynx_credential_fd_cleanup;
SSL_CTX *ynx_ctx_new_fds(int, int, const unsigned char *, size_t, const char *,
                       int, ynx_credential_fd_cleanup *, char *, size_t);
SSL *ynx_ssl_new(SSL_CTX *, int, int, const char *);
int ynx_handshake(SSL *, char *, size_t);
int ynx_read(SSL *, void *, size_t, size_t *, char *, size_t);
int ynx_write(SSL *, const void *, size_t, size_t *, char *, size_t);
int ynx_snapshot(SSL *, const char *, int, ynx_tls_state *, char *, size_t);
int ynx_export(SSL *, const char *, size_t, const unsigned char *, size_t, unsigned char *, size_t);
#define YNX_PEER_SPKI_DER_MAX 16384u
/* Public peer SubjectPublicKeyInfo only, copied from the caller-held SSL. */
int ynx_peer_spki_der(SSL *, unsigned char *, size_t, size_t *, char *, size_t);
#define YNX_SERVER_CERT_DER_MAX 32768u
#define YNX_SERVER_SPKI_DER_MAX 16384u
#define YNX_SERVER_DNS_MAX 32u
#define YNX_SERVER_DNS_CAP 254u
/* PUBLIC server-context DATA only. The caller owns the server role and holds
 * its original Context mutex through this call. No native pointers or private
 * keys are returned; no URL, pin, SAN, provider or Root input is accepted. */
typedef struct {
    uint32_t version, size;
    unsigned char certificate_der[YNX_SERVER_CERT_DER_MAX];
    unsigned char spki_der[YNX_SERVER_SPKI_DER_MAX];
    size_t certificate_der_length, spki_der_length, dns_count;
    char certificate_sha256[65], spki_sha256[65];
    char dns_names[YNX_SERVER_DNS_MAX][YNX_SERVER_DNS_CAP];
    int64_t not_before, not_after;
    char runtime_version[128], protocol[24], group[64], cipher[64], signature[64];
    int server_auth, mutual, tickets_off;
} ynx_server_identity;
int ynx_ctx_server_identity(SSL_CTX *, ynx_server_identity *, char *, size_t);
const char *ynx_runtime_version(void);
#endif
