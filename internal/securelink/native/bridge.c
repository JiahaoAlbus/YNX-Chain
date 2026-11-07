//go:build securelink_openssl && cgo

#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif
#include "bridge.h"
#include <openssl/err.h>
#include <openssl/x509v3.h>
#include <openssl/crypto.h>
#include <openssl/provider.h>
#include <openssl/core_names.h>
#include <openssl/params.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <openssl/pem.h>
#include <errno.h>
#include <limits.h>
#include <stdlib.h>

#if OPENSSL_VERSION_MAJOR != 3 || OPENSSL_VERSION_MINOR != 6 || OPENSSL_VERSION_PATCH != 4
#error "securelink native runtime is pinned to OpenSSL 3.6.4"
#endif

typedef struct {
    OSSL_LIB_CTX *libctx;
    OSSL_PROVIDER *provider;
    EVP_MD *sha256;
} ynx_provider;

static CRYPTO_ONCE provider_once = CRYPTO_ONCE_STATIC_INIT;
static ynx_provider pinned_provider;
static int provider_ready = 0;

static void provider_init(void) {
    // Exactly one private context/provider is retained for process lifetime.
    // SSL_CTX ex_data destructors run before certificates/EVP objects are freed;
    // cgo calls also use multiple OS threads with OpenSSL thread-local state.
    // Never unload this shared provider underneath any of those resources.
    ynx_provider *p = &pinned_provider;
    p->libctx = OSSL_LIB_CTX_new();
    if (p->libctx) p->provider = OSSL_PROVIDER_load(p->libctx, "default");
    char *version = NULL;
    OSSL_PARAM params[] = {
        OSSL_PARAM_construct_utf8_ptr(OSSL_PROV_PARAM_VERSION, &version, 0),
        OSSL_PARAM_construct_end()
    };
    if (p->provider && !strcmp(OSSL_PROVIDER_get0_name(p->provider), "default") &&
        OSSL_PROVIDER_get_params(p->provider, params) && version &&
        !strcmp(version, "3.6.4")) {
        p->sha256 = EVP_MD_fetch(p->libctx, "SHA256", "provider=default");
        if (p->sha256) provider_ready = 1;
    }
}
static int reject_password(char *buf, int size, int rwflag, void *userdata) {
    (void)buf; (void)size; (void)rwflag; (void)userdata;
    return 0;
}

static int load_service_key(SSL_CTX *ctx, const char *path) {
    // Check and read the same fd: no symlink substitution or broad key modes.
    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return 0;
    struct stat st;
    if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid != geteuid() ||
        (st.st_mode & 0077) || st.st_size <= 0 || st.st_size > (1 << 20)) {
        close(fd); return 0;
    }
    BIO *bio = BIO_new_fd(fd, BIO_CLOSE);
    if (!bio) { close(fd); return 0; }
    EVP_PKEY *key = PEM_read_bio_PrivateKey_ex(bio, NULL, reject_password, NULL,
                                               pinned_provider.libctx, "provider=default");
    BIO_free(bio);
    if (!key) return 0;
    int ok = EVP_PKEY_is_a(key, "ML-DSA-87") && SSL_CTX_use_PrivateKey(ctx, key);
    EVP_PKEY_free(key);
    return ok;
}

static void failure(char *out, size_t cap, const char *message) {
    // Error text contains neither private material nor certificate contents.
    snprintf(out, cap, "%s", message);
    ERR_clear_error();
}

static int pq_cert(X509 *cert) {
    EVP_PKEY *key = X509_get0_pubkey(cert);
    return key && EVP_PKEY_is_a(key, "ML-DSA-87") &&
           X509_get_signature_nid(cert) == NID_ML_DSA_87;
}

static int explicit_eku(X509 *cert, int purpose) {
    EXTENDED_KEY_USAGE *eku = X509_get_ext_d2i(cert, NID_ext_key_usage, NULL, NULL);
    if (!eku) return 0;
    int found = 0;
    for (int i = 0; i < sk_ASN1_OBJECT_num(eku); i++) {
        int nid = OBJ_obj2nid(sk_ASN1_OBJECT_value(eku, i));
        if (nid == NID_anyExtendedKeyUsage) { found = 0; break; }
        if (nid == purpose) found = 1;
    }
    EXTENDED_KEY_USAGE_free(eku);
    return found;
}

