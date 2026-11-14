package com.ynx.social.matrix

/** Public transport only. Selection and 72 are NOT native admission. */
internal object VeilFirstDeviceSourceWire {
    const val RESPONSE_LIMIT = 526336
    class Selection private constructor(private val scope: ByteArray, private val head: ByteArray, private val catalog: ByteArray) {
        fun scopeCopy() = scope.copyOf()
        fun headCopy() = head.copyOf()
        fun catalogCopy() = catalog.copyOf()
        companion object {
            fun decode(text: String): Selection {
                val f = VeilFirstDeviceEnrollmentWire.flat(text, 8192)
                require(f.keys == setOf("state", "deviceAuthorization", "scope", "head", "catalog"))
                require(f["state"] == "UNTRUSTED_SOURCE_SELECTION" && f["deviceAuthorization"] == "REQUIRED")
                fun hex(name: String): ByteArray = f.getValue(name).also {
                    require(it.matches(Regex("[0-9a-f]{64}")))
                }.toByteArray(Charsets.US_ASCII)
                return Selection(VeilFirstDeviceEnrollmentWire.raw(f.getValue("scope"), 1, 4096), hex("head"), hex("catalog"))
            }
        }
    }
    class Start(val status: Int, nonce: ByteArray?) {
        private val originalNonce = nonce?.copyOf()
        init { require((status == 71) == (originalNonce != null)); require(originalNonce == null || originalNonce.size == 32) }
        fun nonceCopy(): ByteArray { check(status == 71); return checkNotNull(originalNonce).copyOf() }
    }
    fun currentBody(prepared: VeilFirstDeviceEnrollmentWire.Prepared, nonce: ByteArray): ByteArray {
        require(nonce.size == 32)
        val f = VeilFirstDeviceEnrollmentWire.flat(prepared.original.requestBody().toString(Charsets.UTF_8), 8192).toMutableMap()
        f["revision"] = prepared.revision.toString()
        f["sourceNonce"] = VeilFirstDeviceEnrollmentWire.b64(nonce)
        return VeilFirstDeviceEnrollmentWire.json(f)
    }
    fun evidence(text: String, prepared: VeilFirstDeviceEnrollmentWire.Prepared): ByteArray {
        val f = VeilFirstDeviceEnrollmentWire.flat(text, RESPONSE_LIMIT)
        require(f.keys == setOf("state", "deviceAuthorization", "operation", "revision", "sourceEvidence"))
        require(f["state"] == "SOURCE_EVIDENCE_UNADMITTED" && f["deviceAuthorization"] == "REQUIRED")
        require(f["operation"] == prepared.original.operation && f["revision"] == prepared.revision.toString())
        return VeilFirstDeviceEnrollmentWire.raw(f.getValue("sourceEvidence"), 1, 393216)
    }
    fun status(code: Int): String = when (code) {
        72 -> "SOURCE_EVIDENCE_UNADMITTED"
        73 -> "SOURCE_PROFILE_REQUIRED"
        74 -> "SOURCE_CHECK_REJECTED"
        75 -> "SOURCE_CHECK_CANCELED_RETAINED"
        else -> "SOURCE_UNKNOWN_RETAINED"
    }
}
