#pragma once
#include <stddef.h>
typedef void* napi_env;typedef void* napi_value;typedef void* napi_ref;
enum napi_status{napi_ok,napi_generic_failure};enum napi_valuetype{napi_undefined,napi_object,napi_function};
extern "C" {
napi_status napi_is_exception_pending(napi_env,bool*);napi_status napi_get_and_clear_last_exception(napi_env,napi_value*);
napi_status napi_create_object(napi_env,napi_value*);napi_status napi_set_named_property(napi_env,napi_value,const char*,napi_value);
napi_status napi_create_reference(napi_env,napi_value,unsigned,napi_ref*);napi_status napi_get_reference_value(napi_env,napi_ref,napi_value*);napi_status napi_delete_reference(napi_env,napi_ref);
napi_status napi_get_named_property(napi_env,napi_value,const char*,napi_value*);napi_status napi_typeof(napi_env,napi_value,napi_valuetype*);
}
