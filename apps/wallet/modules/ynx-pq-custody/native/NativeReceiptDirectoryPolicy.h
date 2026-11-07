#pragma once
#include "MobileReceiptNativeSelectionPrivate.hpp"
namespace ynx::mobilepq::registered {
// Native's independently compiled lookup constraint. It grants no Source or
// account authority and cannot replace the actual named/held FD pinning.
// No runtime row, Source value, caller callback or JS setter supplies this map.
bool matchesNativeCompiledReceiptDirectory(
 const ynx::auth::mobile::receipt::OriginalSourceSelection&,
 const ynx::auth::mobile::receipt::DirectoryDATA&)noexcept;
}
