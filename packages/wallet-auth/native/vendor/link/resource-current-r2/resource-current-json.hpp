#ifndef YNX_RESOURCE_CURRENT_JSON_HPP
#define YNX_RESOURCE_CURRENT_JSON_HPP

#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <limits>
#include <string>
#include <utility>
#include <vector>

// Transport decoding of P09's original resource_current JSON only. These
// public fields supply no registered issuer, signature, Source or permission.
// The native caller retains raw bytes and independently checks live time and
// kernel endpoint credentials; this decoder never acquires those authorities.
namespace ynx::resource_current_detail {

struct ResourceIdentity {
    std::string source_id, instance_id, resource_key;
};

struct CurrentData {
    ResourceIdentity resource;
    std::string epoch, sequence, head, status;
    std::uint64_t issued_at_ms = 0, expires_at_ms = 0;
};

namespace json_impl {

inline bool utf8(const std::string &text) {
    for (std::size_t i = 0; i < text.size();) {
        const auto first = static_cast<unsigned char>(text[i++]);
        if (first < 0x80) continue;
        unsigned following = 0;
        unsigned char low = 0x80, high = 0xbf;
        if (first >= 0xc2 && first <= 0xdf) following = 1;
        else if (first >= 0xe0 && first <= 0xef) {
            following = 2;
            if (first == 0xe0) low = 0xa0;
            if (first == 0xed) high = 0x9f;
        } else if (first >= 0xf0 && first <= 0xf4) {
            following = 3;
            if (first == 0xf0) low = 0x90;
            if (first == 0xf4) high = 0x8f;
        } else return false;
        if (following > text.size() - i) return false;
        const auto second = static_cast<unsigned char>(text[i++]);
        if (second < low || second > high) return false;
        for (unsigned n = 1; n < following; ++n) {
            const auto next = static_cast<unsigned char>(text[i++]);
            if (next < 0x80 || next > 0xbf) return false;
        }
    }
    return true;
}

struct Value {
    enum class Kind { null_value, boolean, number, string, array, object } kind = Kind::null_value;
    bool boolean = false;
    std::string text;
    std::vector<std::string> keys;
    std::vector<Value> values;
};

class Parser {
public:
    explicit Parser(const std::string &input) : input_(input) {}

    bool parse(Value &out) {
        if (input_.empty() || input_.size() > 16384 || !utf8(input_)) return false;
        if (!value(out, 0)) return false;
        whitespace();
        return position_ == input_.size();
    }

private:
    const std::string &input_;
    std::size_t position_ = 0;

    void whitespace() {
        while (position_ < input_.size()) {
            const char c = input_[position_];
            if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
            ++position_;
        }
    }

    bool consume(char c) {
        if (position_ >= input_.size() || input_[position_] != c) return false;
        ++position_;
        return true;
    }

    bool literal(const char *text) {
        const std::size_t start = position_;
        for (std::size_t i = 0; text[i]; ++i) {
            if (position_ >= input_.size() || input_[position_++] != text[i]) {
                position_ = start;
                return false;
            }
        }
        return true;
    }

    static bool digit(char c) { return c >= '0' && c <= '9'; }

    bool hex4(std::uint32_t &out) {
        if (input_.size() - position_ < 4) return false;
        out = 0;
        for (unsigned i = 0; i < 4; ++i) {
            const char c = input_[position_++];
            unsigned n;
            if (c >= '0' && c <= '9') n = static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') n = static_cast<unsigned>(c - 'a') + 10;
            else if (c >= 'A' && c <= 'F') n = static_cast<unsigned>(c - 'A') + 10;
            else return false;
            out = (out << 4) | n;
        }
        return true;
    }

