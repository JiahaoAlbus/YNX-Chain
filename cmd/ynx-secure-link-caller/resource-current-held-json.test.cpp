// New r2 PUBLIC held-carrier controls only; the frozen r1 suite is not invoked.
// No socket, OS identity acquisition, Go, signer, Source or Root is exercised.
#include "resource-current-held-json.hpp"
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace rc = ynx::resource_current_detail;

namespace {
unsigned controls = 0;
const std::string request_id = "PUBLIC-held-frame_1";
const std::string session_id = "PUBLIC-original-session_1";
const rc::ResourceIdentity resource{"PUBLIC/source", "PUBLIC/instance", "PUBLIC/resource"};
const rc::HeldProcessIdentity server{4321, 501, "darwin:1700000000:17", "/PUBLIC/original-network-helper", std::string(64, 'a')};
const rc::HeldProcessIdentity caller{1234, 501, "darwin:1700000010:21", "/PUBLIC/original-native-client", std::string(64, 'b')};

void require(bool value, const std::string &message) {
    if (!value) throw std::runtime_error(message);
}

std::string quote(const std::string &value) {
    static const char hex[] = "0123456789abcdef";
    std::string out = "\"";
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
        else if (c < 0x20) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
        else out += static_cast<char>(c);
    }
    return out + '"';
}

std::string replace(std::string input, const std::string &before, const std::string &after) {
    const auto at = input.find(before);
    require(at != std::string::npos, "absent mutation target: " + before);
    input.replace(at, before.size(), after);
    return input;
}

std::string process_json(const rc::HeldProcessIdentity &process) {
    return "{\"pid\":" + std::to_string(process.pid) + ",\"uid\":" + std::to_string(process.uid) +
        ",\"startIdentity\":" + quote(process.start_identity) + ",\"imagePath\":" + quote(process.image_path) +
        ",\"imageSHA256\":" + quote(process.image_sha256) + "}";
}

struct Life { bool partial, retired, joined, physical; };
const Life acquired{true, false, false, false};
const Life retired{true, true, false, false};
const Life joined{true, true, true, false};
const Life closed{true, true, true, true};
const char *boolean(bool value) { return value ? "true" : "false"; }

std::string life_json(const Life &life) {
    return std::string("{\"partialAcquired\":") + boolean(life.partial) + ",\"retired\":" + boolean(life.retired) +
        ",\"joined\":" + boolean(life.joined) + ",\"physicalComplete\":" + boolean(life.physical) + "}";
}

std::string current_json() {
    return "{\"sourceId\":\"PUBLIC/source\",\"instanceId\":\"PUBLIC/instance\",\"resourceKey\":\"PUBLIC/resource\","
        "\"epoch\":\"18446744073709551615\",\"sequence\":\"9007199254740993\",\"head\":\"" + std::string(64, 'c') +
        "\",\"status\":\"active\",\"issuedAtMs\":1700000000000,\"expiresAtMs\":1700000020000}";
}

std::string payload(const std::string &code, const Life &life,
                    const rc::HeldProcessIdentity &expected_server = server,
                    const rc::HeldProcessIdentity &expected_caller = caller) {
    return "{\"code\":" + quote(code) + ",\"classification\":\"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA\","
        "\"authority\":false,\"registeredIssuer\":false,\"productionEnabled\":false," +
        (code == "DATA_ONLY" ? "\"resourceCurrent\":" + current_json() + "," : "") +
        "\"observation\":{\"sessionId\":" + quote(session_id) + ",\"server\":" + process_json(expected_server) +
        ",\"caller\":" + process_json(expected_caller) + ",\"lifetime\":" + life_json(life) + "}}";
}

std::string envelope(const std::string &value, bool result_first = false) {
    const std::string prefix = "\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":" + quote(request_id) +
        ",\"code\":\"OK\",\"peer\":{\"uid\":501,\"gid\":20,\"pid\":1234,"
        "\"credentialSource\":\"darwin-LOCAL_PEERCRED-Xucred\",\"nativeIPCVerified\":true,\"browserIdentityVerified\":false}";
    const std::string result = "\"result\":{\"payload\":" + value + "}";
    return result_first ? "{" + result + "," + prefix + "}" : "{" + prefix + "," + result + "}";
}