// Exact DNS SAN only: no CN fallback, wildcard, embedded NUL or case folding.
static int exact_san(X509 *cert, const char *expected, char *out, size_t cap) {
    GENERAL_NAMES *names = X509_get_ext_d2i(cert, NID_subject_alt_name, NULL, NULL);
    if (!names) return 0;
    int found = 0;
    for (int i = 0; i < sk_GENERAL_NAME_num(names); i++) {
        GENERAL_NAME *name = sk_GENERAL_NAME_value(names, i);
        if (name->type != GEN_DNS) continue;
        const unsigned char *value = ASN1_STRING_get0_data(name->d.dNSName);
        int length = ASN1_STRING_length(name->d.dNSName);
        if (length <= 0 || (size_t)length >= cap || memchr(value, 0, length) ||
            memchr(value, '*', length)) continue;
        if (expected && (strlen(expected) != (size_t)length ||
                         memcmp(value, expected, length))) continue;
        memcpy(out, value, length); out[length] = 0; found = 1; break;
    }
    GENERAL_NAMES_free(names);
    return found;
}

static int digest(X509 *cert, const EVP_MD *md, char *out) {
    unsigned char hash[EVP_MAX_MD_SIZE]; unsigned int length = 0;
    if (!X509_digest(cert, md, hash, &length) || length != 32) return 0;
    for (unsigned int i = 0; i < length; i++) snprintf(out + i*2, 3, "%02x", hash[i]);
    return 1;
}

static int verify_chain(int ok, X509_STORE_CTX *store) {
    return ok && pq_cert(X509_STORE_CTX_get_current_cert(store));
}

static SSL_CTX *new_fixed_context(char *err, size_t cap) {
    if (OpenSSL_version_num() != OPENSSL_VERSION_NUMBER) {
        failure(err, cap, "OpenSSL runtime differs from pinned build"); return NULL;
    }
    // An isolated library context prevents process-global OpenSSL config or
    // default properties from choosing a different cryptographic provider.
    if (!CRYPTO_THREAD_run_once(&provider_once, provider_init) || !provider_ready) {
        failure(err, cap, "pinned default provider 3.6.4 unavailable");
        return NULL;
    }
    ynx_provider *p = &pinned_provider;
    SSL_CTX *ctx = SSL_CTX_new_ex(p->libctx, "provider=default", TLS_method());
    if (!ctx) {
        failure(err, cap, "TLS context unavailable");
        return NULL;
    }
    SSL_CTX_set_default_passwd_cb(ctx, reject_password);
    if (!SSL_CTX_set_min_proto_version(ctx, TLS1_3_VERSION) ||
        !SSL_CTX_set_max_proto_version(ctx, TLS1_3_VERSION) ||
        !SSL_CTX_set1_groups_list(ctx, "SecP384r1MLKEM1024") ||
        !SSL_CTX_set_ciphersuites(ctx, "TLS_AES_256_GCM_SHA384") ||
        !SSL_CTX_set1_sigalgs_list(ctx, "mldsa87") ||
        !SSL_CTX_set1_client_sigalgs_list(ctx, "mldsa87") ||
        !SSL_CTX_set_num_tickets(ctx, 0) ||
        !SSL_CTX_set_max_early_data(ctx, 0)) {
        failure(err, cap, "fixed PQ TLS profile or service credential unavailable");
        SSL_CTX_free(ctx); return NULL;
    }
    return ctx;
}

static int finish_fixed_context(SSL_CTX *ctx, int server, char *err, size_t cap) {
    SSL_CTX_set_options(ctx, SSL_OP_NO_TICKET | SSL_OP_NO_RENEGOTIATION);
    SSL_CTX_set_session_cache_mode(ctx, SSL_SESS_CACHE_OFF);
    SSL_CTX_set_post_handshake_auth(ctx, 0);
    SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT, verify_chain);
    SSL_CTX_set_verify_depth(ctx, 4);
    X509 *local = SSL_CTX_get0_certificate(ctx); char san[256];
    if (!local || !pq_cert(local) || !explicit_eku(local, server ? NID_server_auth : NID_client_auth) ||
        !exact_san(local, NULL, san, sizeof(san)) ||
        X509_cmp_current_time(X509_get0_notBefore(local)) >= 0 ||
        X509_cmp_current_time(X509_get0_notAfter(local)) <= 0) {
        failure(err, cap, "local service requires ML-DSA-87 certificate, explicit EKU and DNS SAN");
        return 0;
    }
    return 1;
}

SSL_CTX *ynx_ctx_new(const char *cert, const char *key, const char *ca,
                     int server, char *err, size_t cap) {
    SSL_CTX *ctx = new_fixed_context(err, cap);
    if (!ctx) return NULL;
    if (!SSL_CTX_load_verify_locations(ctx, ca, NULL) ||
        !SSL_CTX_use_certificate_chain_file(ctx, cert) ||
        !load_service_key(ctx, key) || !SSL_CTX_check_private_key(ctx)) {
        failure(err, cap, "fixed PQ TLS profile or service credential unavailable");
        SSL_CTX_free(ctx); return NULL;
    }
    if (!finish_fixed_context(ctx, server, err, cap)) { SSL_CTX_free(ctx); return NULL; }
    return ctx;
}

