// Pure PUBLIC JSON carrier controls. No socket, Go, signature, account, issuer,
// Source, resource initialization or counter mutation is constructed here.
#include "resource-current-json.hpp"
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace rc = ynx::resource_current_detail;

namespace {
unsigned controls = 0;

void require(bool condition, const std::string &message) {
    if (!condition) throw std::runtime_error(message);
}

std::string replace(std::string input, const std::string &from, const std::string &to) {
    const auto at = input.find(from);
    require(at != std::string::npos, "test mutation target absent: " + from);
    input.replace(at, from.size(), to);
    return input;
}

std::string quote(const std::string &text) {
    const char *hex = "0123456789abcdef";
    std::string out = "\"";
    for (unsigned char c : text) {
        if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
        else if (c < 0x20) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
        else out += static_cast<char>(c);
    }
    return out + '"';
}

const rc::ResourceIdentity registered{"PUBLIC/source", "PUBLIC/instance", "PUBLIC/resource"};
const std::string request_id = "PUBLIC-resource_current_1";

std::string fixture(const rc::ResourceIdentity &identity = registered) {
    return "{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":" + quote(request_id) +
        ",\"code\":\"OK\",\"peer\":{\"uid\":501,\"gid\":20,\"pid\":1234,"
        "\"credentialSource\":\"darwin-LOCAL_PEERCRED-Xucred\",\"nativeIPCVerified\":true,"
        "\"browserIdentityVerified\":false},\"result\":{\"payload\":{\"code\":\"DATA_ONLY\","
        "\"classification\":\"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA\",\"authority\":false,"
        "\"registeredIssuer\":false,\"productionEnabled\":false,\"resourceCurrent\":{"
        "\"sourceId\":" + quote(identity.source_id) + ",\"instanceId\":" + quote(identity.instance_id) +
        ",\"resourceKey\":" + quote(identity.resource_key) +
        ",\"epoch\":\"1\",\"sequence\":\"9007199254740993\",\"head\":\"" + std::string(64, 'a') +
        "\",\"status\":\"active\",\"issuedAtMs\":1700000000000,\"expiresAtMs\":1700000020000}}}}";
}

rc::CurrentData sentinel() {
    return {{"unchanged/source", "unchanged/instance", "unchanged/resource"},
            "unchanged/epoch", "unchanged/sequence", "unchanged/head", "unchanged/status", 7, 11};
}

bool same(const rc::CurrentData &a, const rc::CurrentData &b) {
    return a.resource.source_id == b.resource.source_id && a.resource.instance_id == b.resource.instance_id &&
        a.resource.resource_key == b.resource.resource_key && a.epoch == b.epoch && a.sequence == b.sequence &&
        a.head == b.head && a.status == b.status && a.issued_at_ms == b.issued_at_ms && a.expires_at_ms == b.expires_at_ms;
}

rc::CurrentData accept(const std::string &raw, const std::string &label,
                       const rc::ResourceIdentity &expected = registered,
                       std::uint32_t uid = 501, std::int32_t pid = 1234) {
    rc::CurrentData out = sentinel();
    std::string failure = "old failure";
    require(rc::decode_response(raw, request_id, uid, pid, expected, out, failure), "accept: " + label + ": " + failure);
    require(failure.empty(), "successful decode retained old failure: " + label);
    require(out.resource.source_id == expected.source_id && out.resource.instance_id == expected.instance_id &&
            out.resource.resource_key == expected.resource_key && out.status == "active", "identity/status: " + label);
    ++controls;
    return out;
}

void reject(const std::string &raw, const std::string &label,
            const rc::ResourceIdentity &expected = registered,
            const std::string &id = request_id, std::uint32_t uid = 501, std::int32_t pid = 1234) {
    const rc::CurrentData before = sentinel();
    rc::CurrentData out = before;
    std::string failure;
    require(!rc::decode_response(raw, id, uid, pid, expected, out, failure), "accepted invalid response: " + label);
    require(!failure.empty(), "missing failure: " + label);
    require(same(out, before), "failed decode partially committed DATA: " + label);
    ++controls;
}

void parser_bound(const std::string &raw, bool expected, const std::string &label) {
    rc::json_impl::Value value;
    require(rc::json_impl::Parser(raw).parse(value) == expected, "JSON bound: " + label);
    ++controls;
}

void positive_controls() {
    const auto out = accept(fixture(), "original Darwin response");
    require(out.epoch == "1" && out.sequence == "9007199254740993" && out.head == std::string(64, 'a') &&
            out.issued_at_ms == 1700000000000ULL && out.expires_at_ms == 1700000020000ULL,
            "full original DATA was not preserved");
    accept(replace(fixture(), "darwin-LOCAL_PEERCRED-Xucred", "linux-SO_PEERCRED"), "original Linux source");
    accept(" \n\t" + fixture() + "\r\n", "legal JSON whitespace");
    accept(replace(fixture(), "\"uid\":501,\"gid\":20", "\"gid\":20,\"uid\":501"), "object field order");
    accept(replace(fixture(), "\"sourceId\"", "\"source\\u0049d\""), "escaped exact field name");
    accept(replace(fixture(), "PUBLIC/source", "PUBLIC\\/source"), "escaped identity slash");
    const rc::ResourceIdentity unicode{u8"PUBLIC/资源😀", u8"PUBLIC/实例", u8"PUBLIC/贡献"};
    accept(fixture(unicode), "original UTF8 identity", unicode);
    accept(replace(fixture(unicode), quote(unicode.source_id),
                   "\"PUBLIC/\\u8d44\\u6e90\\ud83d\\ude00\""), "surrogate pair identity", unicode);
    const rc::ResourceIdentity scalar{"PUBLIC/\xf0\x90\x80\x80", "PUBLIC/instance", "PUBLIC/resource"};
    accept(replace(fixture(scalar), quote(scalar.source_id), "\"PUBLIC/\\uD800\\uDC00\""), "minimum surrogate scalar", scalar);
    const rc::ResourceIdentity escaped{"PUBLIC/quote\"slash\\", "PUBLIC/instance", "PUBLIC/resource"};
    accept(fixture(escaped), "quote and backslash identity", escaped);
    auto maximum = replace(fixture(), "\"epoch\":\"1\"", "\"epoch\":\"18446744073709551615\"");
    maximum = replace(maximum, "\"sequence\":\"9007199254740993\"", "\"sequence\":\"18446744073709551615\"");
    const auto full = accept(maximum, "full uint64 counters");
    require(full.epoch == "18446744073709551615" && full.sequence == full.epoch, "counter precision changed");
    auto zero = replace(fixture(), "1700000000000", "0");
    zero = replace(zero, "1700000020000", "20000");
    require(accept(zero, "zero issue with exact TTL").issued_at_ms == 0, "zero time changed");
    auto safe = replace(fixture(), "1700000000000", "9007199254720991");
    safe = replace(safe, "1700000020000", "9007199254740991");
    require(accept(safe, "maximum safe timestamp").expires_at_ms == 9007199254740991ULL, "safe time changed");
    auto ids = replace(fixture(), "\"uid\":501", "\"uid\":4294967295");
    ids = replace(ids, "\"gid\":20", "\"gid\":4294967295");
    ids = replace(ids, "\"pid\":1234", "\"pid\":2147483647");
    accept(ids, "exact maximum kernel identity integers", registered, 4294967295U, 2147483647);
    const rc::ResourceIdentity limit{std::string(256, 's'), std::string(256, 'i'), std::string(256, 'r')};
    accept(fixture(limit), "256-byte original identity", limit);
    const auto raw = fixture();
    accept(raw + std::string(16384 - raw.size(), ' '), "exact 16384-byte message");
}

void envelope_and_authority_controls() {
    for (const auto &mutation : std::vector<std::pair<std::string, std::string>>{
        {"YNX-NETWORK-LOCAL-IPC/v1", "YNX-NETWORK-LOCAL-IPC/v2"},
        {quote(request_id), "\"other-request\""}, {"\"code\":\"OK\"", "\"code\":\"ERROR\""},
        {"\"version\":", "\"Version\":"}, {"\"id\":", "\"ID\":"},
        {"\"peer\":", "\"Peer\":"}, {"\"result\":", "\"Result\":"},
        {"\"code\":\"DATA_ONLY\"", "\"code\":\"NOT_SUPPLIED\""},
        {"\"code\":\"DATA_ONLY\"", "\"code\":\"UNAVAILABLE\""},
        {"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA", "SIGNED_RESOURCE_CURRENT"},
        {"\"authority\":false", "\"authority\":true"},
        {"\"registeredIssuer\":false", "\"registeredIssuer\":true"},
        {"\"productionEnabled\":false", "\"productionEnabled\":true"},
        {"\"authority\":false", "\"authority\":\"false\""},
        {"\"resourceCurrent\":", "\"ResourceCurrent\":"},
        {"\"result\":{\"payload\":", "\"result\":{\"status\":null,\"payload\":"},
        {"\"result\":{\"payload\":", "\"result\":{\"permission\":null,\"payload\":"},
        {"{\"version\":", "{\"unknown\":false,\"version\":"},
        {"\"code\":\"DATA_ONLY\",", "\"code\":\"DATA_ONLY\",\"rootAdmission\":false,"},
        {"\"epoch\":\"1\",", "\"epoch\":\"1\",\"extra\":0,"},
        {"\"sourceId\":", "\"SourceId\":"},
        {"\"issuedAtMs\":1700000000000,", ""},
        {"\"payload\":", "\"Payload\":"},
        {"\"sourceId\":", "\"sourceId\":\"duplicate\",\"sourceId\":"},
        {"\"sourceId\":", "\"source\\u0049d\":\"duplicate\",\"sourceId\":"},
        {"\"uid\":501,", "\"uid\":501,\"uid\":501,"},
        {"\"epoch\":\"1\",", "\"epoch\":\"1\",\"epoch\":\"1\","}
    }) reject(replace(fixture(), mutation.first, mutation.second), mutation.first + " -> " + mutation.second);
    reject("{}", "empty envelope");
    reject("null", "null envelope");
    reject("[]", "array envelope");
    reject("{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":" + quote(request_id) +
           ",\"code\":\"OK\",\"peer\":{},\"result\":null}", "missing original result");
    reject(fixture(), "wrong expected source", {"other", registered.instance_id, registered.resource_key});
    reject(fixture(), "wrong expected instance", {registered.source_id, "other", registered.resource_key});
    reject(fixture(), "wrong expected resource", {registered.source_id, registered.instance_id, "other"});
    reject(fixture(), "invalid requested ID", registered, "bad.id");
    reject(fixture(), "empty requested ID", registered, "");
    reject(fixture(), "too long requested ID", registered, std::string(81, 'a'));
}

void peer_controls() {
    for (const auto &mutation : std::vector<std::pair<std::string, std::string>>{
        {"\"uid\":501", "\"uid\":502"}, {"\"pid\":1234", "\"pid\":1235"},
        {"\"uid\":501", "\"uid\":\"501\""}, {"\"uid\":501", "\"uid\":501.0"},
        {"\"uid\":501", "\"uid\":5.01e2"}, {"\"uid\":501", "\"uid\":-1"},
        {"\"uid\":501", "\"uid\":4294967296"}, {"\"gid\":20", "\"gid\":4294967296"},
        {"\"gid\":20", "\"gid\":-0"}, {"\"pid\":1234", "\"pid\":2147483648"},
        {"\"pid\":1234", "\"pid\":0"}, {"\"pid\":1234", "\"pid\":-1234"},
        {"\"pid\":1234", "\"pid\":null"}, {"\"pid\":1234,", ""},
        {"darwin-LOCAL_PEERCRED-Xucred", "darwin"}, {"darwin-LOCAL_PEERCRED-Xucred", "linux"},
        {"darwin-LOCAL_PEERCRED-Xucred", "linux-so_peercred"},
        {"\"nativeIPCVerified\":true", "\"nativeIPCVerified\":false"},
        {"\"browserIdentityVerified\":false", "\"browserIdentityVerified\":true"},
        {"\"nativeIPCVerified\":true", "\"nativeIPCVerified\":1"},
        {"\"browserIdentityVerified\":false", "\"browserIdentityVerified\":null"}
    }) reject(replace(fixture(), mutation.first, mutation.second), "peer " + mutation.second);
    reject(fixture(), "reflected server UID is not the client UID", registered, request_id, 502, 1234);
    reject(fixture(), "reflected server PID is not the client PID", registered, request_id, 501, 1235);
    reject(fixture(), "invalid client PID", registered, request_id, 501, 0);
}

void data_controls() {
    for (const std::string &value : {"", "0", "00", "01", "+1", "-1", "1.0", "1e2", " 1", "1 ",
                                    "18446744073709551616", "999999999999999999999"}) {
        reject(replace(fixture(), "\"epoch\":\"1\"", "\"epoch\":" + quote(value)), "epoch " + value);
        reject(replace(fixture(), "\"sequence\":\"9007199254740993\"", "\"sequence\":" + quote(value)), "sequence " + value);
    }
    reject(replace(fixture(), "\"epoch\":\"1\"", "\"epoch\":1"), "counter is not JSON number");
    reject(replace(fixture(), std::string(64, 'a'), std::string(64, 'A')), "uppercase head");
    reject(replace(fixture(), std::string(64, 'a'), std::string(63, 'a')), "short head");
    reject(replace(fixture(), std::string(64, 'a'), std::string(64, 'g')), "nonhex head");
    reject(replace(fixture(), "\"active\"", "\"ACTIVE\""), "status case");
    reject(replace(fixture(), "\"active\"", "\"stopped\""), "inactive status");
    for (const std::string &number : {"-1", "-0", "1700000000000.0", "1.7e12", "9007199254740992", "18446744073709551615"})
        reject(replace(fixture(), "1700000000000", number), "integer timestamp " + number);
    reject(replace(fixture(), "1700000020000", "1700000019999"), "TTL one ms short");
    reject(replace(fixture(), "1700000020000", "1700000020001"), "TTL one ms long");
    reject(replace(fixture(), "1700000020000", "1699999999999"), "expiry before issue");
    reject(replace(fixture(), "1700000020000", "9007199254740992"), "unsafe expiry");
    reject(replace(fixture(), "1700000000000", "\"1700000000000\""), "string timestamp");
    for (const auto &bad : std::vector<rc::ResourceIdentity>{{"", "PUBLIC/instance", "PUBLIC/resource"},
        {std::string(257, 's'), "PUBLIC/instance", "PUBLIC/resource"},
        {"PUBLIC/\nsource", "PUBLIC/instance", "PUBLIC/resource"},
        {"PUBLIC/\x7fsource", "PUBLIC/instance", "PUBLIC/resource"},
        {std::string("PUBLIC/\0source", 14), "PUBLIC/instance", "PUBLIC/resource"}})
        reject(fixture(bad), "invalid registered identity", bad);
}

void lexical_and_bound_controls() {
    for (const std::string &suffix : {"{}", " false", "x", ",", "\n0"}) reject(fixture() + suffix, "trailing JSON");
    reject("\xef\xbb\xbf" + fixture(), "UTF8 BOM outside JSON");
    reject(replace(fixture(), "\"epoch\":\"1\"", "\"epoch\":01"), "leading-zero JSON number");
    reject(replace(fixture(), "\"epoch\":\"1\"", "\"epoch\":1."), "incomplete fraction");
    reject(replace(fixture(), "\"epoch\":\"1\"", "\"epoch\":1e+"), "incomplete exponent");
    reject(replace(fixture(), "\"epoch\":\"1\"", "\"epoch\":NaN"), "non-JSON number");
    reject(replace(fixture(), "\"version\":", "/*comment*/\"version\":"), "JSON comment");
    reject(replace(fixture(), "\"sourceId\":", "sourceId:"), "unquoted field name");
    reject(replace(fixture(), "\"epoch\":\"1\",", "\"epoch\":\"1\",,"), "double comma");
    reject(replace(fixture(), "\"expiresAtMs\":1700000020000", "\"expiresAtMs\":1700000020000,"), "trailing comma");
    reject(replace(fixture(), "PUBLIC/source", "PUBLIC\nsource"), "raw control in string");
    for (const std::string &escape : {"\\q", "\\uD800", "\\uDC00", "\\uD800x", "\\uD800\\u0041", "\\uD800\\uD800", "\\uZZZZ", "\\u123"})
        reject(replace(fixture(), "PUBLIC/source", "PUBLIC/" + escape), "bad Unicode escape " + escape);
    for (const auto &bad : std::vector<std::string>{"\x80", "\xc0\xaf", "\xe0\x80\xaf", "\xed\xa0\x80",
        "\xf0\x80\x80\xaf", "\xf4\x90\x80\x80", "\xf5\x80\x80\x80", "\xe2\x82"})
        reject(replace(fixture(), "PUBLIC/source", "PUBLIC/" + bad), "invalid UTF8");
    reject(fixture() + std::string(16385 - fixture().size(), ' '), "message larger than 16384");
    reject("", "empty input");
    reject(fixture().substr(0, fixture().size() - 1), "truncated envelope");
    std::string array = "[";
    for (unsigned i = 0; i < 32; ++i) array += (i ? ",0" : "0");
    parser_bound(array + "]", true, "32 array elements");
    parser_bound(array + ",0]", false, "33 array elements");
    std::string object = "{";
    for (unsigned i = 0; i < 64; ++i) object += (i ? "," : "") + quote(std::to_string(i)) + ":0";
    parser_bound(object + "}", true, "64 object fields");
    parser_bound(object + ",\"extra\":0}", false, "65 object fields");
    parser_bound("{\"x\":0,\"\\u0078\":1}", false, "duplicate decoded names");
    std::string nested = "0";
    for (unsigned i = 0; i < 10; ++i) nested = "[" + nested + "]";
    parser_bound(nested, true, "depth ten");
    parser_bound("[" + nested + "]", false, "depth eleven");
    // Bound failures also reach the public decoder without touching out.
    reject("{\"version\":" + nested + "}", "deep wrong envelope");
    reject("{\"version\":" + array + ",0]}", "oversized array in envelope");
    reject(object + ",\"extra\":0}", "oversized object envelope");
}

} // namespace

int main() {
    try {
        positive_controls();
        envelope_and_authority_controls();
        peer_controls();
        data_controls();
        lexical_and_bound_controls();
        std::cout << "{\"status\":\"PASS\",\"publicCodecControls\":" << controls
                  << ",\"networkOrCryptoExecuted\":false,\"sourceAdmission\":false}\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "resource-current-json PUBLIC control failed: " << error.what() << '\n';
        return 1;
    }
}