std::string fixture(const std::string &code = "DATA_ONLY", Life life = acquired) {
    return envelope(payload(code, life));
}

bool same(const rc::HeldProcessIdentity &a, const rc::HeldProcessIdentity &b) {
    return a.pid == b.pid && a.uid == b.uid && a.start_identity == b.start_identity &&
        a.image_path == b.image_path && a.image_sha256 == b.image_sha256;
}

bool same(const rc::CurrentData &a, const rc::CurrentData &b) {
    return a.resource.source_id == b.resource.source_id && a.resource.instance_id == b.resource.instance_id &&
        a.resource.resource_key == b.resource.resource_key && a.epoch == b.epoch && a.sequence == b.sequence &&
        a.head == b.head && a.status == b.status && a.issued_at_ms == b.issued_at_ms && a.expires_at_ms == b.expires_at_ms;
}

bool same(const rc::HeldReply &a, const rc::HeldReply &b) {
    const auto &x = a.observation, &y = b.observation;
    return a.code == b.code && a.has_data == b.has_data && same(a.data, b.data) && x.session_id == y.session_id &&
        same(x.server, y.server) && same(x.caller, y.caller) && x.partial_acquired == y.partial_acquired &&
        x.retired == y.retired && x.joined == y.joined && x.physical_complete == y.physical_complete;
}

rc::HeldReply sentinel() {
    rc::HeldReply reply;
    reply.code = "unchanged/code";
    reply.has_data = true;
    reply.data = {{"unchanged/source", "unchanged/instance", "unchanged/key"}, "unchanged/epoch", "unchanged/seq",
                  "unchanged/head", "unchanged/status", 7, 11};
    reply.observation = {"unchanged/session", server, caller, false, true, false, true};
    return reply;
}

rc::HeldReply accept(const std::string &raw, rc::HeldAction action, const std::string &label,
                     const rc::HeldProcessIdentity &expected_server = server,
                     const rc::HeldProcessIdentity &expected_caller = caller,
                     const std::string &expected_session = session_id) {
    auto out = sentinel();
    std::string failure = "stale failure";
    require(rc::decode_held_response(raw, request_id, 501, 1234, resource, expected_server, expected_caller,
                                    action, out, failure), "accept " + label + ": " + failure);
    require(failure.empty(), "stale successful failure: " + label);
    require(out.observation.session_id == expected_session && same(out.observation.server, expected_server) &&
            same(out.observation.caller, expected_caller), "original observation changed: " + label);
    ++controls;
    return out;
}

void reject(const std::string &raw, rc::HeldAction action, const std::string &label,
            const rc::HeldProcessIdentity &expected_server = server,
            const rc::HeldProcessIdentity &expected_caller = caller,
            const rc::ResourceIdentity &expected_resource = resource,
            const std::string &id = request_id, std::uint32_t uid = 501, std::int32_t pid = 1234) {
    const auto before = sentinel();
    auto out = before;
    std::string failure;
    require(!rc::decode_held_response(raw, id, uid, pid, expected_resource, expected_server, expected_caller,
                                     action, out, failure), "accepted invalid held reply: " + label);
    require(!failure.empty(), "missing held failure: " + label);
    require(same(out, before), "partial held output committed on failure: " + label);
    ++controls;
}