/* A Native-only bounded BIO over an OWNED duplicate. pread changes only our
 * logical cursor, never the original shared open-file-description offset.
 * OpenSSL alone parses the key; no private byte getter or digest is exposed. */
typedef struct {
    int fd;
    off_t offset, length;
    struct stat seal;
    ynx_credential_fd_cleanup *cleanup;
    uint32_t bit;
} owned_fd_reader;
static BIO_METHOD *owned_fd_method;
static CRYPTO_ONCE owned_fd_once = CRYPTO_ONCE_STATIC_INIT;

static int same_fd_seal(const struct stat *a, const struct stat *b) {
    if (a->st_dev != b->st_dev || a->st_ino != b->st_ino || a->st_mode != b->st_mode ||
        a->st_uid != b->st_uid || a->st_size != b->st_size || a->st_nlink != b->st_nlink) return 0;
#ifdef __APPLE__
    return a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
           a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
#else
    return a->st_mtim.tv_sec == b->st_mtim.tv_sec && a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
           a->st_ctim.tv_sec == b->st_ctim.tv_sec && a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
#endif
}
static void close_owned_reader(owned_fd_reader *r) {
    if (r->fd < 0) return;
    if (close(r->fd)) r->cleanup->close_unknown |= r->bit;
    else if (r->bit == 1) r->cleanup->certificate_fd = -1;
    else r->cleanup->private_key_fd = -1;
    r->fd = -1; /* no close replay, including EINTR */
}
static int owned_fd_create(BIO *bio) { BIO_set_init(bio, 1);BIO_set_data(bio, NULL);return 1; }
static int owned_fd_destroy(BIO *bio) {
    owned_fd_reader *r = BIO_get_data(bio);
    if (r) { close_owned_reader(r);OPENSSL_free(r);BIO_set_data(bio, NULL); }
    BIO_set_init(bio, 0);return 1;
}
static int owned_fd_read(BIO *bio, char *out, int capacity) {
    owned_fd_reader *r = BIO_get_data(bio);
    if (!r || !out || capacity <= 0) return 0;
    if (r->offset >= r->length) return 0;
    size_t count = (size_t)(r->length - r->offset);
    if (count > (size_t)capacity) count = (size_t)capacity;
    ssize_t n;
    do { n = pread(r->fd, out, count, r->offset); } while (n < 0 && errno == EINTR);
    if (n <= 0 || n > capacity) return n < 0 ? -1 : 0;
    r->offset += n;return (int)n;
}
static int owned_fd_gets(BIO *bio, char *out, int capacity) {
    owned_fd_reader *r = BIO_get_data(bio);
    if (!r || !out || capacity <= 1) return 0;
    const off_t original = r->offset;
    int n = owned_fd_read(bio, out, capacity - 1);
    if (n <= 0) return n;
    char *newline = memchr(out, '\n', (size_t)n);
    if (newline) n = (int)(newline - out) + 1;
    r->offset = original + n;out[n] = 0;return n;
}
static long owned_fd_ctrl(BIO *bio, int command, long number, void *pointer) {
    (void)number;(void)pointer;owned_fd_reader *r = BIO_get_data(bio);
    if (!r) return 0;
    if (command == BIO_CTRL_EOF) return r->offset >= r->length;
    if (command == BIO_CTRL_PENDING) return (long)(r->length - r->offset);
    if (command == BIO_CTRL_FLUSH) return 1;
    return 0;
}
static void owned_fd_init(void) {
    BIO_METHOD *m = BIO_meth_new(BIO_TYPE_SOURCE_SINK | BIO_get_new_index(), "YNX bounded owned credential FD");
    if (!m) return;
    if (!BIO_meth_set_create(m, owned_fd_create) || !BIO_meth_set_destroy(m, owned_fd_destroy) ||
        !BIO_meth_set_read(m, owned_fd_read) || !BIO_meth_set_gets(m, owned_fd_gets) || !BIO_meth_set_ctrl(m, owned_fd_ctrl)) {
        BIO_meth_free(m);return;
    }
    owned_fd_method = m; /* method, not another crypto context/provider */
}
static BIO *borrow_credential_fd(int fd, int private_key, ynx_credential_fd_cleanup *cleanup) {
    struct stat st, after;int flags = fcntl(fd, F_GETFL);
    if (fd < 0 || flags < 0 || (flags & O_ACCMODE) != O_RDONLY || fstat(fd, &st) ||
        !S_ISREG(st.st_mode) || st.st_uid != geteuid() || st.st_nlink < 1 ||
        (st.st_mode & (private_key ? 0077 : 0022)) || st.st_size <= 0 || st.st_size > (1 << 20)) return NULL;
    if (!CRYPTO_THREAD_run_once(&owned_fd_once, owned_fd_init) || !owned_fd_method) return NULL;
    owned_fd_reader *r = OPENSSL_zalloc(sizeof(*r));
    if (!r) return NULL;
    r->fd = -1;r->cleanup = cleanup;r->bit = private_key ? 2U : 1U;r->seal = st;r->length = st.st_size;
    r->fd = fcntl(fd, F_DUPFD_CLOEXEC, 0);
    if (r->fd < 0) { OPENSSL_free(r);return NULL; }
    if (private_key) cleanup->private_key_fd = r->fd;else cleanup->certificate_fd = r->fd;
    if (fstat(r->fd, &after) || !same_fd_seal(&st, &after)) { close_owned_reader(r);OPENSSL_free(r);return NULL; }
    BIO *bio = BIO_new(owned_fd_method);
    if (!bio) { close_owned_reader(r);OPENSSL_free(r);return NULL; }
    BIO_set_data(bio, r);return bio;
}
static int reader_unchanged(BIO *bio) {
    owned_fd_reader *r = BIO_get_data(bio);struct stat st;
    return r && !fstat(r->fd, &st) && same_fd_seal(&r->seal, &st);
}
static X509 *read_owned_certificate(BIO *bio, int auxiliary) {
    X509 *cert = X509_new_ex(pinned_provider.libctx, "provider=default");
    if (!cert) return NULL;
    X509 *parsed = auxiliary ? PEM_read_bio_X509_AUX(bio, &cert, reject_password, NULL)
                             : PEM_read_bio_X509(bio, &cert, reject_password, NULL);
    if (!parsed) { X509_free(cert);return NULL; }
    EVP_PKEY *key = X509_get0_pubkey(parsed);
    if (!key || EVP_PKEY_get0_provider(key) != pinned_provider.provider) { X509_free(parsed);return NULL; }
    return parsed;
}
static int load_fd_chain(SSL_CTX *ctx, BIO *bio) {
    X509 *leaf = read_owned_certificate(bio, 1);
    if (!leaf) return 0;
    int ok = pq_cert(leaf) && SSL_CTX_use_certificate(ctx, leaf);
    X509_free(leaf);if (!ok) return 0;
    for (unsigned i = 0; ; ++i) {
        X509 *extra = read_owned_certificate(bio, 0);
        if (!extra) { ERR_clear_error();return BIO_eof(bio) && reader_unchanged(bio); }
        if (i >= 4 || !pq_cert(extra) || !SSL_CTX_add_extra_chain_cert(ctx, extra)) { X509_free(extra);return 0; }
    }
}
static int load_root_pem(SSL_CTX *ctx, const unsigned char *pem, size_t length) {
    BIO *bio = BIO_new_mem_buf(pem, (int)length);if (!bio) return 0;
    unsigned roots = 0;int ok = 1;
    for (;;) {
        X509 *root = read_owned_certificate(bio, 1);
        if (!root) { ERR_clear_error();ok = roots > 0 && BIO_eof(bio);break; }
        ok = ++roots <= 2 && pq_cert(root) && X509_check_ca(root) > 0 && X509_STORE_add_cert(SSL_CTX_get_cert_store(ctx), root);
        X509_free(root);if (!ok) break;
    }
    BIO_free(bio);return ok;
}
SSL_CTX *ynx_ctx_new_fds(int certificate_fd, int private_key_fd, const unsigned char *ca_pem, size_t ca_length,
                        const char *expected_certificate, int server, ynx_credential_fd_cleanup *cleanup,
                        char *err, size_t cap) {
    if (cleanup) { cleanup->certificate_fd = cleanup->private_key_fd = -1;cleanup->close_unknown = 0; }
    if (!cleanup || certificate_fd < 0 || private_key_fd < 0 || certificate_fd == private_key_fd ||
        !ca_pem || !ca_length || ca_length > (1U << 20) || !expected_certificate || strlen(expected_certificate) != 64 ||
        strspn(expected_certificate, "0123456789abcdef") != 64) {
        failure(err, cap, "bounded native FD credential unavailable");return NULL;
    }
    SSL_CTX *ctx = new_fixed_context(err, cap);if (!ctx) return NULL;
    BIO *cert = borrow_credential_fd(certificate_fd, 0, cleanup);
    BIO *key = borrow_credential_fd(private_key_fd, 1, cleanup);
    EVP_PKEY *parsed = key ? PEM_read_bio_PrivateKey_ex(key, NULL, reject_password, NULL, pinned_provider.libctx, "provider=default") : NULL;
    int ok = cert && key && parsed && EVP_PKEY_is_a(parsed, "ML-DSA-87") && load_root_pem(ctx, ca_pem, ca_length) &&
        load_fd_chain(ctx, cert) && reader_unchanged(key) && SSL_CTX_use_PrivateKey(ctx, parsed) && SSL_CTX_check_private_key(ctx);
    EVP_PKEY_free(parsed);BIO_free(cert);BIO_free(key);
    char actual[65];
    if (!ok || cleanup->close_unknown || !finish_fixed_context(ctx, server, err, cap) ||
        !digest(SSL_CTX_get0_certificate(ctx), pinned_provider.sha256, actual) || strcmp(actual, expected_certificate)) {
        failure(err, cap, cleanup->close_unknown ? "owned credential FD close unknown" : "fixed PQ FD credential or identity rejected");
        SSL_CTX_free(ctx);return NULL;
    }
    return ctx;
}

