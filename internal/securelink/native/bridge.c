//go:build securelink_openssl && cgo

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

SSL_CTX *ynx_ctx_new(const char *cert, const char *key, const char *ca,
                     int server, char *err, size_t cap) {
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
        !SSL_CTX_set_max_early_data(ctx, 0) ||
        !SSL_CTX_load_verify_locations(ctx, ca, NULL) ||
        !SSL_CTX_use_certificate_chain_file(ctx, cert) ||
        !load_service_key(ctx, key) ||
        !SSL_CTX_check_private_key(ctx)) {
        failure(err, cap, "fixed PQ TLS profile or service credential unavailable");
        SSL_CTX_free(ctx); return NULL;
    }
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
        SSL_CTX_free(ctx); return NULL;
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
const char *ynx_runtime_version(void) { return OpenSSL_version(OPENSSL_VERSION); }
