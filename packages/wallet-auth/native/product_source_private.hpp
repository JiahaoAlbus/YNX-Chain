#pragma once
#include <node_api.h>
// Same common-image registrar only. No JS setter, provider, Root selector,
// caller namespace/path or returned JSON can install admission. This module's
// currently implemented factory returns a branded owned partial and throws
// PRODUCT_SOURCE_CAPTURE_FAILED with precise independent producer cause.
extern "C" napi_value RegisterOriginalProductSource(napi_env,napi_value);