void actual_optional_and_lifecycle_controls() {
    const auto data = accept(fixture(), rc::HeldAction::current, "original DATA_ONLY");
    require(data.code == "DATA_ONLY" && data.has_data && data.data.epoch == "18446744073709551615" &&
            data.data.sequence == "9007199254740993" && data.observation.partial_acquired && !data.observation.retired,
            "current counters/held lease not preserved");
    const auto unavailable = accept(fixture("UNAVAILABLE", acquired), rc::HeldAction::current, "unavailable retained partial");
    require(!unavailable.has_data && unavailable.data.epoch.empty() && unavailable.observation.partial_acquired,
            "UNAVAILABLE fabricated DATA or discarded lease observation");
    const auto published = accept(fixture("UNAVAILABLE", {false, false, false, false}), rc::HeldAction::current,
                                  "published attempt without a reader");
    require(!published.observation.partial_acquired && published.observation.session_id == session_id,
            "partial=false discarded published session");
    accept(fixture("UNAVAILABLE", retired), rc::HeldAction::current, "retired current is unavailable");
    accept(fixture("RETIRED", retired), rc::HeldAction::retire, "retired acknowledgement");
    accept(fixture("DRAINED", joined), rc::HeldAction::join, "actual joined reader");
    accept(fixture("PENDING", retired), rc::HeldAction::join, "join pending debt");
    accept(fixture("PENDING", acquired), rc::HeldAction::join, "actual join-before-retire pending");
    accept(fixture("PENDING", retired), rc::HeldAction::close, "close before join remains pending");
    accept(fixture("PENDING", joined), rc::HeldAction::close, "joined reader Close still pending");
    accept(fixture("CLOSED", closed), rc::HeldAction::close, "physical close acknowledgement");
    accept(fixture("RETIRED", closed), rc::HeldAction::retire, "idempotent Retire after close");
    accept(fixture("DRAINED", closed), rc::HeldAction::join, "idempotent Join after close");
    accept(fixture("CLOSED", {false, true, true, true}), rc::HeldAction::close, "published attempt physically closed");
    accept(fixture("DRAINED", {false, true, true, false}), rc::HeldAction::join, "published attempt drain");
    for (const auto &code : {"UNAVAILABLE", "RETIRED", "DRAINED", "PENDING", "CLOSED"}) {
        const rc::HeldAction action = std::string(code) == "UNAVAILABLE" ? rc::HeldAction::current :
            std::string(code) == "RETIRED" ? rc::HeldAction::retire :
            std::string(code) == "CLOSED" ? rc::HeldAction::close : rc::HeldAction::join;
        const Life life = std::string(code) == "CLOSED" ? closed : std::string(code) == "DRAINED" ? joined : retired;
        auto raw = fixture(code, life);
        // The pointer fields are omitted by actual Go JSON, never explicit null.
        raw = replace(raw, "\"observation\":", "\"resourceCurrent\":null,\"observation\":");
        reject(raw, action, std::string(code) + " resourceCurrent null instead of omitted");
        reject(replace(raw, "\"resourceCurrent\":null", "\"resourceCurrent\":" + current_json()), action,
               std::string(code) + " stale resourceCurrent attached");
    }
    reject(fixture(), rc::HeldAction::current, "missing data on DATA_ONLY", server, caller, {"wrong", resource.instance_id, resource.resource_key});
    reject(replace(fixture(), "\"resourceCurrent\":" + current_json() + ",", ""), rc::HeldAction::current, "missing original9");
    reject(fixture("NOT_SUPPLIED", acquired), rc::HeldAction::current, "one-shot NOT_SUPPLIED is not a held observation");
}

