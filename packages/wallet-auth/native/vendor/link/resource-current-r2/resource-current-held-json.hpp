#ifndef YNX_RESOURCE_CURRENT_HELD_JSON_HPP
#define YNX_RESOURCE_CURRENT_HELD_JSON_HPP

#include "resource-current-json.hpp"

// The original P09 held-reader extension, decoded as unsigned transport DATA.
// Expected process identities are independent native inputs, never learned
// from these observations. Same-fd ownership, same-session monotonicity, live
// clock checks and physical cleanup remain the native client's responsibility.
namespace ynx::resource_current_detail {

struct HeldProcessIdentity {
    std::int32_t pid = 0;
    std::uint32_t uid = 0;
    std::string start_identity, image_path, image_sha256;
};

struct HeldObservation {
    std::string session_id;
    HeldProcessIdentity server, caller;
    bool partial_acquired = false, retired = false, joined = false, physical_complete = false;
};

enum class HeldAction { current, retire, join, close };

struct HeldReply {
    std::string code;
    bool has_data = false;
    CurrentData data;
    HeldObservation observation;
};

namespace held_json_impl {
using json_impl::Value;

inline bool lower_sha256(const std::string &value) {
    if (value.size() != 64) return false;
    for (char c : value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

inline bool process_shape(const HeldProcessIdentity &expected, std::uint32_t client_uid) {
    return expected.pid > 0 && expected.uid == client_uid && !expected.start_identity.empty() &&
        expected.start_identity.size() <= 160 && json_impl::utf8(expected.start_identity) &&
        !expected.image_path.empty() && expected.image_path[0] == '/' && expected.image_path.size() <= 4096 &&
        json_impl::utf8(expected.image_path) && lower_sha256(expected.image_sha256);
}

inline bool process(const Value &value, const HeldProcessIdentity &expected) {
    using namespace json_impl;
    if (!fields(value, {"pid", "uid", "startIdentity", "imagePath", "imageSHA256"})) return false;
    std::uint64_t pid, uid;
    return integer(field(value, "pid"), std::numeric_limits<std::int32_t>::max(), pid) &&
        pid == static_cast<std::uint64_t>(expected.pid) &&
        integer(field(value, "uid"), std::numeric_limits<std::uint32_t>::max(), uid) && uid == expected.uid &&
        text(field(value, "startIdentity"), expected.start_identity) && text(field(value, "imagePath"), expected.image_path) &&
        text(field(value, "imageSHA256"), expected.image_sha256);
}

// Original9 validation uses the frozen r1 parser/predicates and CurrentData.
// It does not round counters through doubles, recalculate the store head, or
// turn observation metadata into issuer/Root authority.
inline bool current_data(const Value &value, const ResourceIdentity &expected, CurrentData &out) {
    using namespace json_impl;
    if (!fields(value, {"sourceId", "instanceId", "resourceKey", "epoch", "sequence", "head", "status", "issuedAtMs", "expiresAtMs"}) ||
        !text(field(value, "sourceId"), expected.source_id) || !text(field(value, "instanceId"), expected.instance_id) ||
        !text(field(value, "resourceKey"), expected.resource_key)) return false;
    const Value &epoch = field(value, "epoch"), &sequence = field(value, "sequence"), &head = field(value, "head");
    std::uint64_t counter, issued, expires;
    if (epoch.kind != Value::Kind::string || sequence.kind != Value::Kind::string ||
        !decimal(epoch.text, std::numeric_limits<std::uint64_t>::max(), counter, true) ||
        !decimal(sequence.text, std::numeric_limits<std::uint64_t>::max(), counter, true) ||
        head.kind != Value::Kind::string || !lower_sha256(head.text) || !text(field(value, "status"), "active") ||
        !integer(field(value, "issuedAtMs"), 9007199254740991ULL, issued) ||
        !integer(field(value, "expiresAtMs"), 9007199254740991ULL, expires) ||
        expires < issued || expires - issued != 20000) return false;
    out = {expected, epoch.text, sequence.text, head.text, "active", issued, expires};
    return true;
}

// Raw payload bounds are checked on the original, already strictly parsed JSON
// bytes. This scanner only locates value spans: it neither accepts syntax nor
// reserializes DATA. Decoded object-key order comes from the frozen r1 parser,
// so escaped field names remain valid and no substring search selects payload.
inline void whitespace(const std::string &raw, std::size_t &at) {
    while (at < raw.size() && (raw[at] == ' ' || raw[at] == '\n' || raw[at] == '\r' || raw[at] == '\t')) ++at;
}

inline bool string_end(const std::string &raw, std::size_t &at) {
    if (at >= raw.size() || raw[at++] != '"') return false;
    while (at < raw.size()) {
        const char c = raw[at++];
        if (c == '"') return true;
        if (c == '\\') {
            if (at >= raw.size()) return false;
            ++at;
        }
    }
    return false;
}

inline bool value_end(const std::string &raw, std::size_t &at) {
    whitespace(raw, at);
    if (at >= raw.size()) return false;
    if (raw[at] == '"') return string_end(raw, at);
    if (raw[at] == '{' || raw[at] == '[') {
        unsigned depth = 0;
        do {
            if (at >= raw.size()) return false;
            const char c = raw[at];
            if (c == '"') {
                if (!string_end(raw, at)) return false;
                continue;
            }
            ++at;
            if (c == '{' || c == '[') ++depth;
            if (c == '}' || c == ']') --depth;
        } while (depth != 0);
        return true;
    }
    const auto start = at;
    while (at < raw.size() && raw[at] != ',' && raw[at] != '}' && raw[at] != ']' &&
           raw[at] != ' ' && raw[at] != '\n' && raw[at] != '\r' && raw[at] != '\t') ++at;
    return at > start;
}

inline bool field_span(const std::string &raw, std::size_t object_at, std::size_t ordinal,
                       std::size_t &begin, std::size_t &end) {
    std::size_t at = object_at;
    whitespace(raw, at);
    if (at >= raw.size() || raw[at++] != '{') return false;
    for (std::size_t index = 0; index <= ordinal; ++index) {
        whitespace(raw, at);
        if (!string_end(raw, at)) return false;
        whitespace(raw, at);
        if (at >= raw.size() || raw[at++] != ':') return false;
        whitespace(raw, at);
        begin = at;
        if (!value_end(raw, at)) return false;
        end = at;
        if (index == ordinal) return true;
        whitespace(raw, at);
        if (at >= raw.size() || raw[at++] != ',') return false;
    }
    return false;
}

inline bool payload_bounded(const std::string &raw, const Value &root) {
    std::size_t result_ordinal = 0;
    while (result_ordinal < root.keys.size() && root.keys[result_ordinal] != "result") ++result_ordinal;
    if (result_ordinal == root.keys.size()) return false;
    std::size_t result_begin, result_end, payload_begin, payload_end;
    return field_span(raw, 0, result_ordinal, result_begin, result_end) &&
        field_span(raw, result_begin, 0, payload_begin, payload_end) && payload_end <= result_end &&
        payload_end - payload_begin <= 12288;
}

} // namespace held_json_impl

inline bool decode_held_response(const std::string &raw, const std::string &id,
                                 std::uint32_t client_uid, std::int32_t client_pid,
                                 const ResourceIdentity &expectedResource,
                                 const HeldProcessIdentity &expectedServer,
                                 const HeldProcessIdentity &expectedCaller,
                                 HeldAction action, HeldReply &out, std::string &failure) {
    using namespace json_impl;
    const auto deny = [&failure](const char *reason) { failure = reason; return false; };
    if (!request_id_valid(id) || client_pid <= 0 || expectedCaller.pid != client_pid ||
        !identity(expectedResource.source_id) || !identity(expectedResource.instance_id) || !identity(expectedResource.resource_key) ||
        !held_json_impl::process_shape(expectedServer, client_uid) || !held_json_impl::process_shape(expectedCaller, client_uid))
        return deny("resource_current held: invalid independent native binding");
    Value root;
    if (!Parser(raw).parse(root)) return deny("resource_current held: malformed or unbounded JSON");
    if (!fields(root, {"version", "id", "code", "peer", "result"}) ||
        !text(field(root, "version"), "YNX-NETWORK-LOCAL-IPC/v1") || !text(field(root, "id"), id) ||
        !text(field(root, "code"), "OK")) return deny("resource_current held: original response envelope required");
    const Value &peer = field(root, "peer");
    std::uint64_t uid, gid, pid;
    if (!fields(peer, {"uid", "gid", "pid", "credentialSource", "nativeIPCVerified", "browserIdentityVerified"}) ||
        !integer(field(peer, "uid"), std::numeric_limits<std::uint32_t>::max(), uid) || uid != client_uid ||
        !integer(field(peer, "gid"), std::numeric_limits<std::uint32_t>::max(), gid) ||
        !integer(field(peer, "pid"), std::numeric_limits<std::int32_t>::max(), pid) ||
        pid != static_cast<std::uint64_t>(client_pid) ||
        !(text(field(peer, "credentialSource"), "darwin-LOCAL_PEERCRED-Xucred") ||
          text(field(peer, "credentialSource"), "linux-SO_PEERCRED")) ||
        !flag(field(peer, "nativeIPCVerified"), true) || !flag(field(peer, "browserIdentityVerified"), false))
        return deny("resource_current held: client peer reflection mismatch");
    const Value &result = field(root, "result");
    if (!fields(result, {"payload"}) || !held_json_impl::payload_bounded(raw, root))
        return deny("resource_current held: bounded payload-only result required");
    const Value &payload = field(result, "payload");
    const bool data_only = text(field(payload, "code"), "DATA_ONLY");
    if (!(data_only ? fields(payload, {"code", "classification", "authority", "registeredIssuer", "productionEnabled", "resourceCurrent", "observation"}) :
                     fields(payload, {"code", "classification", "authority", "registeredIssuer", "productionEnabled", "observation"})) ||
        !text(field(payload, "classification"), "UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA") ||
        !flag(field(payload, "authority"), false) || !flag(field(payload, "registeredIssuer"), false) ||
        !flag(field(payload, "productionEnabled"), false))
        return deny("resource_current held: original unsigned payload fields required");
    const Value &code = field(payload, "code"), &observation = field(payload, "observation");
    if (code.kind != Value::Kind::string || !fields(observation, {"sessionId", "server", "caller", "lifetime"}))
        return deny("resource_current held: exact observation required");
    const Value &session = field(observation, "sessionId"), &lifetime = field(observation, "lifetime");
    if (session.kind != Value::Kind::string || !request_id_valid(session.text) ||
        !held_json_impl::process(field(observation, "server"), expectedServer) ||
        !held_json_impl::process(field(observation, "caller"), expectedCaller) ||
        !fields(lifetime, {"partialAcquired", "retired", "joined", "physicalComplete"}))
        return deny("resource_current held: original process/session observation mismatch");
    for (const auto &value : lifetime.values) if (value.kind != Value::Kind::boolean)
        return deny("resource_current held: exact boolean lifetime required");
    const bool partial = field(lifetime, "partialAcquired").boolean;
    const bool retired = field(lifetime, "retired").boolean;
    const bool joined = field(lifetime, "joined").boolean;
    const bool physical = field(lifetime, "physicalComplete").boolean;
    if ((joined && !retired) || (physical && (!joined || !retired)))
        return deny("resource_current held: inconsistent lifecycle observation");
    bool action_matches = false;
    switch (action) {
    case HeldAction::current:
        action_matches = (code.text == "DATA_ONLY" && partial && !retired && !joined && !physical) || code.text == "UNAVAILABLE";
        break;
    case HeldAction::retire:
        action_matches = code.text == "RETIRED" && retired;
        break;
    case HeldAction::join:
        action_matches = (code.text == "DRAINED" && retired && joined) || (code.text == "PENDING" && !joined && !physical);
        break;
    case HeldAction::close:
        action_matches = (code.text == "CLOSED" && retired && joined && physical) || (code.text == "PENDING" && !physical);
        break;
    default:
        break;
    }
    if (!action_matches) return deny("resource_current held: action/code/lifetime mismatch");
    HeldReply decoded;
    decoded.code = code.text;
    decoded.has_data = data_only;
    if (data_only && !held_json_impl::current_data(field(payload, "resourceCurrent"), expectedResource, decoded.data))
        return deny("resource_current held: original nine-field current DATA required");
    decoded.observation = {session.text, expectedServer, expectedCaller, partial, retired, joined, physical};
    out = std::move(decoded);
    failure.clear();
    return true;
}

} // namespace ynx::resource_current_detail

#endif
