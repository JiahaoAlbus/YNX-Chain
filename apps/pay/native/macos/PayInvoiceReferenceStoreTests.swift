import Foundation
@main struct PayInvoiceReferenceStoreTests {
    static func main() throws {
        if CommandLine.arguments.count == 3 {
            let suite = CommandLine.arguments[2]
            guard let defaults = UserDefaults(suiteName: suite) else { fatalError("isolated defaults unavailable") }
            let store = PayInvoiceReferenceStore(defaults: defaults)
            if CommandLine.arguments[1] == "write" { try store.save("invoice-original"); return }
            if CommandLine.arguments[1] == "verify" { let saved = try store.read(); precondition(saved == "invoice-original"); print(saved!); defaults.removePersistentDomain(forName: suite); return }
            fatalError("invalid test mode")
        }
        let suite = "ynx.pay.test." + UUID().uuidString
        guard let defaults = UserDefaults(suiteName: suite) else { fatalError("isolated defaults unavailable") }
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = PayInvoiceReferenceStore(defaults: defaults)
        try first.save("invoice-original")
        let reopened = PayInvoiceReferenceStore(defaults: UserDefaults(suiteName: suite)!)
        let restored = try reopened.read(); precondition(restored == "invoice-original")
        do { try reopened.save("invoice-replacement"); fatalError("replaced original") } catch PayInvoiceReferenceStore.Failure.retainedOriginal {}
        let retained = try reopened.read(); precondition(retained == "invoice-original")
        do { try reopened.save("../foreign"); fatalError("invalid id accepted") } catch PayInvoiceReferenceStore.Failure.invalid {}
        reopened.clear()
        let cleared = try reopened.read(); precondition(cleared == nil)
        defaults.set(123, forKey: "ynx.pay.originalInvoiceReference.v1")
        do { try reopened.save("invoice-original"); fatalError("overwrote unreadable original") } catch PayInvoiceReferenceStore.Failure.unreadable {}
        precondition(defaults.integer(forKey: "ynx.pay.originalInvoiceReference.v1") == 123)
    }
}