SSL *ynx_ssl_new(SSL_CTX *ctx, int fd, int server, const char *san) {
    SSL *ssl = SSL_new(ctx);
    if (!ssl) return NULL;
    if (!SSL_set_fd(ssl, fd)) { SSL_free(ssl); return NULL; }
    if (server) SSL_set_accept_state(ssl);
    else {
        SSL_set_connect_state(ssl);
        if (!SSL_set_tlsext_host_name(ssl, san)) { SSL_free(ssl); return NULL; }
    }
    return ssl;
}

// 1 success, 2 want-read, 3 want-write, 0 EOF, -1 terminal error.
static int status(SSL *ssl, int result, char *err, size_t cap) {
    if (result > 0) return 1;
    int code = SSL_get_error(ssl, result);
    if (code == SSL_ERROR_WANT_READ) return 2;
    if (code == SSL_ERROR_WANT_WRITE) return 3;
    if (code == SSL_ERROR_ZERO_RETURN) return 0;
    failure(err, cap, "native TLS operation rejected"); return -1;
}

int ynx_handshake(SSL *ssl, char *err, size_t cap) {
    ERR_clear_error(); return status(ssl, SSL_do_handshake(ssl), err, cap);
}
int ynx_read(SSL *ssl, void *data, size_t length, size_t *read, char *err, size_t cap) {
    ERR_clear_error(); return status(ssl, SSL_read_ex(ssl, data, length, read), err, cap);
}
int ynx_write(SSL *ssl, const void *data, size_t length, size_t *written, char *err, size_t cap) {
    ERR_clear_error(); return status(ssl, SSL_write_ex(ssl, data, length, written), err, cap);
}

