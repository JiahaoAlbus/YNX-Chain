@main struct PayStatusMessageTests {
    static func main() {
        precondition(PayStatusMessage.text(code: "NATIVE_PAY_NORMAL_MAIN_SOURCE_NOT_SUPPLIED", outcomeUnknown: false)?.contains("Wallet") == true)
        precondition(PayStatusMessage.text(code: "NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED", outcomeUnknown: false)?.contains("same invoice") == true)
        precondition(PayStatusMessage.text(code: nil, outcomeUnknown: true)?.contains("original invoice") == true)
        precondition(PayStatusMessage.text(code: "NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE", outcomeUnknown: true)?.contains("session changed") == true)
        precondition(PayStatusMessage.text(code: nil, outcomeUnknown: false) == nil)
    }
}
