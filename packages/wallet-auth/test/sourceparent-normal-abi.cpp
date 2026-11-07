#include "SourceParentOriginalProfilePrivate.hpp"
#include "SourceParentManagerProfileDATA.h"
#include "normal_native_backend_private.hpp"
#include <type_traits>
using namespace ynx::auth::sourceparent;
static_assert(std::is_same_v<decltype(acquireOriginalSourceParentParentProfile()),OriginalProfileAcquisition>);
static_assert(std::is_same_v<decltype(acquireOriginalSourceParentCoreProfile()),OriginalProfileAcquisition>);
static_assert(std::is_same_v<decltype(acquireOriginalSourceParentNativeProfile()),OriginalProfileAcquisition>);
using Real=ynx::network::normalnative::qualified::Profile;
static_assert(sizeof(Real{}.independentlyExpectedImages.parentCreator)==32);
static_assert(sizeof(Real{}.independentlyExpectedImages.coreChild)==32);
static_assert(sizeof(Real{}.independentlyExpectedImages.nativeChild)==32);
static_assert(std::is_same_v<decltype(ynx::sdk::sourceparent::copyOriginalProfileImagesDATA(Real{})),ynx::sdk::sourceparent::IndependentImagesDATA>);
static_assert(std::is_same_v<decltype(ynx::network::normalnative::qualified::readOriginalNormalHostProfile(*static_cast<Real*>(nullptr))),ynx::network::normalnative::Outcome>);
