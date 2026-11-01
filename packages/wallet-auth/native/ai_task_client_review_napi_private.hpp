#pragma once
#include <node_api.h>
#include "ai_task_client_root_private.hpp"
// Called only by the normal fixed-image factory AFTER its actual Root capture.
// Neither constructor is a JS export or accepts a caller Root/provider.
napi_value CreateOriginalAITaskClientReviewBridgeV6(napi_env,const std::shared_ptr<ynx::ai::client::OriginalClientRoot>&);
napi_value IsOriginalAITaskActionV6Review(napi_env,napi_callback_info);