void action_code_and_lifetime_controls() {
    struct Reply { const char *code; Life life; };
    const std::vector<Reply> replies{{"DATA_ONLY", acquired}, {"UNAVAILABLE", acquired}, {"RETIRED", retired},
                                   {"DRAINED", joined}, {"PENDING", retired}, {"CLOSED", closed}};
    for (const auto action : {rc::HeldAction::current, rc::HeldAction::retire, rc::HeldAction::join, rc::HeldAction::close}) {
        for (const auto &reply : replies) {
            const std::string code = reply.code;
            const bool allowed = (action == rc::HeldAction::current && (code == "DATA_ONLY" || code == "UNAVAILABLE")) ||
                (action == rc::HeldAction::retire && code == "RETIRED") ||
                (action == rc::HeldAction::join && (code == "DRAINED" || code == "PENDING")) ||
                (action == rc::HeldAction::close && (code == "CLOSED" || code == "PENDING"));
            if (!allowed) reject(fixture(code, reply.life), action, "wrong-action code " + code);
        }
    }
    reject(fixture(), static_cast<rc::HeldAction>(99), "unknown local action");
    for (const Life life : std::vector<Life>{{false, false, false, false}, retired, joined, closed})
        reject(fixture("DATA_ONLY", life), rc::HeldAction::current, "DATA_ONLY requires acquired/live lifetime");
    reject(fixture("RETIRED", acquired), rc::HeldAction::retire, "RETIRED without retired");
    reject(fixture("DRAINED", retired), rc::HeldAction::join, "DRAINED without joined");
    reject(fixture("DRAINED", {true, false, true, false}), rc::HeldAction::join, "joined without retired");
    reject(fixture("PENDING", joined), rc::HeldAction::join, "Join PENDING cannot claim joined");
    reject(fixture("PENDING", closed), rc::HeldAction::join, "Join PENDING cannot claim physical");
    reject(fixture("PENDING", closed), rc::HeldAction::close, "Close PENDING cannot claim physical");
    reject(fixture("CLOSED", joined), rc::HeldAction::close, "CLOSED without physical");
    reject(fixture("CLOSED", {true, true, false, true}), rc::HeldAction::close, "physical without joined");
    reject(fixture("UNAVAILABLE", {false, false, true, false}), rc::HeldAction::current, "UNAVAILABLE cannot erase impossible lifetime");
    reject(fixture("UNAVAILABLE", {false, true, false, true}), rc::HeldAction::current, "physical cannot precede join");
}

void observation_schema_controls() {
    const std::string without_observation = "{\"code\":\"UNAVAILABLE\",\"classification\":\"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA\","
        "\"authority\":false,\"registeredIssuer\":false,\"productionEnabled\":false}";
    reject(envelope(without_observation), rc::HeldAction::current, "one-shot unavailable lacks held observation");
    reject(envelope(without_observation.substr(0, without_observation.size() - 1) + ",\"observation\":null}"),
           rc::HeldAction::current, "omitempty observation cannot be null in a held reply");
    for (const auto &mutation : std::vector<std::pair<std::string, std::string>>{
        {"\"observation\":", "\"Observation\":"},
        {"\"observation\":{", "\"observation\":{\"extra\":false,"},
        {"\"sessionId\":", "\"SessionId\":"},
        {"\"sessionId\":", "\"session\\u0049d\":\"duplicate\",\"sessionId\":"},
        {"\"server\":", "\"Server\":"}, {"\"caller\":", "\"Caller\":"},
        {"\"lifetime\":", "\"Lifetime\":"},
        {"\"lifetime\":{", "\"lifetime\":{\"unknown\":false,"},
        {"\"partialAcquired\":true,", ""}, {"\"retired\":false,", ""},
        {"\"joined\":false,", ""}, {",\"physicalComplete\":false", ""},
        {"\"partialAcquired\":true", "\"partialAcquired\":1"},
        {"\"retired\":false", "\"retired\":\"false\""},
        {"\"joined\":false", "\"joined\":null"},
        {"\"physicalComplete\":false", "\"physicalComplete\":[]"},
        {"\"partialAcquired\":true", "\"partialAcquired\":true,\"partialAcquired\":true"},
        {"\"authority\":false", "\"authority\":true"},
        {"\"registeredIssuer\":false", "\"registeredIssuer\":true"},
        {"\"productionEnabled\":false", "\"productionEnabled\":true"},
        {"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA", "REGISTERED_RESOURCE_CURRENT"},
        {"\"observation\":", "\"RootAdmission\":false,\"observation\":"}
    }) reject(replace(fixture(), mutation.first, mutation.second), rc::HeldAction::current, "held schema " + mutation.second);
    for (const std::string &bad : std::vector<std::string>{"", "has.dot", "has space", "has/slash", "session\nline", std::string(81, 's')})
        reject(replace(fixture(), quote(session_id), quote(bad)), rc::HeldAction::current, "bad session identifier");
    reject(replace(fixture(), quote(session_id), "123"), rc::HeldAction::current, "numeric session identifier");
    accept(replace(fixture(), "\"observation\"", "\"observat\\u0069on\""), rc::HeldAction::current, "escaped exact observation name");
    accept(replace(fixture(), quote(session_id), quote(std::string(80, 's'))), rc::HeldAction::current,
           "80-byte protocol session ID", server, caller, std::string(80, 's'));
}

