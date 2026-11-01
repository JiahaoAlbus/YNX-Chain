#pragma once
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <memory>
#include <cstdint>
namespace ynx::mobilepq {
// Fixed native boot only. No JS-supplied provider, library path or credentials.
// Adopt a partial Native lifecycle binding before interpreting status/error.
// It stays in the platform module, never in JS or a public status snapshot.
bool install(facebook::jsi::Runtime&,std::shared_ptr<facebook::react::CallInvoker>,uint64_t* binding);
// Call synchronously before scheduling async teardown or destroying the RN
// runtime. Only atomic delivery/effect gates; never waits for custody/OS close.
bool requestInvalidate(uint64_t binding);
// Invalidates completion delivery; custody stays in native inventory. Platform
// must call off JS thread and retain module on false (cleanup debt).
bool invalidate(uint64_t binding);
}
