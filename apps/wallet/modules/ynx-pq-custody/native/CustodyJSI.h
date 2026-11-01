#pragma once
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <memory>
namespace ynx::mobilepq {
// Fixed native boot only. No JS-supplied provider, library path or credentials.
bool install(facebook::jsi::Runtime&,std::shared_ptr<facebook::react::CallInvoker>);
// Invalidates completion delivery; custody stays in native inventory. Platform
// must call off JS thread and retain module on false (cleanup debt).
bool invalidate();
}
