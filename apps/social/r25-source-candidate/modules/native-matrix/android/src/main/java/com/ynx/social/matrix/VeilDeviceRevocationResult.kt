package com.ynx.social.matrix

import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Read-only F06 HTTP DATA consumption. Neither a Source grant nor a signer.
 * The original Native operation supplies all expected values. This class has
 * no network, key, persistence, resend, device-state, or JNI mutation API.
 */
internal object VeilDeviceRevocationResult {
    private val u64Max = BigInteger("18446744073709551615")
    private val hex = Regex("[0-9a-f]{64}")
    private fun u64(value: String): BigInteger {
        require(value.matches(Regex("0|[1-9][0-9]{0,19}")))
        return value.toBigInteger().also { require(it <= u64Max) }
    }
    /** Public correlation only, constructed from an already retained original.
     * Never accepts arbitrary signing bytes or supplies management authority. */
    class Original(
        val operation: String, val device: String, val nextEpoch: String,
        val directoryEpoch: String, val bodySHA256: String,
    ) {
        init {
            require(hex.matches(operation) && hex.matches(bodySHA256))
            require(device.length in 1..128 && device.all { it.code in 33..126 })
            require(nextEpoch == "2") // frozen first-directory epoch 1 -> revoked 2
            val directory = u64(directoryEpoch)
            require(directory >= BigInteger.ONE && directory < u64Max)
        }
    }
    enum class State {
        REVOKED_RECORDED, UNKNOWN_RETAIN_ORIGINAL, ORIGINAL_QUERY_REQUIRED,
        BLOCKED_AUTH, STALE, ORIGINAL_NOT_OBSERVED, INVALID, POST_REQUIRED, REQUEST_STOPPED,
    }
    sealed class Result(val state: State, val original: Original) {
        // Directory evidence does not establish Native/session/Matrix delivery
        // revocation. No public response permits a replacement mutation.
        val deliveryState: String get() = "NOT_CONFIRMED"
        val mayResubmit: Boolean get() = false
        val authorityGranted: Boolean get() = false
        class Recorded(original: Original, val directoryEpoch: String) : Result(State.REVOKED_RECORDED, original)
        class Refused(state: State, original: Original, val operationObserved: Boolean) : Result(state, original)
    }
    enum class Route { REVOKE, QUERY_ORIGINAL }
    /** Same-original query may only observe, never re-sign/append/re-authorize.
     * The caller must still run the normal Native/source current fences. */
    fun decode(status: Int, bytes: ByteArray, original: Original, route: Route): Result {
        require(bytes.size in 1..8192)
        val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        // Reuse the normal enrollment strict string-map grammar: duplicate
        // decoded keys, non-string values and trailing data cannot be erased.
        val values = VeilFirstDeviceEnrollmentWire.flat(text, 8192)
        val state = State.entries.singleOrNull { it.name == values["state"] }
            ?: error("VEIL_DEVICE_REVOCATION_RESPONSE_INVALID")
        if (state == State.REVOKED_RECORDED) {
            require(status == 200)
            require(values.keys == setOf("state", "operation", "device", "epoch", "directoryEpoch", "bodySHA256", "deliveryState"))
            require(values["operation"] == original.operation && values["device"] == original.device)
            require(values["epoch"] == original.nextEpoch && values["bodySHA256"] == original.bodySHA256)
            require(values["deliveryState"] == "NOT_CONFIRMED")
            val directory = requireNotNull(values["directoryEpoch"])
            val expected = u64(original.directoryEpoch) + BigInteger.ONE
            if (route == Route.QUERY_ORIGINAL) require(u64(directory) == expected)
            else require(u64(directory) >= expected)
            return Result.Recorded(original, directory)
        }
        require(values.keys == setOf("state") || values.keys == setOf("state", "operation"))
        val observed = values.containsKey("operation")
        if (observed) require(values["operation"] == original.operation)
        val expectedStatus = when (state) {
            State.UNKNOWN_RETAIN_ORIGINAL -> setOf(503)
            State.ORIGINAL_QUERY_REQUIRED, State.STALE -> setOf(409)
            State.BLOCKED_AUTH -> setOf(403, 503)
            State.ORIGINAL_NOT_OBSERVED -> setOf(403)
            State.INVALID -> setOf(400)
            State.POST_REQUIRED -> setOf(405)
            State.REQUEST_STOPPED -> setOf(408)
            State.REVOKED_RECORDED -> error("UNREACHABLE")
        }
        require(status in expectedStatus)
        require(state != State.ORIGINAL_NOT_OBSERVED || route == Route.QUERY_ORIGINAL)
        return Result.Refused(state, original, observed)
    }
}

