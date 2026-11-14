package com.ynx.social.matrix

import okio.ByteString.Companion.decodeBase64
import okio.ByteString.Companion.toByteString
import java.security.MessageDigest

/** Public application intent only, NOT YPA1, a signature, or source admission.
 * The wire codec cannot create the Owner's live FirstDeviceIntent capability. */
internal object VeilFirstDeviceChallengeWire {
    class Request private constructor(val operation: String, private val proposal: String, val digest: String) {
        fun body(): ByteArray = "{\"operation\":\"$operation\",\"proposal\":\"$proposal\"}".toByteArray(Charsets.UTF_8)
        override fun toString() = "FirstDeviceRequest[private public intent]"
        companion object {
            fun fromProjection(bytes: ByteArray): Request {
                val data = VeilInitialRegistrationProposalData.decode(bytes)
                val ids = data.originalIds(); val encoded = data.encodedCopy(); val digest = data.proposalDigest()
                return try {
                    Request("fd2-" + raw(ids), raw(encoded), raw(digest))
                } finally { ids.fill(0); encoded.fill(0); digest.fill(0) }
            }
        }
    }
    class Challenge private constructor(private val fields: Map<String, String>) {
        // Original validated strings, never expiry-derived or re-generated.
        fun cancelBody(): ByteArray = fields.entries.joinToString(",", "{", "}") { (k, v) -> "\"$k\":\"$v\"" }.toByteArray(Charsets.UTF_8)
        override fun toString() = "FirstDeviceChallenge[retained]"
        companion object {
            fun decode(text: String, original: Request): Challenge {
                val root = parse(text)
                require(root.keys == setOf("state", "deviceAuthorization", "challenge"))
                require(root["state"] == "CHALLENGE_ISSUED" && root["deviceAuthorization"] == "REQUIRED")
                val nested = root["challenge"] as? Map<*, *> ?: error("CHALLENGE_SHAPE")
                val names = listOf("operation", "nonce", "requestDigest", "issuedAtMs", "expiresMs")
                require(nested.keys == names.toSet())
                val fields = names.associateWith { nested[it] as? String ?: error("CHALLENGE_STRING_REQUIRED") }
                require(fields.getValue("operation") == original.operation)
                val nonce = public32(fields.getValue("nonce"))
                require(nonce.any { it != 0.toByte() })
                public32(fields.getValue("requestDigest"))
                require(fields.getValue("requestDigest") == original.digest)
                val issued = decimal(fields.getValue("issuedAtMs"))
                val expires = decimal(fields.getValue("expiresMs"))
                require(expires > issued && expires - issued <= 120000L)
                return Challenge(fields)
            }
        }
    }
    fun decodeCancel(text: String) {
        val root = parse(text)
        require(root.keys == setOf("state", "deviceAuthorization"))
        require(root["state"] == "CHALLENGE_CANCELED" && root["deviceAuthorization"] == "REQUIRED")
    }
    private fun raw(bytes: ByteArray) = bytes.toByteString().base64Url().trimEnd('=')
    private fun public32(text: String): ByteArray {
        require(Regex("[A-Za-z0-9_-]{43}").matches(text))
        val decoded = text.decodeBase64()?.toByteArray() ?: error("BASE64_REQUIRED")
        require(decoded.size == 32 && raw(decoded) == text)
        return decoded
    }
    private fun decimal(text: String): Long {
        require(Regex("[1-9][0-9]{0,15}").matches(text))
        val n = text.toLong()
        require(n <= 9007199254740991L && n.toString() == text)
        return n
    }
    /** Bounded object/string grammar. Duplicate decoded keys and unknown fields
     * are rejected, not erased by a permissive JSONObject implementation. */
    private fun parse(text: String): Map<String, Any> {
        require(text.length <= 8192)
        var at = 0
        fun ws() { while (at < text.length && text[at] in " \t\r\n") at++ }
        fun string(): String {
            require(at < text.length && text[at++] == '"')
            val out = StringBuilder()
            var ended = false
            while (at < text.length) {
                val c = text[at++]
                if (c == '"') { ended = true; break }
                require(c >= ' ')
                if (c != '\\') out.append(c) else {
                    require(at < text.length)
                    when (val escaped = text[at++]) {
                        '"', '\\', '/' -> out.append(escaped)
                        'b' -> out.append('\b'); 'f' -> out.append('\u000c')
                        'n' -> out.append('\n'); 'r' -> out.append('\r'); 't' -> out.append('\t')
                        'u' -> {
                            require(at + 4 <= text.length)
                            val hex = text.substring(at, at + 4)
                            require(hex.all { it in "0123456789abcdefABCDEF" })
                            out.append(hex.toInt(16).toChar()); at += 4
                        }
                        else -> error("JSON_ESCAPE")
                    }
                }
            }
            require(ended)
            var i = 0
            while (i < out.length) {
                val c = out[i++]
                if (Character.isHighSurrogate(c)) require(i < out.length && Character.isLowSurrogate(out[i++]))
                else require(!Character.isLowSurrogate(c))
            }
            return out.toString()
        }
        fun obj(depth: Int): Map<String, Any> {
            require(depth <= 1 && at < text.length && text[at++] == '{')
            val values = linkedMapOf<String, Any>()
            while (true) {
                ws(); val key = string(); ws()
                require(key !in values && at < text.length && text[at++] == ':')
                ws(); require(at < text.length)
                values[key] = if (text[at] == '{') obj(depth + 1) else string()
                require(values.size <= 5)
                ws(); require(at < text.length)
                when (text[at++]) { '}' -> return values; ',' -> Unit; else -> error("JSON_SEPARATOR") }
            }
        }
        ws(); val result = obj(0); ws(); require(at == text.length)
        return result
    }
}
