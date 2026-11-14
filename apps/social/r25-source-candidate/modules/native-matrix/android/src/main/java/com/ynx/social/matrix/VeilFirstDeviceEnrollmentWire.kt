package com.ynx.social.matrix

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import okio.ByteString.Companion.decodeBase64
import okio.ByteString.Companion.toByteString

/** Public wire data, NOT a native signing authorization or an account/source lease. */
internal object VeilFirstDeviceEnrollmentWire {
    const val DEVICE_RECORDS_LIMIT = 393216
    // Base64url(393216) plus the bounded enrollment response, not the old
    // prepared-message-only cap. This does not increase any signature bound.
    const val COURIER_RECORD_LIMIT = 16384
    const val RESPONSE_LIMIT = 532480 + 21848
    private const val SAFE = 9007199254740991L
    private val challengeFields = setOf("operation", "nonce", "requestDigest", "issuedAtMs", "expiresMs")
    private val responseFields = setOf("revision", "state", "operation", "identity", "device", "deviceAuthorization")

    class Original private constructor(private val fields: Map<String, String>, private val pair: ByteArray,
        private val registration: VeilInitialRegistrationProposalData) {
        val operation: String get() = fields.getValue("operation")
        val expiresMs: Long get() = fields.getValue("expiresMs").toLong()
        fun requestBody(): ByteArray = json(fields)
        internal fun value(name: String): String = fields.getValue(name)
        internal fun publicPair(): ByteArray = pair.copyOf()
        internal fun initialRegistration(): VeilInitialRegistrationProposalData = registration
        override fun toString(): String = "FirstDeviceEnrollmentOriginal(redacted)"
        companion object {
            fun retained(request: VeilFirstDeviceChallengeWire.Request, challenge: VeilFirstDeviceChallengeWire.Challenge): Original {
                val r = flat(request.body().toString(Charsets.UTF_8), 8192)
                val c = flat(challenge.cancelBody().toString(Charsets.UTF_8), 8192)
                require(r.keys == setOf("operation", "proposal") && c.keys == challengeFields)
                val proposal = raw(r.getValue("proposal"), VeilInitialRegistrationProposalData.SIZE, VeilInitialRegistrationProposalData.SIZE)
                val registration = VeilInitialRegistrationProposalData.decode(proposal)
                val pair = registration.publicPair()
                require(c.getValue("operation") == r.getValue("operation"))
                require(c.getValue("operation") == "fd2-" + b64(registration.originalIds()))
                require(c.getValue("requestDigest") == b64(registration.proposalDigest()))
                require(raw(c.getValue("nonce"), 32, 32).any { it != 0.toByte() })
                val issued = decimal(c.getValue("issuedAtMs"))
                val expires = decimal(c.getValue("expiresMs"))
                require(expires > issued && expires - issued <= 120000)
                val all = linkedMapOf("operation" to c.getValue("operation"), "proposal" to r.getValue("proposal"))
                for (key in listOf("nonce", "requestDigest", "issuedAtMs", "expiresMs")) all[key] = c.getValue(key)
                return Original(all.toMap(), pair, registration)
            }
        }
    }

    class Prepared private constructor(
        internal val original: Original,
        val revision: Long,
        val identity: String,
        val device: String,
        private val issuer: ByteArray,
        private val target: ByteArray,
    ) {
        // Copies remain private CryptoEngine/public-message inputs; never exposed to JS.
        fun issuerMessageCopy(): ByteArray = issuer.copyOf()
        fun targetMessageCopy(): ByteArray = target.copyOf()
        fun sameRevision(other: Prepared): Boolean = original === other.original && revision == other.revision &&
            identity == other.identity && device == other.device && issuer.contentEquals(other.issuer) && target.contentEquals(other.target)
        override fun toString(): String = "FirstDevicePreparedUntrusted(redacted)"
        companion object {
            fun decode(text: String, original: Original): Prepared {
                val f = flat(text, RESPONSE_LIMIT)
                require(f.keys == responseFields + setOf("issuerMessage", "targetMessage"))
                require(f.getValue("state") == "prepared" && f.getValue("deviceAuthorization") == "REQUIRED")
                require(f.getValue("operation") == original.operation)
                val revision = decimal(f.getValue("revision"))
                val identity = ascii(f.getValue("identity"), 128)
                val device = ascii(f.getValue("device"), 128)
                val issuer = raw(f.getValue("issuerMessage"), 1, 65536)
                val target = raw(f.getValue("targetMessage"), 1, 65536)
                val a = signing(issuer, "authorization", "issuer")
                val b = signing(target, "possession", "target")
                require(a.contentEquals(b))
                validateTranscript(a, original, identity, device)
                return Prepared(original, revision, identity, device, issuer, target)
            }
        }
    }

