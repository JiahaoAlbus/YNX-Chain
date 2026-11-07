#pragma once
#include <cstdint>
#include <memory>
#include <string>
namespace ynx::sdk::mobileapplication {
// REQUIRED P08 native normal install loan, not an already supplied platform ABI.
// No callback, registry, provider setter, JS path/hash/bundleID or Root row.
struct Failure {bool present=false;int32_t code=0;};
struct Capture {
 std::string platform,applicationId,installedAppIdentityDigest;
 std::string manifestDigest,implementingImageDigest,privateModuleDigest;
};
// Concrete OS-owned implementation; only the original P08 platform install
// producer defines Storage/acquire. No public constructor or DTO->owner path.
class InstalledApplicationOriginal final {
 struct Storage;std::unique_ptr<Storage>storage_;
 InstalledApplicationOriginal();
public:
 ~InstalledApplicationOriginal();
 InstalledApplicationOriginal(const InstalledApplicationOriginal&)=delete;
 InstalledApplicationOriginal&operator=(const InstalledApplicationOriginal&)=delete;
 // Adopt nonnull partial before Failure.present, including code0.
 static Failure acquire(std::unique_ptr<InstalledApplicationOriginal>&)noexcept;
 Failure readCaptured(Capture&)noexcept;
 // Rechecks genuine OS application incarnation and SAME installation/artifacts.
 Failure current()noexcept;
 void retire()noexcept;
 Failure close(bool&physicalDone)noexcept;
};
}
