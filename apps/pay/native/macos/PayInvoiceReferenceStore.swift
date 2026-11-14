import Foundation

// A user-selected lookup hint only; this stores no account, authority or result.
struct PayInvoiceReferenceStore {
    enum Failure: Error { case invalid, retainedOriginal, unreadable }
    private let defaults: UserDefaults
    private let key = "ynx.pay.originalInvoiceReference.v1"
    init(defaults: UserDefaults) { self.defaults = defaults }
    private func valid(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$", options: .regularExpression) != nil
    }
    func read() throws -> String? {
        guard let value = defaults.object(forKey: key) else { return nil }
        guard let text = value as? String, valid(text) else { throw Failure.unreadable }
        return text
    }
    func save(_ value: String) throws {
        guard valid(value) else { throw Failure.invalid }
        if let original = try read(), original != value { throw Failure.retainedOriginal }
        defaults.set(value, forKey: key)
    }
    func clear() { defaults.removeObject(forKey: key) }
}