    class Observation(val state: String, val revision: Long, private val records: ByteArray? = null,
        private var courierRecord: ByteArray? = null) {
        internal fun courierRecordCopy(): ByteArray? = courierRecord?.copyOf()
        internal fun eraseCourierRecord() { courierRecord?.fill(0); courierRecord = null }
        internal fun originalRecordsCopy(): ByteArray? = records?.copyOf()
        override fun toString() = "EnrollmentObservation[public,unverified]"
    }

    /** Canonical public transport only. JNI independently verifies the exact
     * original signed bytes against its own retained keys, current and floor. */
    internal fun deviceRecordBytes(encoded: String): ByteArray {
        val original = raw(encoded, 1, DEVICE_RECORDS_LIMIT)
        val record = JSONObject(original.toString(Charsets.UTF_8))
        val names = setOf("version", "finalOriginal", "currentOriginal", "currentPredecessors",
            "independentTerminalOriginal", "checkpointOriginal")
        require(record.keys().asSequence().toSet() == names && record.get("version") == 1)
        var decodedTotal = 0
        fun envelope(value: Any): String {
            require(value is String)
            val bytes = raw(value, 1, 65536)
            decodedTotal += bytes.size
            bytes.fill(0)
            require(decodedTotal <= DEVICE_RECORDS_LIMIT)
            return value
        }
        val final = envelope(record.get("finalOriginal"))
        val current = envelope(record.get("currentOriginal"))
        val prefix = record.get("currentPredecessors")
        require(prefix is JSONArray && prefix.length() <= 255)
        val predecessors = (0 until prefix.length()).map { envelope(prefix.get(it)) }
        val terminal = envelope(record.get("independentTerminalOriginal"))
        val checkpoint = envelope(record.get("checkpointOriginal"))
        // Only the outer wrapper is reconstructed for canonical equality.
        // Envelopes stay their exact base64url bytes, never parsed/remarshaled.
        val canonical = "{\"version\":1,\"finalOriginal\":\"$final\",\"currentOriginal\":\"$current\"," +
            "\"currentPredecessors\":[" + predecessors.joinToString(",") { "\"$it\"" } + "]," +
            "\"independentTerminalOriginal\":\"$terminal\",\"checkpointOriginal\":\"$checkpoint\"}"
        require(canonical.toByteArray(Charsets.UTF_8).contentEquals(original))
        return original
    }
    fun observation(text: String, original: Original, prepared: Prepared?): Observation {
        val f = flat(text, RESPONSE_LIMIT)
        if (f["state"] == "prepared") {
            val actual = Prepared.decode(text, original)
            require(prepared == null || prepared.sameRevision(actual))
            return Observation("prepared", actual.revision)
        }
        val hasRecords = "deviceRecords" in f
        val companions = f.keys.intersect(setOf("courierRecord", "courierState"))
        require(f.keys == (if (hasRecords) responseFields + "deviceRecords" else responseFields) + companions)
        require(companions.isEmpty() || (hasRecords && f["state"] == "committed"))
        require("courierState" !in f || (f["courierState"] == "unavailable" && "courierRecord" !in f))
        require(f.getValue("state") in setOf("committed", "canceled") && (!hasRecords || f["state"] == "committed"))
        require(f.getValue("deviceAuthorization") == "REQUIRED" && f.getValue("operation") == original.operation)
        val revision = decimal(f.getValue("revision"))
        ascii(f.getValue("identity"), 128); ascii(f.getValue("device"), 128)
        require(prepared != null && prepared.original === original && prepared.revision == revision &&
            prepared.identity == f.getValue("identity") && prepared.device == f.getValue("device"))
        return Observation(f.getValue("state"), revision, f["deviceRecords"]?.let(::deviceRecordBytes),
            f["courierRecord"]?.let { raw(it, 1, COURIER_RECORD_LIMIT) })
    }