int ynx_snapshot(SSL *ssl, const char *expected, int server,
                 ynx_tls_state *s, char *err, size_t cap) {
    memset(s, 0, sizeof(*s));
    X509 *peer = SSL_get0_peer_certificate(ssl), *local = SSL_get_certificate(ssl);
    STACK_OF(X509) *chain = SSL_get0_verified_chain(ssl);
    const char *signature = NULL, *local_signature = NULL;
    const char *group = SSL_group_to_name(ssl, SSL_get_negotiated_group(ssl));
    const char *cipher = SSL_get_cipher_name(ssl);
    if (!SSL_is_init_finished(ssl) || SSL_version(ssl) != TLS1_3_VERSION ||
        !group || strcmp(group, "SecP384r1MLKEM1024") ||
        !cipher || strcmp(cipher, "TLS_AES_256_GCM_SHA384") ||
        SSL_session_reused(ssl) || SSL_get_early_data_status(ssl) != SSL_EARLY_DATA_NOT_SENT ||
        SSL_get_verify_result(ssl) != X509_V_OK || !peer || !local ||
        !SSL_get0_peer_signature_name(ssl, &signature) || !signature ||
        strcmp(signature, "mldsa87") ||
        !SSL_get0_signature_name(ssl, &local_signature) || !local_signature ||
        strcmp(local_signature, "mldsa87") ||
        !exact_san(peer, expected, s->peer_san, sizeof(s->peer_san)) ||
        !exact_san(local, NULL, s->local_san, sizeof(s->local_san)) ||
        !explicit_eku(peer, server ? NID_client_auth : NID_server_auth) ||
        !chain || sk_X509_num(chain) < 2) {
        failure(err, cap, "TLS peer/profile/SAN/EKU verification rejected"); return 0;
    }
    for (int i = 0; i < sk_X509_num(chain); i++) {
        if (!pq_cert(sk_X509_value(chain, i))) {
            failure(err, cap, "certificate chain requires ML-DSA-87 including root"); return 0;
        }
    }
    ynx_provider *p = &pinned_provider;
    struct tm tm;
    if (!p || !ASN1_TIME_to_tm(X509_get0_notAfter(local), &tm) ||
        !digest(peer, p->sha256, s->peer_fingerprint) ||
        !digest(sk_X509_value(chain, sk_X509_num(chain)-1), p->sha256, s->root_fingerprint)) {
        failure(err, cap, "TLS peer metadata unavailable"); return 0;
    }
    s->not_after = (int64_t)timegm(&tm);
    for (int i = 0; i < sk_X509_num(chain); i++) {
        if (!ASN1_TIME_to_tm(X509_get0_notAfter(sk_X509_value(chain, i)), &tm)) {
            failure(err, cap, "certificate-chain validity unavailable"); return 0;
        }
        int64_t end = (int64_t)timegm(&tm);
        if (end < s->not_after) s->not_after = end;
    }
    STACK_OF(X509) *local_chain = NULL;
    SSL_get0_chain_certs(ssl, &local_chain);
    for (int i = 0; local_chain && i < sk_X509_num(local_chain); i++) {
        X509 *cert = sk_X509_value(local_chain, i);
        if (!pq_cert(cert) || !ASN1_TIME_to_tm(X509_get0_notAfter(cert), &tm) ||
            X509_cmp_current_time(X509_get0_notBefore(cert)) >= 0) {
            failure(err, cap, "local certificate-chain policy rejected"); return 0;
        }
        int64_t end = (int64_t)timegm(&tm);
        if (end < s->not_after) s->not_after = end;
    }
    if (s->not_after <= (int64_t)time(NULL)) {
        failure(err, cap, "TLS certificate chain or local identity expired"); return 0;
    }
    snprintf(s->protocol, sizeof(s->protocol), "%s", SSL_get_version(ssl));
    snprintf(s->group, sizeof(s->group), "%s", group);
    snprintf(s->cipher, sizeof(s->cipher), "%s", cipher);
    snprintf(s->signature, sizeof(s->signature), "%s", signature);
    s->verified = s->mutual = s->chain_pq = 1;
    return 1;
}