    static void append_scalar(std::string &out, std::uint32_t scalar) {
        if (scalar <= 0x7f) out.push_back(static_cast<char>(scalar));
        else if (scalar <= 0x7ff) {
            out.push_back(static_cast<char>(0xc0 | (scalar >> 6)));
            out.push_back(static_cast<char>(0x80 | (scalar & 0x3f)));
        } else if (scalar <= 0xffff) {
            out.push_back(static_cast<char>(0xe0 | (scalar >> 12)));
            out.push_back(static_cast<char>(0x80 | ((scalar >> 6) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | (scalar & 0x3f)));
        } else {
            out.push_back(static_cast<char>(0xf0 | (scalar >> 18)));
            out.push_back(static_cast<char>(0x80 | ((scalar >> 12) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | ((scalar >> 6) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | (scalar & 0x3f)));
        }
    }

    bool string(std::string &out) {
        if (!consume('"')) return false;
        out.clear();
        while (position_ < input_.size()) {
            const auto c = static_cast<unsigned char>(input_[position_++]);
            if (c == '"') return true;
            if (c < 0x20) return false;
            if (c != '\\') {
                out.push_back(static_cast<char>(c));
                continue;
            }
            if (position_ >= input_.size()) return false;
            switch (input_[position_++]) {
            case '"': out.push_back('"'); break;
            case '\\': out.push_back('\\'); break;
            case '/': out.push_back('/'); break;
            case 'b': out.push_back('\b'); break;
            case 'f': out.push_back('\f'); break;
            case 'n': out.push_back('\n'); break;
            case 'r': out.push_back('\r'); break;
            case 't': out.push_back('\t'); break;
            case 'u': {
                std::uint32_t scalar;
                if (!hex4(scalar)) return false;
                if (scalar >= 0xd800 && scalar <= 0xdbff) {
                    if (!consume('\\') || !consume('u')) return false;
                    std::uint32_t low;
                    if (!hex4(low) || low < 0xdc00 || low > 0xdfff) return false;
                    scalar = 0x10000 + ((scalar - 0xd800) << 10) + (low - 0xdc00);
                } else if (scalar >= 0xdc00 && scalar <= 0xdfff) return false;
                append_scalar(out, scalar);
                break;
            }
            default: return false;
            }
        }
        return false;
    }

    bool number(std::string &out) {
        const std::size_t start = position_;
        consume('-');
        if (position_ >= input_.size()) return false;
        if (!consume('0')) {
            if (input_[position_] < '1' || input_[position_] > '9') return false;
            while (position_ < input_.size() && digit(input_[position_])) ++position_;
        }
        if (consume('.')) {
            if (position_ >= input_.size() || !digit(input_[position_])) return false;
            while (position_ < input_.size() && digit(input_[position_])) ++position_;
        }
        if (position_ < input_.size() && (input_[position_] == 'e' || input_[position_] == 'E')) {
            ++position_;
            if (position_ < input_.size() && (input_[position_] == '+' || input_[position_] == '-')) ++position_;
            if (position_ >= input_.size() || !digit(input_[position_])) return false;
            while (position_ < input_.size() && digit(input_[position_])) ++position_;
        }
        out = input_.substr(start, position_ - start);
        return true;
    }

    bool value(Value &out, unsigned depth) {
        if (depth > 10) return false;
        whitespace();
        if (position_ >= input_.size()) return false;
        const char c = input_[position_];
        if (c == '"') {
            out.kind = Value::Kind::string;
            return string(out.text);
        }
        if (c == '{' || c == '[') {
            const bool object = c == '{';
            out.kind = object ? Value::Kind::object : Value::Kind::array;
            ++position_;
            whitespace();
            if (consume(object ? '}' : ']')) return true;
            for (;;) {
                if (out.values.size() >= (object ? 64U : 32U)) return false;
                if (object) {
                    std::string key;
                    if (!string(key)) return false;
                    for (const auto &seen : out.keys) if (seen == key) return false;
                    out.keys.push_back(std::move(key));
                    whitespace();
                    if (!consume(':')) return false;
                }
                Value child;
                if (!value(child, depth + 1)) return false;
                out.values.push_back(std::move(child));
                whitespace();
                if (consume(object ? '}' : ']')) return true;
                if (!consume(',')) return false;
                whitespace();
            }
        }
        if (c == 't' || c == 'f') {
            out.kind = Value::Kind::boolean;
            out.boolean = c == 't';
            return literal(c == 't' ? "true" : "false");
        }
        if (c == 'n') {
            out.kind = Value::Kind::null_value;
            return literal("null");
        }
        if (c == '-' || digit(c)) {
            out.kind = Value::Kind::number;
            return number(out.text);
        }
        return false;
    }
};

inline bool fields(const Value &value, std::initializer_list<const char *> expected) {
    if (value.kind != Value::Kind::object || value.keys.size() != expected.size()) return false;
    for (const auto &key : value.keys) {
        bool found = false;
        for (const char *name : expected) if (key == name) found = true;
        if (!found) return false;
    }
    return true;
}

inline const Value &field(const Value &value, const char *name) {
    for (std::size_t i = 0; i < value.keys.size(); ++i) if (value.keys[i] == name) return value.values[i];
    // Every caller first requires an exact field set. A default null cannot
    // satisfy any of the subsequent typed predicates if that contract changes.
    static const Value missing;
    return missing;
}

inline bool text(const Value &value, const std::string &expected) {
    return value.kind == Value::Kind::string && value.text == expected;
}

inline bool flag(const Value &value, bool expected) {
    return value.kind == Value::Kind::boolean && value.boolean == expected;
}

inline bool decimal(const std::string &text, std::uint64_t maximum, std::uint64_t &out, bool positive) {
    if (text.empty() || text.size() > 20 || (text.size() > 1 && text[0] == '0')) return false;
    std::uint64_t value = 0;
    for (char c : text) {
        if (c < '0' || c > '9') return false;
        const auto digit = static_cast<std::uint64_t>(c - '0');
        if (value > maximum / 10 || (value == maximum / 10 && digit > maximum % 10)) return false;
        value = value * 10 + digit;
    }
    if (positive && value == 0) return false;
    out = value;
    return true;
}

inline bool integer(const Value &value, std::uint64_t maximum, std::uint64_t &out) {
    return value.kind == Value::Kind::number && decimal(value.text, maximum, out, false);
}

inline bool identity(const std::string &value) {
    if (value.empty() || value.size() > 256 || !utf8(value)) return false;
    for (unsigned char c : value) if (c < 0x20 || c == 0x7f) return false;
    return true;
}

inline bool request_id_valid(const std::string &value) {
    if (value.empty() || value.size() > 80) return false;
    for (char c : value) if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                              (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
    return true;
}

} // namespace json_impl

inline bool decode_response(const std::string &raw, const std::string &request_id,
                            std::uint32_t client_uid, std::int32_t client_pid,
                            const ResourceIdentity &expected, CurrentData &out,
                            std::string &failure) {
    using namespace json_impl;
    const auto deny = [&failure](const char *reason) { failure = reason; return false; };
    if (!request_id_valid(request_id) || client_pid <= 0 || !identity(expected.source_id) ||
        !identity(expected.instance_id) || !identity(expected.resource_key))
        return deny("resource_current: invalid original caller binding");
    Value root;
    if (!Parser(raw).parse(root)) return deny("resource_current: malformed or unbounded JSON");
    if (!fields(root, {"version", "id", "code", "peer", "result"}) ||
        !text(field(root, "version"), "YNX-NETWORK-LOCAL-IPC/v1") ||
        !text(field(root, "id"), request_id) || !text(field(root, "code"), "OK"))
        return deny("resource_current: original response envelope required");
    const Value &peer = field(root, "peer");
    if (!fields(peer, {"uid", "gid", "pid", "credentialSource", "nativeIPCVerified", "browserIdentityVerified"}))
        return deny("resource_current: exact peer metadata required");
    std::uint64_t uid, gid, pid;
    const Value &source = field(peer, "credentialSource");
    if (!integer(field(peer, "uid"), std::numeric_limits<std::uint32_t>::max(), uid) || uid != client_uid ||
        !integer(field(peer, "gid"), std::numeric_limits<std::uint32_t>::max(), gid) ||
        !integer(field(peer, "pid"), std::numeric_limits<std::int32_t>::max(), pid) ||
        pid != static_cast<std::uint64_t>(client_pid) ||
        !(text(source, "darwin-LOCAL_PEERCRED-Xucred") || text(source, "linux-SO_PEERCRED")) ||
        !flag(field(peer, "nativeIPCVerified"), true) || !flag(field(peer, "browserIdentityVerified"), false))
        return deny("resource_current: caller peer reflection mismatch");
    const Value &result = field(root, "result");
    if (!fields(result, {"payload"})) return deny("resource_current: payload-only result required");
    const Value &payload = field(result, "payload");
    if (!fields(payload, {"code", "classification", "authority", "registeredIssuer", "productionEnabled", "resourceCurrent"}) ||
        !text(field(payload, "code"), "DATA_ONLY") ||
        !text(field(payload, "classification"), "UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA") ||
        !flag(field(payload, "authority"), false) || !flag(field(payload, "registeredIssuer"), false) ||
        !flag(field(payload, "productionEnabled"), false))
        return deny("resource_current: unsigned DATA_ONLY payload required");
    const Value &current = field(payload, "resourceCurrent");
    if (!fields(current, {"sourceId", "instanceId", "resourceKey", "epoch", "sequence", "head", "status", "issuedAtMs", "expiresAtMs"}))
        return deny("resource_current: exact nine-field current DATA required");
    if (!text(field(current, "sourceId"), expected.source_id) || !text(field(current, "instanceId"), expected.instance_id) ||
        !text(field(current, "resourceKey"), expected.resource_key))
        return deny("resource_current: original resource identity mismatch");
    const Value &epoch = field(current, "epoch"), &sequence = field(current, "sequence"), &head = field(current, "head");
    std::uint64_t counter;
    if (epoch.kind != Value::Kind::string || sequence.kind != Value::Kind::string ||
        !decimal(epoch.text, std::numeric_limits<std::uint64_t>::max(), counter, true) ||
        !decimal(sequence.text, std::numeric_limits<std::uint64_t>::max(), counter, true) ||
        head.kind != Value::Kind::string || head.text.size() != 64 || !text(field(current, "status"), "active"))
        return deny("resource_current: exact current counters/head/status required");
    for (char c : head.text) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
        return deny("resource_current: lowercase SHA256 head required");
    constexpr std::uint64_t safe_integer = 9007199254740991ULL;
    std::uint64_t issued, expires;
    if (!integer(field(current, "issuedAtMs"), safe_integer, issued) ||
        !integer(field(current, "expiresAtMs"), safe_integer, expires) || expires < issued || expires - issued != 20000)
        return deny("resource_current: exact twenty-second integer interval required");
    CurrentData decoded;
    decoded.resource = expected;
    decoded.epoch = epoch.text;
    decoded.sequence = sequence.text;
    decoded.head = head.text;
    decoded.status = "active";
    decoded.issued_at_ms = issued;
    decoded.expires_at_ms = expires;
    out = std::move(decoded);
    failure.clear();
    return true;
}

} // namespace ynx::resource_current_detail

#endif
