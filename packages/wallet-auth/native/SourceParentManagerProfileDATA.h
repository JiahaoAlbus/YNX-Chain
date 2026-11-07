#pragma once
// PRIVATE SDK image DATA bridge only. Auth owns trusted profile read/current.
#include <array>
#include <cstdint>
namespace ynx::sdk::sourceparent {
struct IndependentImagesDATA {
  std::array<std::uint8_t,32> parentCreator{},coreChild{},nativeChild{};
  bool operator==(const IndependentImagesDATA& b)const noexcept {
    return parentCreator==b.parentCreator&&coreChild==b.coreChild&&nativeChild==b.nativeChild;
  }
  static constexpr bool dataOnly=true,RootAdmission=false,SourceAdmission=false,NativeAdmission=false;
};
// Call only after the SAME original qualified::readOriginalNormalHostProfile
// succeeds and its actual owner remains current. Copying shapes is not admission.
template<class ActualProfile>
IndependentImagesDATA copyOriginalProfileImagesDATA(const ActualProfile& p) {
  return {p.independentlyExpectedImages.parentCreator,
          p.independentlyExpectedImages.coreChild,
          p.independentlyExpectedImages.nativeChild};
}
// No Manager pointer, home, JSON, Source lease, new purpose or native initializer.
// Original Go Manager capture stays in the SAME Go process/package; never pass
// a Go *Manager into C++ or serialize its address across process/JS boundaries.
}
