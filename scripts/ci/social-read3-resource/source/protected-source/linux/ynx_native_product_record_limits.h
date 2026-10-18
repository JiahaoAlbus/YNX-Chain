#ifndef YNX_NATIVE_PRODUCT_RECORD_LIMITS_H
#define YNX_NATIVE_PRODUCT_RECORD_LIMITS_H
#include <stddef.h>
/* Normal product JSON bytes. NOT the separate 1MiB UI projection cap,
 * Signal record format, Source grant, key size or permission limit. */
#define YNX_PRODUCT_JSON_MAX ((size_t)8388608)
#define YNX_PRODUCT_ID_BYTES_MAX ((size_t)1024)
#define YNX_PRODUCT_ROW_PLAIN_MAX (YNX_PRODUCT_JSON_MAX + YNX_PRODUCT_ID_BYTES_MAX + 16)
#define YNX_PRODUCT_ROW_CIPHER_MAX (YNX_PRODUCT_ROW_PLAIN_MAX + 320 + 16)
#define YNX_PRODUCT_TX_JSON_MAX ((size_t)33554432)
#define YNX_PRODUCT_TX_PREDECESSOR_MAX ((size_t)67108864)
#define YNX_PRODUCT_CATALOG_CIPHER_MAX ((size_t)67108864)
#endif
