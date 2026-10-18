#include "veil_pq_auth.h"
#include <oqs/oqs.h>
#include <sodium.h>
#include <string.h>

static const uint8_t context[] = "YNX/SOCIAL/PQ-AUTH/V1";
struct veil_pq_key {
    OQS_SIG *algorithm;
    uint8_t public_key[VEIL_PQ_PUBLIC_BYTES];
    uint8_t *secret;
};

static OQS_SIG *algorithm(void) {
    OQS_SIG *a = OQS_SIG_new(OQS_SIG_alg_ml_dsa_87);
    if (!a) return NULL;
    if (strcmp(a->method_name, "ML-DSA-87") || strcmp(a->alg_version, "FIPS204") ||
        a->length_public_key != VEIL_PQ_PUBLIC_BYTES || a->length_secret_key != 4896 ||
        a->length_signature != VEIL_PQ_SIGNATURE_BYTES || !a->sig_with_ctx_support) {
        OQS_SIG_free(a); return NULL;
    }
    return a;
}

veil_pq_key *veil_pq_key_generate(void) {
    if (sodium_init() < 0) return NULL;
    veil_pq_key *k = sodium_malloc(sizeof(*k));
    if (!k) return NULL;
    memset(k, 0, sizeof(*k));
    k->algorithm = algorithm();
    if (!k->algorithm) { veil_pq_key_destroy(k); return NULL; }
    k->secret = sodium_malloc(k->algorithm->length_secret_key);
    if (!k->secret) { veil_pq_key_destroy(k); return NULL; }
    /* Do not silently accept unlocked secret storage in this candidate. */
    if (sodium_mlock(k->secret, k->algorithm->length_secret_key) != 0 ||
        OQS_SIG_keypair(k->algorithm, k->public_key, k->secret) != OQS_SUCCESS) {
        veil_pq_key_destroy(k); return NULL;
    }
    return k;
}

void veil_pq_key_destroy(veil_pq_key *k) {
    if (!k) return;
    if (k->secret) sodium_free(k->secret);
    OQS_SIG_free(k->algorithm);
    sodium_free(k);
}

int veil_pq_public(const veil_pq_key *k, uint8_t *out, size_t capacity) {
    if (!k || !out || capacity != VEIL_PQ_PUBLIC_BYTES) return 0;
    memcpy(out, k->public_key, capacity); return 1;
}

int veil_pq_sign(const veil_pq_key *k, const uint8_t *m, size_t n,
                 uint8_t *sig, size_t capacity, size_t *written) {
    if (written) *written = 0;
    if (!sig || capacity != VEIL_PQ_SIGNATURE_BYTES) return 0;
    sodium_memzero(sig, capacity);
    if (!k || !m || !n || n > VEIL_PQ_MAX_PUBLIC_INPUT || !written) return 0;
    if (OQS_SIG_sign_with_ctx_str(k->algorithm, sig, written, m, n,
                                  context, sizeof(context)-1, k->secret) != OQS_SUCCESS ||
        *written != VEIL_PQ_SIGNATURE_BYTES) {
        sodium_memzero(sig, capacity); *written = 0; return 0;
    }
    return 1;
}

int veil_pq_verify(const uint8_t *pk, size_t pn, const uint8_t *m, size_t n,
                   const uint8_t *sig, size_t sn) {
    if (!pk || pn != VEIL_PQ_PUBLIC_BYTES || !m || !n || n > VEIL_PQ_MAX_PUBLIC_INPUT ||
        !sig || sn != VEIL_PQ_SIGNATURE_BYTES) return 0;
    OQS_SIG *a = algorithm();
    if (!a) return 0;
    int ok = OQS_SIG_verify_with_ctx_str(a, m, n, sig, sn,
                                        context, sizeof(context)-1, pk) == OQS_SUCCESS;
    OQS_SIG_free(a); return ok;
}