    /** Composer only. These signatures are untrusted public data; this does not authorize signing. */
    fun finalizeBody(prepared: Prepared, issuerClassic: ByteArray, issuerPQ: ByteArray, targetClassic: ByteArray, targetPQ: ByteArray): ByteArray {
        require(issuerClassic.size == 64 && targetClassic.size == 64 && issuerPQ.size == 4627 && targetPQ.size == 4627)
        val f = flat(prepared.original.requestBody().toString(Charsets.UTF_8), 8192).toMutableMap()
        f["issuerClassic"] = b64(issuerClassic); f["issuerPQ"] = b64(issuerPQ)
        f["targetClassic"] = b64(targetClassic); f["targetPQ"] = b64(targetPQ)
        // No invented revision field: current server resolves its retained original revision.
        return json(f)
    }

    private fun signing(message: ByteArray, purpose: String, role: String): ByteArray {
        val f = frame(message, 4, 4)
        require(text(f[0]) == "YNX/SOCIAL/PQ-AUTH/SIGN/V1" && text(f[1]) == purpose && text(f[2]) == role)
        require(f[3].size in 1..49152)
        return f[3]
    }
    private fun validateTranscript(bytes: ByteArray, original: Original, identity: String, device: String) {
        val f = frame(bytes, 3, 16)
        require(text(f[0]) == "YNX-SOCIAL" && number(f[2]) == 2L && text(f[3]) == "enroll-initial-prekeys")
        ascii(text(f[1]), 128) // Realm syntax only; independent expected realm/source remains required.
        require(f[4].contentEquals(f[5]))
        val p = frame(f[4], 1, 12)
        require(text(p[0]) == identity && text(p[1]) == device)
        require(text(p[2]) == "LIBSIGNAL-0.104.0-XEDDSA-CANDIDATE" && text(p[4]) == "ML-DSA-87")
        val pair = original.publicPair()
        require(p[3].contentEquals(pair.copyOfRange(0, 33)) && p[5].contentEquals(pair.copyOfRange(33, 2625)))
        require(number(p[6]) == 1L && number(p[7]) == 1L)
        val previous = number(f[8]); val next = number(f[9])
        require(previous in 1 until SAFE && next == previous + 1 && number(p[8]) == next)
        require(f[6].size == 32 && f[7].size == 32 && !f[6].contentEquals(f[7]) && p[9].contentEquals(f[7]))
        require(f[10].contentEquals(raw(original.value("nonce"), 32, 32)) && f[13].contentEquals(f[10]))
        require(number(f[11]) == original.value("issuedAtMs").toLong() && number(f[12]) == original.expiresMs)
        val registration = original.initialRegistration()
        val bound = directoryFrame("YNX/SOCIAL/FIRST-DEVICE-INITIAL-PREKEYS-BINDING/V2",
            registration.originalIds(), registration.registrationBytes(), registration.deviceBytes(),
            registration.bundleDigest(), registration.proposalDigest())
        require(f[15].contentEquals(bound)) // must be covered by BOTH original issuer/target signatures
        ascii(text(p[11]), 256)
        val leaf = directoryFrame("YNX/SOCIAL/FIRST-LEAF/V2", p[0], p[1], p[3], p[5], p[6], p[7], p[11], bound)
        require(f[14].contentEquals(directoryFrame("YNX/SOCIAL/FIRST-ACTIVE-DEVICE/V2", leaf)))
        require(p[10].contentEquals(MessageDigest.getInstance("SHA-256").digest(directoryFrame("YNX/SOCIAL/FIRST-DEVICE-REFERENCE/V2", leaf))))
        // Matching self-held keys and these public frames is NOT source admission or first trust.
    }
    private fun frame(bytes: ByteArray, type: Int, count: Int): List<ByteArray> {
        require(bytes.size in 8..65536)
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
        require(b.int == 0x59504131 && (b.get().toInt() and 255) == type && b.get().toInt() == 1 && (b.short.toInt() and 65535) == count)
        val result = ArrayList<ByteArray>(count)
        repeat(count) { i ->
            require(b.remaining() >= 6 && (b.short.toInt() and 65535) == i + 1)
            val length = b.int
            require(length >= 0 && length <= b.remaining())
            result.add(ByteArray(length).also { b.get(it) })
        }
        require(!b.hasRemaining())
        return result
    }
    private fun directoryFrame(domain: String, vararg fields: ByteArray): ByteArray = ByteArrayOutputStream().run {
        write(domain.toByteArray(Charsets.US_ASCII)); write(0)
        for (f in fields) { write(ByteBuffer.allocate(4).putInt(f.size).array()); write(f) }
        toByteArray()
    }
    private fun number(b: ByteArray): Long { require(b.size == 8); return ByteBuffer.wrap(b).long.also { require(it in 0..SAFE) } }
    private fun text(b: ByteArray): String { require(b.all { it.toInt() in 33..126 }); return b.toString(Charsets.US_ASCII) }
    private fun ascii(s: String, max: Int): String { require(s.length in 1..max && s.all { it.code in 33..126 }); return s }
    private fun decimal(s: String): Long { require(s.matches(Regex("[1-9][0-9]{0,15}"))); return s.toLong().also { require(it <= SAFE) } }
    internal fun b64(b: ByteArray): String = b.toByteString().base64Url().trimEnd('=')
    internal fun raw(s: String, min: Int, max: Int): ByteArray {
        require(s.length <= (max * 4 + 2) / 3 && s.matches(Regex("[A-Za-z0-9_-]+")))
        val b = requireNotNull(s.decodeBase64()).toByteArray()
        require(b.size in min..max && b64(b) == s)
        return b
    }
    internal fun json(f: Map<String, String>): ByteArray = f.entries.joinToString(",", "{", "}") {
        "\"${it.key}\":\"${it.value}\""
    }.toByteArray(Charsets.UTF_8)

