#pragma once
#include "AIMobileProducerState.h"
namespace ynx::mobileai::transport {
// Private stack frame in the REAL producer dispatch body only. No callback,
// global setter or JS input establishes the executing Native producer.
class OriginalDispatchFrame final {
 std::shared_ptr<producer::Producer>previous_;
public:
 explicit OriginalDispatchFrame(const std::shared_ptr<producer::Producer>&);
 ~OriginalDispatchFrame();
 OriginalDispatchFrame(const OriginalDispatchFrame&)=delete;
 OriginalDispatchFrame&operator=(const OriginalDispatchFrame&)=delete;
};
}
