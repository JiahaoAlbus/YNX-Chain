#pragma once
#include <OriginalAccountPurposeChildPrivate.hpp>
#include <account_source_acquisition_private.hpp>
#include <normal_native_backend_private.hpp>
#include <MobileAccountProofWireDATA.hpp>
#include <thread>

namespace ynx::sdk::mobile::accountproof {
// Read-only intrinsic association in the actual owning Reader inventory.
// No constructor, public registration or Source authorization is supplied.
bool readerBelongsToPurposeChild(Reader*,ynx::native::accountproof::OriginalAccountPurposeChild*,ynx::auth::mobile::receipt::OriginalEngineSource*)noexcept;
}

namespace ynx::native::accountproof {
// Methods are the private owning Native/P09 composition, never callbacks or
// an engineReference/descriptor registry. Only the actual normal startup may
// supply its previously captured OriginalLaunch to the zero-selector factory.
struct OriginalAccountPurposeChild final {
  Failure current(Source*)noexcept;
  Failure firstFailure()const noexcept;
  const ynx::auth::mobile::receipt::EngineSelection& selection()const noexcept;
  Failure attachReader(ynx::sdk::mobile::accountproof::Reader*,Source*)noexcept;
  void releaseReader(ynx::sdk::mobile::accountproof::Reader*)noexcept;
  ynx::network::accountproof::ExchangeResult exchange(
      const ynx::sdk::mobile::accountproof::Bytes&,
      ynx::sdk::mobile::accountproof::Bytes&,bool cleanup)noexcept;
 private:
  // The complete inventory/Source/parent/drain state is kept in the owning TU.
  struct Impl;
  // Published once; retained through a concurrent rejected-thread lookup.
  std::shared_ptr<Impl> impl;
  Failure initialize(Source*,ynx::network::normalnative::AccountAcquisition)noexcept;
  Failure finishClose()noexcept;
  friend OriginalAccountPurposeChild* originalChildForAccountProofHostPort(ynx::sdk::mobile::accountproof::HostPort*)noexcept;
  friend Acquisition acquireOriginalAccountPurposeChild(Source*)noexcept;
  friend Failure readOriginalAccountPurposeChild(OriginalAccountPurposeChild*,Source*,ynx::sdk::mobile::accountproof::HostPort*&)noexcept;
  friend Failure currentOriginalAccountPurposeChild(OriginalAccountPurposeChild*,Source*)noexcept;
  friend void retireOriginalAccountPurposeChild(OriginalAccountPurposeChild*)noexcept;
  friend Failure joinOriginalAccountPurposeChild(OriginalAccountPurposeChild*)noexcept;
  friend Failure closeOriginalAccountPurposeChild(OriginalAccountPurposeChild*)noexcept;
  friend bool originalAccountPurposeChildClosed(OriginalAccountPurposeChild*)noexcept;
  friend Failure releaseClosedOriginalAccountPurposeChild(OriginalAccountPurposeChild*)noexcept;
};
// Checks the actual child inventory without dereferencing an unrecognized
// supplied pointer. It cannot register a HostPort or select a backend.
OriginalAccountPurposeChild* originalChildForAccountProofHostPort(ynx::sdk::mobile::accountproof::HostPort*)noexcept;
}
