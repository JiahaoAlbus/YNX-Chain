#pragma once
#include <cstddef>
namespace ynx_auth_private {
// Bounded PUBLIC canonical v2 dual-PQ envelopes. This changes transport and
// filesystem capacity only: old v1 credential verification retains its own
// exact format/limits; no version fallback, trust or authority is granted.
// N1 contains both real 4627B/49856B signatures and a complete registered pair,
// so the old 65536B file cap cannot hold its base64url canonical envelope.
inline constexpr std::size_t OriginalAuthPublicOriginalMax=393216;
inline constexpr std::size_t OriginalAuthPublicRootMax=16384;
inline constexpr std::size_t OriginalAuthVerifierInputMax=2097152;
inline constexpr std::size_t OriginalAuthVerifierOutputMax=1048576;
}