void independent_process_controls() {
    for (const auto &prefix : {"server", "caller"}) {
        const auto &process = std::string(prefix) == "server" ? server : caller;
        const auto original = process_json(process);
        for (const auto &mutation : std::vector<std::pair<std::string, std::string>>{
            {"\"pid\":" + std::to_string(process.pid), "\"pid\":9999"},
            {"\"uid\":501", "\"uid\":502"},
            {"\"pid\":" + std::to_string(process.pid), "\"pid\":\"" + std::to_string(process.pid) + "\""},
            {"\"uid\":501", "\"uid\":501.0"}, {"\"uid\":501", "\"uid\":4294967296"},
            {"\"pid\":" + std::to_string(process.pid), "\"pid\":2147483648"},
            {quote(process.start_identity), "\"darwin:different-incarnation\""},
            {quote(process.image_path), "\"/PUBLIC/different-image\""},
            {quote(process.image_sha256), quote(std::string(64, 'd'))},
            {"\"imageSHA256\":", "\"imageSha256\":"},
            {"\"startIdentity\":", "\"startidentity\":"},
            {"\"imagePath\":", "\"imagePath\":\"/duplicate\",\"imagePath\":"},
            {"\"pid\":", "\"extra\":false,\"pid\":"},
            {",\"imageSHA256\":" + quote(process.image_sha256), ""}
        }) reject(replace(fixture(), original, replace(original, mutation.first, mutation.second)), rc::HeldAction::current,
                   std::string(prefix) + " independent identity " + mutation.second);
    }
    reject(replace(fixture(), "\"uid\":501,\"gid\":20,\"pid\":1234", "\"uid\":501,\"gid\":20,\"pid\":4321"),
           rc::HeldAction::current, "peer must reflect client, not server");
    reject(fixture(), rc::HeldAction::current, "caller expected PID must match independent API", server, server);
    for (unsigned which = 0; which < 2; ++which) {
        for (unsigned mutation = 0; mutation < 8; ++mutation) {
            auto expected = which == 0 ? server : caller;
            switch (mutation) {
            case 0: expected.pid = 0; break;
            case 1: expected.uid = 502; break;
            case 2: expected.start_identity.clear(); break;
            case 3: expected.start_identity.assign(161, 's'); break;
            case 4: expected.image_path = "relative-image"; break;
            case 5: expected.image_path = "/" + std::string(4096, 'p'); break;
            case 6: expected.image_sha256.assign(64, 'A'); break;
            default: expected.image_sha256.assign(63, 'a'); break;
            }
            reject(fixture(), rc::HeldAction::current, "invalid independent expected process shape",
                   which == 0 ? expected : server, which == 1 ? expected : caller);
        }
    }
    auto unicode = server;
    unicode.image_path = u8"/PUBLIC/原始😀-helper";
    auto raw = envelope(payload("DATA_ONLY", acquired, unicode));
    raw = replace(raw, quote(unicode.image_path), "\"/PUBLIC/\\u539f\\u59cb\\ud83d\\ude00-helper\"");
    accept(raw, rc::HeldAction::current, "unescaped process image equality", unicode);
    auto tricky = server;
    tricky.image_path = "/PUBLIC/quoted\"}] braces [ and \\slash";
    accept(envelope(payload("DATA_ONLY", acquired, tricky), true), rc::HeldAction::current,
           "raw span ignores escaped braces inside image path", tricky);
    auto linux_server = server, linux_caller = caller;
    linux_server.start_identity = "linux:PUBLIC-boot-id:121";
    linux_caller.start_identity = "linux:PUBLIC-boot-id:122";
    auto linux_frame = envelope(payload("DATA_ONLY", acquired, linux_server, linux_caller));
    linux_frame = replace(linux_frame, "darwin-LOCAL_PEERCRED-Xucred", "linux-SO_PEERCRED");
    accept(linux_frame, rc::HeldAction::current, "actual Linux identity string shape", linux_server, linux_caller);
}