int ynx_export(SSL *ssl, const char *label, size_t label_len,
               const unsigned char *context, size_t context_len,
               unsigned char *out, size_t length) {
    return SSL_export_keying_material(ssl, out, length, label, label_len, context, context_len, 1);
}

int ynx_peer_spki_der(SSL *ssl, unsigned char *out, size_t capacity,
                      size_t *length, char *err, size_t err_capacity) {
    if (length) *length = 0;
    if (!ssl || !out || !length || !capacity || capacity > YNX_PEER_SPKI_DER_MAX ||
        !SSL_is_init_finished(ssl) || SSL_get_verify_result(ssl) != X509_V_OK) {
        failure(err, err_capacity, "held TLS peer SPKI unavailable"); return 0;
    }
    X509 *peer = SSL_get0_peer_certificate(ssl);
    X509_PUBKEY *spki = peer ? X509_get_X509_PUBKEY(peer) : NULL;
    int needed = spki ? i2d_X509_PUBKEY(spki, NULL) : 0;
    if (needed <= 0 || (size_t)needed > YNX_PEER_SPKI_DER_MAX ||
        (size_t)needed > capacity) {
        failure(err, err_capacity, "held TLS peer SPKI exceeds bound or is unavailable"); return 0;
    }
    // The Go SSL mutex spans both length inspection and this copy. Neither the
    // borrowed X509/SPKI pointer nor the output buffer is retained by this helper.
    unsigned char *cursor = out;
    if (i2d_X509_PUBKEY(spki, &cursor) != needed || cursor != out + needed) {
        failure(err, err_capacity, "held TLS peer SPKI copy failed"); return 0;
    }
    *length = (size_t)needed;
    return 1;
}

