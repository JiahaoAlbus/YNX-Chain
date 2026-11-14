// Presentation only: never changes approval, holder, or original operation.
enum PayStatusMessage {
    static func text(code: String?, outcomeUnknown: Bool) -> String? {
        switch code {
        case "NATIVE_PAY_NORMAL_MAIN_SOURCE_NOT_SUPPLIED", "NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE":
            return "Pay connection unavailable. Open YNX Wallet and use Pay there."
        case "NATIVE_PAY_AUTHORITY_UNAVAILABLE", "PAY_ORIGINAL_BUSINESS_SOURCE_COMMISSIONING_NOT_SUPPLIED":
            return "Pay service authorization is unavailable. Check the original order again when it is restored."
        case "NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED", "NATIVE_INVOICE_ORIGINAL_RECONCILE_REQUIRED":
            return "The original payment or refund needs verification. Read the same invoice before requesting another review."
        case "NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE", "NATIVE_PAY_PRODUCT_CURRENT_RESULT":
            return "Wallet session changed. Reconnect and read the original invoice again."
        default:
            if outcomeUnknown { return "Payment or refund is awaiting verification. Check the original invoice before requesting another review." }
            return code
        }
    }
}
