package com.ynx.social.matrix

/** Actual initial-storage public DATA; registration remains unadmitted. */
internal object VeilFirstDeviceStorageWire {
    const val RESPONSE_LIMIT = 16384
    class Association private constructor(val generation: String, private val bytes: ByteArray) {
        fun body(prepared: VeilFirstDeviceEnrollmentWire.Prepared, nonce: ByteArray): ByteArray {
            val f = VeilFirstDeviceEnrollmentWire.flat(
                VeilFirstDeviceSourceWire.currentBody(prepared, nonce).toString(Charsets.UTF_8), 8192).toMutableMap()
            f["storageGeneration"] = generation
            f["storageAssociation"] = VeilFirstDeviceEnrollmentWire.b64(bytes)
            return VeilFirstDeviceEnrollmentWire.json(f)
        }
        companion object {
            fun decode(raw: ByteArray): Association {
                require(raw.size == 4116 && raw.copyOfRange(0, 8).contentEquals("YNXCSB01".toByteArray(Charsets.US_ASCII)))
                val view = java.nio.ByteBuffer.wrap(raw).order(java.nio.ByteOrder.BIG_ENDIAN)
                val generation = view.getLong(8)
                require(generation > 0L)
                val length = view.getInt(16)
                require(length in 1..4096 && (20 + length until raw.size).all { raw[it] == 0.toByte() })
                return Association(java.lang.Long.toUnsignedString(generation), raw.copyOfRange(20, 20 + length))
            }
        }
    }
    class Registered private constructor(private val original: ByteArray) {
        // Retained opaque transport original, never parsed into authority.
        fun originalCopy() = original.copyOf()
        companion object {
            fun decode(text: String, prepared: VeilFirstDeviceEnrollmentWire.Prepared): Registered {
                val f = VeilFirstDeviceEnrollmentWire.flat(text, RESPONSE_LIMIT, setOf("version"))
                require(f.keys == setOf("version", "state", "operation", "recordOriginal", "keyEpoch", "registrationRevision"))
                require(f["version"] == "1" && f["state"] == "STORAGE_REGISTERED_UNADMITTED" && f["operation"] == prepared.original.operation)
                for (name in listOf("keyEpoch", "registrationRevision")) {
                    val value = f.getValue(name)
                    require(value.matches(Regex("[1-9][0-9]{0,19}")) && value.toULongOrNull() != null)
                }
                return Registered(VeilFirstDeviceEnrollmentWire.raw(f.getValue("recordOriginal"), 1, 12288))
            }
        }
    }
}
