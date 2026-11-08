#pragma once
// Auth-owned pure DATA encoder, NOT a parser, verifier, source constructor,
// Root provider or original capture registry. Only RootCapture's actual owner
// can hand the resulting bytes to its recognized private capture borrow.
#include <array>
#include <cstdint>
#include <string>
namespace ynx::auth::android_capture {
struct SelectedPolicy;
struct Batch {
 std::string node_origin,node_spki,native_chain_id;
 std::string root_raw,enrollment_raw,profile_raw,head_raw;
 std::string policy_canonical,previous_canonical;
 std::array<std::string,4> before_raw4,after_raw4;
 std::string current_raw,nonce;
 std::int64_t baseline_at_ms=0,current_at_ms=0,after_at_ms=0;
};
enum class EncodeError:int { capacity=74021,utf8=74022,clock=74023,arguments=74024 };
// Bounded exact-byte JSON serialization only. Opaque raw policy/previous JSON
// is not trusted or parsed here; sole SDK performs its canonical/schema checks.
// This function never observes the clock, generates a nonce, fetches, logs or
// changes a Root/custody state. Batch fields must come from actual Auth capture.
std::string encode(const Batch&);
// Pure closed-eight-field DATA serializer, not a Root/Source constructor.
// Reuses exactly encode()'s UTF-8 and JSON quoting. Only explicit android rows.
std::string encode_policy(const SelectedPolicy&);
}
