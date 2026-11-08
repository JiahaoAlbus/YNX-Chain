#pragma once
#include "CollectorPrivate.hpp"
#include <string>
namespace ynx::auth::android_device_provisioning {
// Sole pure evaluator supplies verified enrollment.gatewayOrigin and verified
// association.account. RootCapture keeps them under SAME origin/math/current;
// no extra Root mapping and no inference from URL/intent/received peer fields.
struct SourceNamespace{std::string issuer,subject,purpose,source_id,instance_id,source_generation;};
void read_source_namespace(ynx_original_android_provision_source_v1*,SourceNamespace&,ynx_auth_android_provision_failure_v1*);
struct CreationCoordinates{std::string device_generation,canonical_owner;};
void read_creation_coordinates(ynx_original_android_provision_source_v1*,CreationCoordinates&,ynx_auth_android_provision_failure_v1*);
}
