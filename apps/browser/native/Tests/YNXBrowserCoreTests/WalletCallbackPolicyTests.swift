import CryptoKit
import Foundation
import Testing
@testable import YNXBrowserCore

@Suite("Native Wallet callback fail-closed boundary")
struct WalletCallbackPolicyTests {
    private let now = Date(timeIntervalSince1970: 1_785_148_800)

    @Test("valid callback consumes signed pending state and creates no local session")
    func validCallbackConsumesOnce() throws {
        let fixture = try fixture()
        let message = try BrowserWalletCallbackPolicy.validateAndConsume(
            url: callbackURL(response: response(nonce: fixture.nonce)),
            defaults: fixture.defaults,
            now: now,
            verificationKey: fixture.key.publicKey
        )

        #expect(message.contains("no Product Session was created locally"))
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) == nil)
        #expect(callbackError(
            url: callbackURL(response: response(nonce: fixture.nonce)),
            defaults: fixture.defaults,
            key: fixture.key
        ) == .pendingMissingOrConsumed)
    }

    @Test("missing pending state rejects callback")
    func missingPendingRejects() {
        let (suite, defaults) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let key = P256.Signing.PrivateKey()

        #expect(callbackError(
            url: callbackURL(response: response(nonce: "missing")),
            defaults: defaults,
            key: key
        ) == .pendingMissingOrConsumed)
    }

    @Test("expired request is consumed and cannot be replayed")
    func expiryConsumesPending() throws {
        let fixture = try fixture(expiresAt: now.addingTimeInterval(-1))
        let url = callbackURL(response: response(nonce: fixture.nonce))

        #expect(callbackError(url: url, defaults: fixture.defaults, key: fixture.key) == .requestExpired)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) == nil)
        #expect(callbackError(url: url, defaults: fixture.defaults, key: fixture.key) == .pendingMissingOrConsumed)
    }

    @Test(
        "route mismatch rejects without consuming signed pending state",
        arguments: [
            "https://com.ynxweb4.browser.macos/auth/callback",
            "ynxbrowser://com.ynxweb4.browser/auth/callback",
            "ynxbrowser://com.ynxweb4.browser.macos/wrong",
            "ynxbrowser://com.ynxweb4.browser.macos:9443/auth/callback",
            "ynxbrowser://user@com.ynxweb4.browser.macos/auth/callback",
            "ynxbrowser://com.ynxweb4.browser.macos/auth/callback#fragment"
        ]
    )
    func routeMismatchRejects(rawURL: String) throws {
        let fixture = try fixture()
        let pendingBefore = fixture.defaults.data(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey)
        let url = try #require(URL(string: rawURL))

        #expect(callbackError(url: url, defaults: fixture.defaults, key: fixture.key) == .routeMismatch)
        #expect(fixture.defaults.data(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) == pendingBefore)
    }

    @Test("unknown callback query field rejects without consuming pending state")
    func unknownQueryRejects() throws {
        let fixture = try fixture()
        let encoded = encodedResponse(response(nonce: fixture.nonce))
        let url = try #require(URL(string: "ynxbrowser://com.ynxweb4.browser.macos/auth/callback?response=\(encoded)&extra=1"))

        #expect(callbackError(url: url, defaults: fixture.defaults, key: fixture.key) == .queryMismatch)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test("duplicate response query field rejects without consuming pending state")
    func duplicateQueryRejects() throws {
        let fixture = try fixture()
        let encoded = encodedResponse(response(nonce: fixture.nonce))
        let url = try #require(URL(string: "ynxbrowser://com.ynxweb4.browser.macos/auth/callback?response=\(encoded)&response=\(encoded)"))

        #expect(callbackError(url: url, defaults: fixture.defaults, key: fixture.key) == .duplicateQueryField)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test("missing or empty response query rejects")
    func missingResponseRejects() throws {
        let fixture = try fixture()
        let missing = try #require(URL(string: "ynxbrowser://com.ynxweb4.browser.macos/auth/callback"))
        let empty = try #require(URL(string: "ynxbrowser://com.ynxweb4.browser.macos/auth/callback?response="))

        #expect(callbackError(url: missing, defaults: fixture.defaults, key: fixture.key) == .queryMismatch)
        #expect(callbackError(url: empty, defaults: fixture.defaults, key: fixture.key) == .queryMismatch)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test("malformed or oversized response data rejects before pending consumption")
    func malformedResponseRejects() throws {
        let fixture = try fixture()
        let invalidBase64 = try #require(URL(string: "ynxbrowser://com.ynxweb4.browser.macos/auth/callback?response=a"))
        let invalidJSON = callbackURL(encodedResponse: Data("not-json".utf8).base64URLEncodedString())
        let oversized = callbackURL(encodedResponse: String(repeating: "A", count: 16_385))

        #expect(callbackError(url: invalidBase64, defaults: fixture.defaults, key: fixture.key) == .responseMalformed)
        #expect(callbackError(url: invalidJSON, defaults: fixture.defaults, key: fixture.key) == .responseMalformed)
        #expect(callbackError(url: oversized, defaults: fixture.defaults, key: fixture.key) == .responseMalformed)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test("unknown, missing, empty, or wrong-type response fields reject")
    func responseEnvelopeRejects() throws {
        let fixture = try fixture()
        let base = response(nonce: fixture.nonce)
        var unknown = base
        unknown["unexpected"] = "value"
        var missing = base
        missing.removeValue(forKey: "bundleId")
        var empty = base
        empty["nonce"] = ""
        var wrongType: [String: Any] = base
        wrongType["chainId"] = 6423

        for value in [unknown, missing, empty] {
            #expect(callbackError(
                url: callbackURL(response: value),
                defaults: fixture.defaults,
                key: fixture.key
            ) == .responseFieldsMismatch)
        }
        #expect(callbackError(
            url: callbackURL(anyResponse: wrongType),
            defaults: fixture.defaults,
            key: fixture.key
        ) == .responseFieldsMismatch)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test("duplicate JSON response fields reject, including escaped duplicate names")
    func duplicateResponseFieldsReject() throws {
        let fixture = try fixture()
        let bindings = BrowserWalletCallbackBindings.macOS
        let duplicate = "{\"nonce\":\"\(fixture.nonce)\",\"chainId\":\"\(bindings.chainId)\",\"productClientId\":\"\(bindings.productClientId)\",\"bundleId\":\"\(bindings.bundleId)\",\"nonce\":\"duplicate\"}"
        let escapedDuplicate = "{\"nonce\":\"\(fixture.nonce)\",\"chainId\":\"\(bindings.chainId)\",\"productClientId\":\"\(bindings.productClientId)\",\"bundleId\":\"\(bindings.bundleId)\",\"n\\u006fnce\":\"duplicate\"}"

        #expect(callbackError(
            url: callbackURL(rawResponseJSON: duplicate),
            defaults: fixture.defaults,
            key: fixture.key
        ) == .responseFieldsMismatch)
        #expect(callbackError(
            url: callbackURL(rawResponseJSON: escapedDuplicate),
            defaults: fixture.defaults,
            key: fixture.key
        ) == .responseFieldsMismatch)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test(
        "wrong response binding rejects without consuming pending state",
        arguments: ["nonce", "chainId", "productClientId", "bundleId"]
    )
    func wrongResponseBindingRejects(field: String) throws {
        let fixture = try fixture()
        var value = response(nonce: fixture.nonce)
        value[field] = "wrong"

        #expect(callbackError(
            url: callbackURL(response: value),
            defaults: fixture.defaults,
            key: fixture.key
        ) == .responseBindingMismatch)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test(
        "every signed pending binding rejects tampering",
        arguments: [
            "nonce",
            "expiresAtMilliseconds",
            "chainId",
            "requestingProduct",
            "productClientId",
            "bundleId",
            "callback",
            "productDeviceAlgorithm",
            "orderedScopes",
            "signature"
        ]
    )
    func pendingTamperRejects(field: String) throws {
        let fixture = try fixture()
        let data = try #require(fixture.defaults.data(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey))
        var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        switch field {
        case "expiresAtMilliseconds":
            object[field] = 0
        case "orderedScopes":
            object[field] = ["account:read", "browser:wallet-request", "wallet:sign"]
        case "signature":
            object[field] = "tampered-signature"
        default:
            object[field] = "tampered"
        }
        fixture.defaults.set(try JSONSerialization.data(withJSONObject: object), forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey)

        #expect(callbackError(
            url: callbackURL(response: response(nonce: fixture.nonce)),
            defaults: fixture.defaults,
            key: fixture.key
        ) == .pendingTampered)
    }

    @Test("wrong device verification key rejects signed pending state")
    func wrongDeviceKeyRejects() throws {
        let fixture = try fixture()

        #expect(callbackError(
            url: callbackURL(response: response(nonce: fixture.nonce)),
            defaults: fixture.defaults,
            key: P256.Signing.PrivateKey()
        ) == .pendingTampered)
        #expect(fixture.defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)
    }

    @Test("malformed pending state rejects without exposing decoder details")
    func malformedPendingRejects() throws {
        let fixture = try fixture()
        fixture.defaults.set(Data("{".utf8), forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey)

        #expect(callbackError(
            url: callbackURL(response: response(nonce: fixture.nonce)),
            defaults: fixture.defaults,
            key: fixture.key
        ) == .pendingMalformed)
    }

    @Test("unknown and duplicate pending JSON fields reject before signature verification")
    func pendingEnvelopeRejects() throws {
        let unknownFixture = try fixture()
        let unknownData = try #require(unknownFixture.defaults.data(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey))
        let unknownJSON = try #require(String(data: unknownData, encoding: .utf8))
        let withUnknown = String(unknownJSON.dropLast()) + ",\"unexpected\":true}"
        unknownFixture.defaults.set(Data(withUnknown.utf8), forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey)
        #expect(callbackError(
            url: callbackURL(response: response(nonce: unknownFixture.nonce)),
            defaults: unknownFixture.defaults,
            key: unknownFixture.key
        ) == .pendingMalformed)

        let duplicateFixture = try fixture()
        let duplicateData = try #require(duplicateFixture.defaults.data(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey))
        let duplicateJSON = try #require(String(data: duplicateData, encoding: .utf8))
        let withDuplicate = String(duplicateJSON.dropLast()) + ",\"nonce\":\"duplicate\"}"
        duplicateFixture.defaults.set(Data(withDuplicate.utf8), forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey)
        #expect(callbackError(
            url: callbackURL(response: response(nonce: duplicateFixture.nonce)),
            defaults: duplicateFixture.defaults,
            key: duplicateFixture.key
        ) == .pendingMalformed)

        let oversizedFixture = try fixture()
        oversizedFixture.defaults.set(Data(repeating: 65, count: 16_385), forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey)
        #expect(callbackError(
            url: callbackURL(response: response(nonce: oversizedFixture.nonce)),
            defaults: oversizedFixture.defaults,
            key: oversizedFixture.key
        ) == .pendingMalformed)
    }

    @Test("invalid pending input is rejected before serialization")
    func invalidPendingInputRejects() {
        let (suite, defaults) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let key = P256.Signing.PrivateKey()

        #expect(persistError(nonce: "", expiresAt: now.addingTimeInterval(300), defaults: defaults, key: key) == .pendingMalformed)
        #expect(persistError(nonce: "nonce", expiresAt: Date(timeIntervalSince1970: .infinity), defaults: defaults, key: key) == .pendingMalformed)
        #expect(persistError(nonce: String(repeating: "n", count: 20_000), expiresAt: now.addingTimeInterval(300), defaults: defaults, key: key) == .pendingMalformed)
        #expect(defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) == nil)
    }

    @Test("persist and clear remove legacy unsigned pending keys")
    func legacyKeysAreRemoved() throws {
        let (suite, defaults) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("legacy-nonce", forKey: "walletPendingNonce")
        defaults.set(now.timeIntervalSince1970, forKey: "walletPendingExpiry")
        let key = P256.Signing.PrivateKey()

        try BrowserWalletCallbackPolicy.persistPending(
            nonce: "new-nonce",
            expiresAt: now.addingTimeInterval(300),
            defaults: defaults,
            signingKey: key
        )
        #expect(defaults.object(forKey: "walletPendingNonce") == nil)
        #expect(defaults.object(forKey: "walletPendingExpiry") == nil)
        #expect(defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) != nil)

        BrowserWalletCallbackPolicy.clearPending(defaults: defaults)
        #expect(defaults.object(forKey: BrowserWalletCallbackPolicy.pendingDefaultsKey) == nil)
    }

    private func fixture(expiresAt: Date? = nil) throws -> Fixture {
        let (suite, defaults) = isolatedDefaults()
        let key = P256.Signing.PrivateKey()
        let nonce = "nonce-\(UUID().uuidString)"
        try BrowserWalletCallbackPolicy.persistPending(
            nonce: nonce,
            expiresAt: expiresAt ?? now.addingTimeInterval(300),
            defaults: defaults,
            signingKey: key
        )
        return Fixture(suite: suite, defaults: defaults, key: key, nonce: nonce)
    }

    private func callbackError(
        url: URL,
        defaults: UserDefaults,
        key: P256.Signing.PrivateKey
    ) -> BrowserWalletCallbackError? {
        do {
            _ = try BrowserWalletCallbackPolicy.validateAndConsume(
                url: url,
                defaults: defaults,
                now: now,
                verificationKey: key.publicKey
            )
            return nil
        } catch let error as BrowserWalletCallbackError {
            return error
        } catch {
            return nil
        }
    }

    private func persistError(
        nonce: String,
        expiresAt: Date,
        defaults: UserDefaults,
        key: P256.Signing.PrivateKey
    ) -> BrowserWalletCallbackError? {
        do {
            try BrowserWalletCallbackPolicy.persistPending(
                nonce: nonce,
                expiresAt: expiresAt,
                defaults: defaults,
                signingKey: key
            )
            return nil
        } catch let error as BrowserWalletCallbackError {
            return error
        } catch {
            return nil
        }
    }

    private func response(nonce: String) -> [String: String] {
        [
            "nonce": nonce,
            "chainId": BrowserWalletCallbackBindings.macOS.chainId,
            "productClientId": BrowserWalletCallbackBindings.macOS.productClientId,
            "bundleId": BrowserWalletCallbackBindings.macOS.bundleId
        ]
    }

    private func callbackURL(response: [String: String]) -> URL {
        callbackURL(anyResponse: response)
    }

    private func callbackURL(anyResponse: [String: Any]) -> URL {
        let data = try! JSONSerialization.data(withJSONObject: anyResponse, options: [.sortedKeys])
        return callbackURL(encodedResponse: data.base64URLEncodedString())
    }

    private func callbackURL(rawResponseJSON: String) -> URL {
        callbackURL(encodedResponse: Data(rawResponseJSON.utf8).base64URLEncodedString())
    }

    private func callbackURL(encodedResponse: String) -> URL {
        var components = URLComponents()
        components.scheme = BrowserWalletCallbackBindings.macOS.scheme
        components.host = BrowserWalletCallbackBindings.macOS.host
        components.path = BrowserWalletCallbackBindings.macOS.path
        components.queryItems = [URLQueryItem(name: "response", value: encodedResponse)]
        return components.url!
    }

    private func encodedResponse(_ response: [String: String]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: response, options: [.sortedKeys])
        return data.base64URLEncodedString()
    }

    private func isolatedDefaults() -> (String, UserDefaults) {
        let suite = "com.ynxweb4.browser.wallet-tests.\(UUID().uuidString)"
        return (suite, UserDefaults(suiteName: suite)!)
    }

    private final class Fixture {
        let suite: String
        let defaults: UserDefaults
        let key: P256.Signing.PrivateKey
        let nonce: String

        init(suite: String, defaults: UserDefaults, key: P256.Signing.PrivateKey, nonce: String) {
            self.suite = suite
            self.defaults = defaults
            self.key = key
            self.nonce = nonce
        }

        deinit {
            defaults.removePersistentDomain(forName: suite)
        }
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
