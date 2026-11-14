package com.ynx.social.matrix

/** Process-local observations only. Complete means checks ran, never account admission. */
internal class VeilReturnLinkDiagnostic {
    enum class Check {
        ACTIVITY_USABLE, SDK_SUPPORTED, PACKAGE_MATCH, APPROVED_PINS_PRESENT,
        APPROVED_PINS_VALID, SIGNERS_PRESENT, SIGNERS_MATCH, CALLBACK_ACTIVITY_ENABLED,
        DOMAIN_MANAGER_PRESENT, DOMAIN_STATE_PRESENT, DOMAIN_VERIFIED, EXACT_RESOLVER
    }
    private data class Failure(val check: Check, val outcome: String)
    private val gate = Any()
    private var first: Failure? = null
    private val passed = java.util.EnumSet.noneOf(Check::class.java)
    private var started = false
    private var complete = false
    fun require(check: Check, predicate: () -> Boolean): Boolean {
        synchronized(gate) { started = true }
        val outcome = try { if (predicate()) "PASSED" else "RETURNED_FALSE" }
            catch (_: Exception) { "THREW_EXCEPTION" }
        synchronized(gate) {
            if (first == null) {
                if (outcome == "PASSED") passed.add(check) else first = Failure(check, outcome)
            }
        }
        return outcome == "PASSED"
    }
    // Called only after reserve's complete verification expression returned true.
    // Missing/duplicate checks cannot manufacture a completed observation.
    fun completed() = synchronized(gate) {
        if (first == null && passed.size == Check.entries.size) complete = true
    }
    fun snapshot(): Map<String, Any> = synchronized(gate) {
        val failure = first
        mapOf("state" to when { failure != null -> "REJECTED"; complete -> "PASSED"; started -> "CHECKING"; else -> "NOT_STARTED" },
            "check" to (failure?.check?.name ?: if (complete) "ALL_CHECKS" else "NOT_CHECKED"),
            "outcome" to (failure?.outcome ?: if (complete) "PASSED" else "NOT_CHECKED"),
            "completedChecks" to passed.size, "totalChecks" to Check.entries.size)
    }
    companion object { fun notChecked(): Map<String, Any> = VeilReturnLinkDiagnostic().snapshot() }
}