/** UI text only, independent of the user's visual design. Never an action. */
internal object VeilDeviceRevocationPresentation {
    data class Text(val title: String, val detail: String)
    fun describe(result: VeilDeviceRevocationResult.Result, locale: String): Text {
        require(locale in setOf("en", "zh", "zh-Hant"))
        val category = if (result is VeilDeviceRevocationResult.Result.Refused && !result.operationObserved) "UNBOUND" else result.state.name
        val pair = when (category) {
            "REVOKED_RECORDED" -> arrayOf(
                "Revocation recorded in the device directory", "Message sessions and relay delivery are not confirmed revoked. Keep the original operation; this receipt does not establish complete device access removal.",
                "撤销已记入设备目录", "消息会话和中继传播尚未确认撤销。请保留原操作，不能仅凭此记录认定设备访问已全部撤销。",
                "撤銷已記入裝置目錄", "訊息工作階段和中繼傳播尚未確認撤銷。請保留原操作，不能僅憑此記錄認定裝置存取已全部撤銷。")
            "UNKNOWN_RETAIN_ORIGINAL", "ORIGINAL_QUERY_REQUIRED" -> arrayOf(
                "Original operation needs a check", "Keep the original operation and check its original result. It will not be signed or submitted again.",
                "原操作需要核对", "请保留原操作并检查原结果。不会重新签名或再次提交。",
                "原操作需要核對", "請保留原操作並檢查原結果。不會重新簽名或再次提交。")
            "BLOCKED_AUTH" -> arrayOf(
                "Device management authorization is unavailable", "The original record is retained. This response does not authorize device management or a replacement request.",
                "设备管理授权暂不可用", "原操作记录会保留。此结果不会授予设备管理权限，也不会触发替换请求。",
                "裝置管理授權暫不可用", "原操作記錄會保留。此結果不會授予裝置管理權限，也不會觸發替換請求。")
            "STALE" -> arrayOf(
                "Device state has changed", "Keep the original operation. Read the current device state and check the original result before continuing.",
                "设备状态已变化", "请保留原操作，读取当前设备状态并检查原结果后再继续。",
                "裝置狀態已變化", "請保留原操作，讀取目前裝置狀態並檢查原結果後再繼續。")
            "ORIGINAL_NOT_OBSERVED" -> arrayOf(
                "Original operation has not been observed", "This does not prove the operation never happened. The original is retained and will not be resubmitted.",
                "尚未观察到原操作", "这不能证明原操作未发生。原记录会保留，不会再次提交。",
                "尚未觀察到原操作", "這不能證明原操作未發生。原記錄會保留，不會再次提交。")
            else -> arrayOf(
                "Original outcome is not confirmed", "Keep the original record. A rejected, stopped or unassociated response does not permit signing, resubmitting or clearing the original operation.",
                "原操作结果尚未确认", "原记录会保留。请求被拒绝、停止或结果未关联到原操作，都不会允许重新签名、提交或清除原记录。",
                "原操作結果尚未確認", "原記錄會保留。請求被拒絕、停止或結果未關聯到原操作，都不會允許重新簽名、提交或清除原記錄。")
        }
        val offset = when (locale) { "en" -> 0; "zh" -> 2; else -> 4 }
        return Text(pair[offset], pair[offset + 1])
    }
}
