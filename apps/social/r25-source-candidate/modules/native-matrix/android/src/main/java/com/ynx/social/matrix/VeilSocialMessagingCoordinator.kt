package com.ynx.social.matrix

import java.util.Collections
import org.json.JSONObject
import org.json.JSONTokener

/** Normal UI dispatch on the original native worker, not an authority supplier.
 * Business must own and revalidate actual device/contact/session/store authority.
 * No Business is fabricated from inventory, login status or public observations.
 * Authorized plaintext views can reach UI; keys and ratchets cannot.
 */
internal class VeilSocialMessagingCoordinator {
    internal interface Business {
        fun read(context: Map<String, Any?>): Map<String, Any?>
        fun execute(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?>
        /** Revalidate the owning source/device only; never repeat business I/O. */
        fun requireDeliveryCurrent()
        fun hasRetainedWork(): Boolean
        fun hasWorkBlockingOwnerClose(): Boolean = hasRetainedWork()
    }
    internal class Request private constructor(
        val context: Map<String, Any?>, val command: Map<String, Any?>?
    ) {
        val callId: Long get() = (context.getValue("callId") as Number).toLong()
        val isRead: Boolean get() = command == null
        fun same(other: Request) = context == other.context && command == other.command
        companion object {
            fun decode(contextJson: String, commandJson: String? = null): Request {
                val context = originalContext(contextJson)
                val command = commandJson?.let { flat(it, 70000) }
                if (command == null) require(context["action"] == "readSnapshot")
                else {
                    val action = command["type"] as? String ?: error("VEIL_PRODUCT_COMMAND_INVALID")
                    val fields = commandFields[action] ?: error("VEIL_PRODUCT_COMMAND_INVALID")
                    require(command.keys == fields && context["action"] == action)
                    reference(context["accountViewRef"]); reference(context["viewRevision"])
                    if (action != "reviewRecovery") {
                        reference(command["viewRevision"])
                        require(command["viewRevision"] == context["viewRevision"])
                    }
                    for ((key, value) in command) when (key) {
                        "type", "viewRevision" -> Unit
                        "body" -> bounded(value, if (action == "publishMoment") 5000 else 16000, empty = action == "saveDraft")
                        "query" -> { bounded(value, 256); require(value == (value as String).trim() && value.none { Character.isISOControl(it) }) }
                        "beforeMessageId" -> if (value != null) reference(value)
                        "draftRevision" -> { require(value is String && value.matches(Regex("0|[1-9][0-9]{0,15}")) && value.toLong() <= 9007199254740990L) }
                        "caption" -> bounded(value, 16000, empty = true)
                        "identifier" -> { bounded(value, 512); require(!(value as String).any { it == '\r' || it == '\n' || it == '\t' }) }
                        "peerAccountId" -> require(value is String && value.length in 1..256 && value.all { it.code in 33..126 })
                        "preference" -> require(value == "off" || value == "on")
                        "replyToMessageId" -> if (value != null) reference(value)
                        else -> reference(value)
                    }
                }
                return Request(context, command)
            }
            /** Internal Source capture validation only. This does not add an
             * algorithm/init action to normal UI decode or grant any authority. */
            fun decodeSourceOriginal(contextJson: String, commandJson: String): Request {
                val command = flat(commandJson, 70000)
                if (command["type"] != "establishSession") return decode(contextJson, commandJson)
                val context = originalContext(contextJson)
                require(command.keys == setOf("type", "viewRevision", "conversationId") &&
                    context["action"] == "establishSession")
                reference(context["accountViewRef"]); reference(context["viewRevision"])
                reference(command["viewRevision"]); reference(command["conversationId"])
                require(command["viewRevision"] == context["viewRevision"])
                return Request(context, command)
            }
            private fun originalContext(contextJson: String): Map<String, Any?> {
                val context = flat(contextJson, 2048)
                require(context.keys == setOf("callId", "epoch", "action", "accountViewRef", "viewRevision"))
                for (field in listOf("callId", "epoch")) {
                    val value = context[field]
                    require(value is Number && value.toDouble().isFinite() &&
                        value.toDouble() == value.toLong().toDouble() && value.toLong() in 1..9007199254740991L)
                }
                for (field in listOf("accountViewRef", "viewRevision"))
                    if (context[field] != null) reference(context[field])
                return context
            }
            private fun flat(json: String, limit: Int): Map<String, Any?> {
                require(json.length in 2..limit)
                val parser = JSONTokener(json)
                require(parser.nextClean() == '{')
                val result = linkedMapOf<String, Any?>()
                if (parser.nextClean() == '}') {
                    require(parser.nextClean() == '\u0000')
                    return Collections.unmodifiableMap(result)
                }
                parser.back()
                while (true) {
                    require(parser.nextClean() == '"')
                    val key = parser.nextString('"')
                    require(key.length in 1..64 && !result.containsKey(key) && result.size < 16)
                    require(parser.nextClean() == ':')
                    val leading = parser.nextClean()
                    require(leading == '"' || leading == 'n' || leading == '-' || leading in '0'..'9')
                    parser.back()
                    val value = parser.nextValue()
                    require(value === JSONObject.NULL || value is String || value is Number)
                    if (value is String) require(leading == '"')
                    result[key] = if (value === JSONObject.NULL) null else value
                    when (parser.nextClean()) {
                        '}' -> break
                        ',' -> Unit
                        else -> error("VEIL_PRODUCT_JSON_INVALID")
                    }
                }
                require(parser.nextClean() == '\u0000')
                return Collections.unmodifiableMap(result)
            }
            private fun bounded(value: Any?, limit: Int, empty: Boolean = false) {
                require(value is String && value.length <= limit && (empty || value.isNotBlank()) &&
                    value.none { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127 })
                var index = 0
                while (index < value.length) {
                    val c = value[index++]
                    if (c.isHighSurrogate()) require(index < value.length && value[index++].isLowSurrogate())
                    else require(!c.isLowSurrogate())
                }
            }
            private fun reference(value: Any?) {
                bounded(value, 256)
                require(!(value as String).any { it == '\r' || it == '\n' || it == '\t' })
            }
            private val commandFields = mapOf(
                "viewStoredMessage" to setOf("type", "viewRevision", "conversationId", "messageId"),
                "searchLocalMessages" to setOf("type", "viewRevision", "query", "beforeMessageId"),
                "loadDraft" to setOf("type", "viewRevision", "conversationId"),
                "saveDraft" to setOf("type", "viewRevision", "conversationId", "draftRevision", "body", "replyToMessageId"),
                "openConversation" to setOf("type", "viewRevision", "conversationId"),
                "markConversationRead" to setOf("type", "viewRevision", "conversationId", "throughMessageId"),
                "sendMessage" to setOf("type", "viewRevision", "conversationId", "body", "replyToMessageId"),
                "selectAttachment" to setOf("type", "viewRevision", "conversationId"),
                "sendAttachment" to setOf("type", "viewRevision", "conversationId", "selectionReference", "caption"),
                "openAttachment" to setOf("type", "viewRevision", "conversationId", "messageId", "attachmentReference"),
                "requestContact" to setOf("type", "viewRevision", "identifier"),
                "acceptContact" to setOf("type", "viewRevision", "requestId"),
                "rejectContact" to setOf("type", "viewRevision", "requestId"),
                "blockContact" to setOf("type", "viewRevision", "peerAccountId"),
                "unblockContact" to setOf("type", "viewRevision", "peerAccountId"),
                "publishMoment" to setOf("type", "viewRevision", "body", "audienceId"),
                "reviewDevice" to setOf("type", "viewRevision", "deviceId"),
                "setLocalAi" to setOf("type", "viewRevision", "preference"),
                "reviewRecovery" to setOf("type", "originalOperationRef")
            )
        }
    }
    private val worker = Thread.currentThread()
    private var business: Business? = null
    private var original: Request? = null
    private var reply: Map<String, Any?>? = null
    private var firstFailure: Throwable? = null
    private fun checked() = check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
    /** Internal original-owner handoff, never an Expo installer or DTO factory. */
    fun attach(originalBusiness: Business) {
        checked()
        check(firstFailure == null && (business == null || business === originalBusiness))
        business = originalBusiness
    }
    fun process(request: Request, preflight: () -> String? = { null }): Map<String, Any?> {
        checked()
        firstFailure?.let { throw it }
        original?.let {
            if (it.same(request)) {
                try {
                    business?.requireDeliveryCurrent()
                    return checkNotNull(reply)
                } catch (failure: Throwable) {
                    // Keep the original request/result and exact first refusal.
                    // A later retry must not revive its former delivery grant.
                    firstFailure = failure
                    throw failure
                }
            }
            require(request.callId > it.callId) { "VEIL_PRODUCT_ORIGINAL_RETAINED" }
        }
        original = request
        reply = null
        try {
            val blocked = preflight()
            val selected = business
            val value = if (request.isRead) {
                (if (blocked == null) selected?.read(request.context) else null) ?: mapOf(
                    "kind" to "UNAVAILABLE", "gaps" to listOf("AUTHORIZED_PRODUCT_PROJECTION_UNAVAILABLE"))
            } else {
                (if (blocked == null) selected?.execute(checkNotNull(request.command), request.context) else null)
                    ?: mapOf("kind" to "error", "code" to (blocked ?: "UNAVAILABLE"))
            }
            val owned = publicRecord(value)
            return Collections.unmodifiableMap(linkedMapOf<String, Any?>(
                "context" to request.context,
                (if (request.isRead) "snapshot" else "result") to owned
            )).also { reply = it }
        } catch (failure: Throwable) {
            firstFailure = failure
            throw failure
        }
    }
    internal fun usesBusinessForOwnerClose(expected: Business): Boolean { checked(); return business === expected }
    internal fun hasAttachedBusinessForOwnerClose(): Boolean { checked(); return business != null }
    internal fun hasWorkBlockingOwnerClose(): Boolean {
        checked()
        val selected = business ?: return firstFailure != null
        // Keep the exact request/reply/failure for observations. This method
        // does not make a failed delivery current or clear replay fences.
        return selected.hasWorkBlockingOwnerClose()
    }
    fun hasRetainedWork(): Boolean {
        checked()
        if (firstFailure != null) return true
        return try { business?.hasRetainedWork() == true }
        catch (failure: Throwable) { firstFailure = failure; true }
    }
    companion object {
        /** JSON representation for normal request/persistence/interchange.
         * JSONObject(Map) drops null-valued entries in supported org.json
         * runtimes. Keep native Maps nullable for Expo (never put NULL objects
         * in its return value), and insert the sentinel only in JSON trees. */
        internal fun json(value: Map<String, Any?>): String = jsonObject(value).toString()
        internal fun jsonObject(value: Map<String, Any?>): JSONObject {
            var nodes = 0
            var text = 0
            fun encode(item: Any?, depth: Int): Any {
                require(depth <= 10 && ++nodes <= 20000)
                return when (item) {
                    null -> JSONObject.NULL
                    is String -> { text += item.length; require(text <= 1048576); item }
                    is Boolean -> item
                    is Number -> {
                        require(item.toDouble().isFinite() && item.toDouble() == item.toLong().toDouble() &&
                            item.toLong() in -9007199254740991L..9007199254740991L)
                        item
                    }
                    is List<*> -> {
                        require(item.size <= 500)
                        org.json.JSONArray().apply { item.forEach { put(encode(it, depth + 1)) } }
                    }
                    is Map<*, *> -> {
                        require(item.size <= 32 && item.keys.all { it is String })
                        JSONObject().apply { item.forEach { (key, child) -> put(key as String, encode(child, depth + 1)) } }
                    }
                    else -> error("VEIL_PRODUCT_JSON_TYPE_INVALID")
                }
            }
            return encode(value, 0) as JSONObject
        }
        private val publicKeys = setOf(
            "kind", "gaps", "accountViewRef", "viewRevision", "profile", "displayName", "publicIdentifier",
            "conversations", "messages", "activeConversationId", "contacts", "contactRequests", "blockedContacts", "peerAccountId", "moments",
            "devices", "audiences", "recoveries", "actions", "localAi", "id", "title", "preview",
            "unreadCount", "conversationId", "senderLabel", "body", "direction", "submission", "delivery",
            "attachments", "reference", "name", "authorLabel", "audienceLabel", "label", "state", "items",
            "originalOperationRef", "completion", "disposition", "selectionReference", "resolution",
            "nextStep", "eventObservation", "draftRevision", "code", "field", "snapshot", "replyToMessageId",
            "query", "matches", "messageId", "excerpt", "nextBeforeMessageId",
            "messageWindow", "mode", "anchorMessageId", "hasEarlier"
        )
        private fun publicRecord(raw: Map<String, Any?>): Map<String, Any?> {
            if (raw.containsKey("eventObservation")) require(raw["kind"] == "originalReview" &&
                raw["eventObservation"] == "present" && raw["resolution"] == "unresolved" &&
                raw["nextStep"] == "review-only") { "VEIL_PRODUCT_EVENT_OBSERVATION_NOT_AUTHORITY" }
            var textSize = 0
            var nodes = 0
            fun copy(value: Any?, depth: Int): Any? {
                require(depth <= 10 && ++nodes <= 20000)
                return when (value) {
                    null, is Boolean -> value
                    is Number -> {
                        require(value.toDouble().isFinite() && value.toDouble() == value.toLong().toDouble() &&
                            value.toLong() in -9007199254740991L..9007199254740991L)
                        value
                    }
                    is String -> { textSize += value.length; require(textSize <= 1048576); value }
                    is List<*> -> {
                        require(value.size <= 500)
                        Collections.unmodifiableList(value.map { copy(it, depth + 1) })
                    }
                    is Map<*, *> -> {
                        require(value.size <= 32 && value.keys.all { it is String && it in publicKeys })
                        val out = linkedMapOf<String, Any?>()
                        value.forEach { (key, item) -> out[key as String] = copy(item, depth + 1) }
                        Collections.unmodifiableMap(out)
                    }
                    else -> error("VEIL_PRODUCT_NON_PUBLIC_OUTPUT")
                }
            }
            val result = copy(raw, 0) as Map<*, *>
            return Collections.unmodifiableMap(result.entries.associate { (key, value) -> key as String to value })
        }
    }
}
