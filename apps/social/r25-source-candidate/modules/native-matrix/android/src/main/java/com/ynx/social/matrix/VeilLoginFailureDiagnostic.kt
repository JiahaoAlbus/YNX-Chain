package com.ynx.social.matrix

/** A first-cause observation, not a retry capability or a remote outcome verdict. */
internal class VeilLoginFailureDiagnostic {
    enum class Operation { START, CALLBACK, REDEEM, ACCOUNT_OBSERVE, CANCEL, LOGIN_WORKER }
    private var first: Map<String, Any>? = null
    @Synchronized fun refused(value: VeilSocialLoginClient.Outcome.Refused, operation: Operation) {
        if (first == null) first = mapOf("state" to "CLIENT_REFUSED", "operation" to operation.name,
            "reason" to value.reason.name, "httpStatus" to value.httpStatus,
            "remoteOutcomeUnknown" to value.remoteOutcomeUnknown, "exception" to "NONE")
    }
    @Synchronized fun exception(value: Exception) {
        if (first != null) return
        val kind = when (value) {
            is javax.net.ssl.SSLException -> "TLS_EXCEPTION"
            is java.io.InterruptedIOException, is java.util.concurrent.TimeoutException -> "TIMEOUT_EXCEPTION"
            is java.io.IOException -> "IO_EXCEPTION"
            is java.util.concurrent.RejectedExecutionException -> "EXECUTOR_REJECTED"
            is SecurityException -> "SECURITY_EXCEPTION"
            is IllegalArgumentException -> "ARGUMENT_EXCEPTION"
            is IllegalStateException -> "STATE_EXCEPTION"
            else -> "OTHER_EXCEPTION"
        }
        first = mapOf("state" to "EXCEPTION", "operation" to "LOGIN_WORKER", "reason" to "NONE",
            "httpStatus" to 0, "remoteOutcomeUnknown" to true, "exception" to kind)
    }
    @Synchronized fun snapshot(): Map<String, Any> = first ?: notRecorded()
    companion object { fun notRecorded(): Map<String, Any> = mapOf("state" to "NOT_RECORDED",
        "operation" to "NONE", "reason" to "NONE", "httpStatus" to 0,
        "remoteOutcomeUnknown" to false, "exception" to "NONE") }
}