    // Exact flat JSON string map. All accepted values below have ASCII/rawurl bounds;
    // JSON escapes are decoded before duplicate-field and semantic validation.
    internal fun flat(s: String, limit: Int, numericOneKeys: Set<String> = emptySet()): Map<String, String> {
        require(s.length <= limit)
        var i = 0
        fun ws() { while (i < s.length && s[i] in " \t\r\n") i++ }
        fun take(c: Char) { ws(); require(i < s.length && s[i++] == c) }
        fun string(): String {
            take('"'); val out = StringBuilder()
            while (true) {
                require(i < s.length)
                val c = s[i++]
                if (c == '"') return out.toString()
                require(c.code >= 32)
                if (c != '\\') out.append(c) else {
                    require(i < s.length)
                    when (val e = s[i++]) {
                        '"', '\\', '/' -> out.append(e)
                        'b' -> out.append('\b'); 'f' -> out.append('\u000c'); 'n' -> out.append('\n'); 'r' -> out.append('\r'); 't' -> out.append('\t')
                        'u' -> { require(i + 4 <= s.length); val h = s.substring(i, i + 4); require(h.all { it in "0123456789abcdefABCDEF" }); out.append(h.toInt(16).toChar()); i += 4 }
                        else -> error("INVALID_PUBLIC_JSON")
                    }
                }
            }
        }
        val result = linkedMapOf<String, String>()
        take('{'); ws()
        if (i < s.length && s[i] != '}') while (true) {
            val key = string(); require(key !in result && result.size < 10); take(':'); ws()
            result[key] = if (key in numericOneKeys) {
                require(i < s.length && s[i++] == '1'); "1"
            } else string()
            ws()
            require(i < s.length)
            if (s[i] == '}') break
            take(',')
        }
        take('}'); ws(); require(i == s.length)
        return result
    }
}
