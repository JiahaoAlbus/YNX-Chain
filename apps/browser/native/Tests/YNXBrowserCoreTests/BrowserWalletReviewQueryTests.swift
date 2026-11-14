import Foundation
import Testing
@testable import YNXBrowserCore

@Suite struct BrowserWalletReviewQueryTests {
    @Test func finiteFieldsAreOnlyDecodedDisplayDataForEitherScheme() throws {
        for scheme in ["ynxwallet", "ynx-wallet", "YNXWallet"] {
            let raw = scheme + "://sign/request?requestingProduct=claimed-product&callback=ynxbrowser%3A%2F%2Freturn&scopes=read%20sign&recipient=claimed-recipient&amount=1.5&fee=unverified&data=0xabc%3D%3D&expiresAt=unverified"
            let review = try BrowserWalletReviewQuery.parse(raw)
            #expect(review.fields.count == 8)
            #expect(review["requestingProduct"] == "claimed-product")
            #expect(review["callback"] == "ynxbrowser://return")
            #expect(review["scopes"] == "read sign")
            #expect(review["data"] == "0xabc==")
            #expect(review["authorization"] == nil)
            #expect(try BrowserWalletReviewQuery.parse(URL(string: raw)!) == review)
        }
    }
    @Test func duplicateDecodedKeysRejectInsteadOfSelectingAValueOrTrapping() {
        for query in ["scopes=read&scopes=sign", "scopes=read&%73copes=sign", "%73copes=read&scopes=sign", "callback=first&call%62ack=second", "requestingProduct=first&requesting%50roduct=second"] {
            #expect(throws: BrowserWalletReviewQueryFailure.duplicateKey) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?" + query) }
            #expect(throws: BrowserWalletReviewQueryFailure.duplicateKey) { _ = try BrowserWalletReviewQuery.parse(URL(string: "ynx-wallet://sign?" + query)!) }
        }
    }
    @Test func decodingIsSinglePassAndPlusIsNotAnImplicitSpace() throws {
        #expect(try BrowserWalletReviewQuery.parse("ynxwallet://sign?%73copes=read+sign")["scopes"] == "read+sign")
        #expect(throws: BrowserWalletReviewQueryFailure.unknownField) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?%2573copes=read") }
        #expect(throws: BrowserWalletReviewQueryFailure.unknownField) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?Scopes=read") }
    }
    @Test func missingValuesUnknownFieldsAndEmptyPairsAreRefused() {
        for query in ["", "scopes", "scopes=", "=read", "scopes=read&&fee=1", "scopes=read&", "&scopes=read"] {
            #expect(throws: BrowserWalletReviewQueryFailure.invalidQuery) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?" + query) }
        }
        for query in ["authorized=true", "requesterIdentity=trusted", "grant=approved", "network=mainnet"] {
            #expect(throws: BrowserWalletReviewQueryFailure.unknownField) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?" + query) }
        }
    }
    @Test func malformedPercentAndInvalidUTF8CannotBeRepairedIntoDisplayFields() {
        for query in ["scopes=%", "scopes=%0", "scopes=%GG"] {
            #expect(throws: BrowserWalletReviewQueryFailure.invalidURL) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?" + query) }
        }
        for query in ["scopes=%FF", "scopes=%C0%AF", "scopes=%ED%A0%80"] {
            #expect(throws: BrowserWalletReviewQueryFailure.invalidQuery) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?" + query) }
        }
    }
    @Test func credentialsSchemesRelativeURLsPortsAndFragmentsAreRejected() {
        for raw in ["ynxwallet://user:password@sign?scopes=read", "ynx-wallet://@sign?scopes=read"] {
            #expect(throws: BrowserWalletReviewQueryFailure.credentialsNotAllowed) { _ = try BrowserWalletReviewQuery.parse(raw) }
        }
        for raw in ["ynxwallet:sign?scopes=read", "ynxwallet://?scopes=read", "ynxwallet://sign:/?scopes=read", "ynxwallet://sign:443?scopes=read", "ynxwallet://%75ser%40sign?scopes=read", "ynxwallet://sign?scopes=read#hidden"] {
            #expect(throws: BrowserWalletReviewQueryFailure.invalidURL) { _ = try BrowserWalletReviewQuery.parse(raw) }
        }
        for raw in ["https://sign?scopes=read", "file://sign?scopes=read", "ynxbrowser://sign?scopes=read"] {
            #expect(throws: BrowserWalletReviewQueryFailure.unsupportedScheme) { _ = try BrowserWalletReviewQuery.parse(raw) }
        }
        let relative = URL(string: "?scopes=read", relativeTo: URL(string: "ynxwallet://sign")!)!
        #expect(throws: BrowserWalletReviewQueryFailure.invalidURL) { _ = try BrowserWalletReviewQuery.parse(relative) }
    }
    @Test func controlBidiAndLineInjectionCannotSpoofReviewLabels() {
        for encoded in ["%00", "%0A", "%0D", "%09", "%7F", "%C2%85", "%E2%80%AE", "%E2%80%A8", "%E2%80%8B"] {
            #expect(throws: BrowserWalletReviewQueryFailure.unsafeText) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?requestingProduct=claimed" + encoded + "trusted") }
        }
        #expect(throws: BrowserWalletReviewQueryFailure.unsafeText) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?scopes=read sign") }
        #expect(throws: BrowserWalletReviewQueryFailure.unsafeText) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign\\other?scopes=read") }
    }
    @Test func UTF8FieldAndWholeURLBoundsAreEnforcedBeforeReview() throws {
        #expect(try BrowserWalletReviewQuery.parse("ynxwallet://sign?requestingProduct=" + String(repeating: "x", count: 256))["requestingProduct"]?.utf8.count == 256)
        #expect(throws: BrowserWalletReviewQueryFailure.fieldTooLarge) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?requestingProduct=" + String(repeating: "x", count: 257)) }
        #expect(throws: BrowserWalletReviewQueryFailure.fieldTooLarge) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?requestingProduct=" + String(repeating: "测", count: 86)) }
        #expect(try BrowserWalletReviewQuery.parse("ynxwallet://sign?data=" + String(repeating: "a", count: 4096))["data"]?.count == 4096)
        #expect(throws: BrowserWalletReviewQueryFailure.fieldTooLarge) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?data=" + String(repeating: "a", count: 4097)) }
        #expect(throws: BrowserWalletReviewQueryFailure.tooLarge) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?data=" + String(repeating: "%23", count: 4096)) }
        #expect(throws: BrowserWalletReviewQueryFailure.tooLarge) { _ = try BrowserWalletReviewQuery.parse("ynxwallet://sign?" + Array(repeating: "fee=1", count: 9).joined(separator: "&")) }
    }
    @Test func emptyReviewDoesNotInventRequestOrApprovalFields() throws {
        let empty = try BrowserWalletReviewQuery.parse("ynxwallet://sign")
        #expect(empty.fields.isEmpty)
        #expect(empty["requestingProduct"] == nil && empty["scopes"] == nil)
        #expect(try BrowserWalletReviewQuery.parse("ynx-wallet://sign?requestingProduct=%E6%B5%8B%E8%AF%95")["requestingProduct"] == "测试")
    }
}