int ynx_ctx_server_identity(SSL_CTX *ctx, ynx_server_identity *out,
                            char *err, size_t err_capacity) {
    if (out) memset(out, 0, sizeof(*out));
    if (!ctx || !out || !err || !err_capacity) return 0;
    const char *reason = "held fixed server context identity unavailable";
    GENERAL_NAMES *names = NULL;
    X509_STORE_CTX *verification = NULL;
    int ok = 0;
    ynx_provider *p = &pinned_provider;
    /* No provider/context construction or mutable TLS setting occurs here.
     * Go owns the server role and holds the original Context mutex. The
     * private pointer comes only from the unchanged fixed constructors. */
    if (!provider_ready || !p->provider || !p->sha256 ||
        OpenSSL_version_num() != OPENSSL_VERSION_NUMBER ||
        SSL_CTX_get_ssl_method(ctx) != TLS_method() ||
        SSL_CTX_get_min_proto_version(ctx) != TLS1_3_VERSION ||
        SSL_CTX_get_max_proto_version(ctx) != TLS1_3_VERSION ||
        SSL_CTX_get_verify_mode(ctx) != (SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT) ||
        SSL_CTX_get_verify_callback(ctx) != verify_chain || SSL_CTX_get_verify_depth(ctx) != 4 ||
        SSL_CTX_get_session_cache_mode(ctx) != SSL_SESS_CACHE_OFF ||
        SSL_CTX_get_num_tickets(ctx) != 0 || SSL_CTX_get_max_early_data(ctx) != 0 ||
        (SSL_CTX_get_options(ctx) & (SSL_OP_NO_TICKET | SSL_OP_NO_RENEGOTIATION)) !=
            (SSL_OP_NO_TICKET | SSL_OP_NO_RENEGOTIATION)) goto done;
    STACK_OF(SSL_CIPHER) *ciphers = SSL_CTX_get_ciphers(ctx);
    int tls13_ciphers = 0;
    for (int i = 0; ciphers && i < sk_SSL_CIPHER_num(ciphers); ++i) {
        const SSL_CIPHER *cipher = sk_SSL_CIPHER_value(ciphers, i);
        if (!strcmp(SSL_CIPHER_get_version(cipher), "TLSv1.3")) {
            if (strcmp(SSL_CIPHER_get_name(cipher), "TLS_AES_256_GCM_SHA384")) goto done;
            ++tls13_ciphers;
        }
    }
    if (tls13_ciphers != 1) goto done;
    X509 *leaf = SSL_CTX_get0_certificate(ctx);
    if (!leaf || !pq_cert(leaf) || X509_check_ca(leaf) != 0 ||
        !explicit_eku(leaf, NID_server_auth) ||
        EVP_PKEY_get0_provider(X509_get0_pubkey(leaf)) != p->provider) goto done;
    STACK_OF(X509) *local_chain = NULL;
    SSL_CTX_get0_chain_certs(ctx, &local_chain);
    if (!local_chain) SSL_CTX_get_extra_chain_certs_only(ctx, &local_chain);
    if (local_chain && sk_X509_num(local_chain) > 4) goto done;
    verification = X509_STORE_CTX_new_ex(p->libctx, "provider=default");
    if (!verification || !X509_STORE_CTX_init(verification, SSL_CTX_get_cert_store(ctx), leaf, local_chain) ||
        !X509_VERIFY_PARAM_set1(X509_STORE_CTX_get0_param(verification), SSL_CTX_get0_param(ctx)) ||
        !X509_STORE_CTX_set_purpose(verification, X509_PURPOSE_SSL_SERVER)) goto done;
    X509_STORE_CTX_set_verify_cb(verification, verify_chain);
    if (X509_verify_cert(verification) != 1) {
        reason = "held server certificate chain verification rejected";goto done;
    }
    STACK_OF(X509) *verified = X509_STORE_CTX_get0_chain(verification);
    if (!verified || sk_X509_num(verified) < 2 || sk_X509_num(verified) > 6) goto done;
    /* All configured local certificates participate in the validity bound,
     * even if a supplied extra was not selected by chain construction. The
     * selected original trust-store root is checked too; no issuer is minted. */
    int64_t beginning = INT64_MIN, ending = INT64_MAX;
    for (int set = 0; set < 3; ++set) {
        STACK_OF(X509) *chain = set == 1 ? local_chain : verified;
        const int count = set == 0 ? 1 : chain ? sk_X509_num(chain) : 0;
        for (int i = 0; i < count; ++i) {
            X509 *cert = set == 0 ? leaf : sk_X509_value(chain, i);
            struct tm before, after;
            if (!cert || !pq_cert(cert) || EVP_PKEY_get0_provider(X509_get0_pubkey(cert)) != p->provider ||
                X509_cmp_current_time(X509_get0_notBefore(cert)) >= 0 ||
                X509_cmp_current_time(X509_get0_notAfter(cert)) <= 0 ||
                !ASN1_TIME_to_tm(X509_get0_notBefore(cert), &before) ||
                !ASN1_TIME_to_tm(X509_get0_notAfter(cert), &after)) {
                reason = "held local certificate chain validity or ML-DSA policy rejected";goto done;
            }
            errno = 0;const time_t start = timegm(&before);
            if (errno == EOVERFLOW) goto done;
            errno = 0;const time_t end = timegm(&after);
            if (errno == EOVERFLOW || start >= end) goto done;
            if ((int64_t)start > beginning) beginning = (int64_t)start;
            if ((int64_t)end < ending) ending = (int64_t)end;
        }
    }
    names = X509_get_ext_d2i(leaf, NID_subject_alt_name, NULL, NULL);
    if (!names) goto done;
    for (int i = 0; i < sk_GENERAL_NAME_num(names); ++i) {
        const GENERAL_NAME *name = sk_GENERAL_NAME_value(names, i);
        if (name->type != GEN_DNS) continue;
        const unsigned char *value = ASN1_STRING_get0_data(name->d.dNSName);
        const int length = ASN1_STRING_length(name->d.dNSName);
        if (!value || length <= 0 || length > 253 || out->dns_count >= YNX_SERVER_DNS_MAX) goto done;
        size_t label = 0;
        for (int at = 0; at < length; ++at) {
            const unsigned char c = value[at];
            if (c == '.') {
                if (!label || label > 63 || value[at - 1] == '-') goto done;
                label = 0;
            } else {
                if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '-') || (!label && c == '-')) goto done;
                ++label;
            }
        }
        if (!label || label > 63 || value[length - 1] == '-') goto done;
        for (size_t prior = 0; prior < out->dns_count; ++prior)
            if (strlen(out->dns_names[prior]) == (size_t)length && !memcmp(out->dns_names[prior], value, (size_t)length)) goto done;
        memcpy(out->dns_names[out->dns_count], value, (size_t)length);
        out->dns_names[out->dns_count++][length] = 0;
    }
    if (!out->dns_count) goto done;
    X509_PUBKEY *spki = X509_get_X509_PUBKEY(leaf);
    const int cert_length = i2d_X509(leaf, NULL), spki_length = spki ? i2d_X509_PUBKEY(spki, NULL) : 0;
    if (cert_length <= 0 || (size_t)cert_length > YNX_SERVER_CERT_DER_MAX ||
        spki_length <= 0 || (size_t)spki_length > YNX_SERVER_SPKI_DER_MAX) {
        reason = "held server public DER exceeds fixed bounds";goto done;
    }
    unsigned char *cursor = out->certificate_der;
    if (i2d_X509(leaf, &cursor) != cert_length || cursor != out->certificate_der + cert_length) goto done;
    cursor = out->spki_der;
    if (i2d_X509_PUBKEY(spki, &cursor) != spki_length || cursor != out->spki_der + spki_length) goto done;
    out->certificate_der_length = (size_t)cert_length;out->spki_der_length = (size_t)spki_length;
    for (int kind = 0; kind < 2; ++kind) {
        unsigned char hash[32];unsigned int length = 0;
        const unsigned char *data = kind ? out->spki_der : out->certificate_der;
        const size_t bytes = kind ? out->spki_der_length : out->certificate_der_length;
        char *hex = kind ? out->spki_sha256 : out->certificate_sha256;
        if (!EVP_Digest(data, bytes, hash, &length, p->sha256, NULL) || length != sizeof(hash)) goto done;
        for (size_t i = 0; i < sizeof(hash); ++i) snprintf(hex + i * 2, 3, "%02x", hash[i]);
    }
    out->not_before = beginning;out->not_after = ending;
    snprintf(out->runtime_version, sizeof(out->runtime_version), "%s", OpenSSL_version(OPENSSL_VERSION));
    snprintf(out->protocol, sizeof(out->protocol), "%s", "TLSv1.3");
    /* Group/signature are the unchanged private constructor's fixed profile,
     * not a fabricated negotiated peer state. OpenSSL exposes no getter for
     * these configured lists; there is no caller setter on native.Context. */
    snprintf(out->group, sizeof(out->group), "%s", "SecP384r1MLKEM1024");
    snprintf(out->cipher, sizeof(out->cipher), "%s", "TLS_AES_256_GCM_SHA384");
    snprintf(out->signature, sizeof(out->signature), "%s", "mldsa87");
    out->server_auth = out->mutual = out->tickets_off = 1;
    out->version = 1;out->size = (uint32_t)sizeof(*out);ok = 1;
done:
    GENERAL_NAMES_free(names);X509_STORE_CTX_free(verification);
    if (!ok) {memset(out, 0, sizeof(*out));failure(err, err_capacity, reason);}
    return ok;
}
const char *ynx_runtime_version(void) { return OpenSSL_version(OPENSSL_VERSION); }