void held_data_and_bound_controls() {
    // These few new integration controls prove held DATA uses original9
    // validation. The independent r1 lexical/canonical suite is not repeated.
    for (const auto &mutation : std::vector<std::pair<std::string, std::string>>{
        {"\"sequence\":\"9007199254740993\"", "\"sequence\":\"18446744073709551616\""},
        {"\"epoch\":\"18446744073709551615\"", "\"epoch\":\"01\""},
        {std::string(64, 'c'), std::string(64, 'C')},
        {"1700000020000", "1700000019999"}, {"1700000000000", "1700000000000.0"},
        {"\"status\":\"active\"", "\"status\":\"inactive\""},
        {"\"sourceId\":\"PUBLIC/source\"", "\"sourceId\":\"foreign/source\""},
        {"\"resourceCurrent\":{", "\"resourceCurrent\":{\"extra\":false,"}
    }) reject(replace(fixture(), mutation.first, mutation.second), rc::HeldAction::current, "held original9 " + mutation.second);
    accept(envelope(payload("DATA_ONLY", acquired), true), rc::HeldAction::current, "result before other root fields");
    auto escaped = replace(fixture(), "\"result\"", "\"res\\u0075lt\"");
    escaped = replace(escaped, "\"payload\"", "\"pay\\u006coad\"");
    accept(escaped, rc::HeldAction::current, "decoded field order drives raw payload span");
    auto exact = payload("DATA_ONLY", acquired);
    require(exact.size() < 12288, "fixture unexpectedly exceeds payload bound");
    exact.insert(1, 12288 - exact.size(), ' ');
    accept(envelope(exact), rc::HeldAction::current, "exact 12288 raw payload bytes");
    exact.insert(1, 1, ' ');
    reject(envelope(exact), rc::HeldAction::current, "12289 raw payload bytes within a bounded frame");
    const auto raw = fixture();
    accept(raw + std::string(16384 - raw.size(), ' '), rc::HeldAction::current, "exact original frame size");
    reject(raw + std::string(16385 - raw.size(), ' '), rc::HeldAction::current, "held frame exceeds original bound");
    reject(raw + "{}", rc::HeldAction::current, "trailing second held response");
    reject(replace(raw, server.image_path, "/PUBLIC/\xed\xa0\x80"), rc::HeldAction::current, "invalid UTF8 image observation");
    reject(replace(raw, server.image_path, "/PUBLIC/\\ud800"), rc::HeldAction::current, "unpaired image surrogate");
    std::string nested = "0";
    for (unsigned i = 0; i < 11; ++i) nested = "[" + nested + "]";
    reject(replace(raw, "\"lifetime\":", "\"extra\":" + nested + ",\"lifetime\":"), rc::HeldAction::current,
           "held observation still uses frozen depth bound");
}

} // namespace

int main() {
    try {
        actual_optional_and_lifecycle_controls();
        action_code_and_lifetime_controls();
        observation_schema_controls();
        independent_process_controls();
        held_data_and_bound_controls();
        std::cout << "{\"status\":\"PASS\",\"publicHeldCodecControls\":" << controls
                  << ",\"r1SuiteRerun\":false,\"kernelOrGoOrCryptoExecuted\":false,\"sourceAdmission\":false}\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "resource-current-held-json PUBLIC control failed: " << error.what() << '\n';
        return 1;
    }
}
