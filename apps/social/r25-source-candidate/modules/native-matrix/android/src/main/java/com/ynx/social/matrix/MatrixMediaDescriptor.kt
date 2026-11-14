package com.ynx.social.matrix

import org.json.JSONArray
import org.json.JSONObject

/** Pure metadata comparison, not cryptographic verification or authorization.
 * Ruma normalizes JWK key_ops as a set. Only that field may reorder; no other
 * descriptor fields, keys, IVs, hashes, URLs or arrays are ignored or rewritten.
 */
object MatrixMediaDescriptor {
    fun matches(original: JSONObject, sdk: JSONObject): Boolean = try {
        canonical(normalized(original)) == canonical(normalized(sdk))
    } catch (_: IllegalArgumentException) {
        false
    } catch (_: org.json.JSONException) {
        false
    }

    private fun normalized(file: JSONObject): JSONObject {
        val copy = JSONObject(file.toString())
        require(copy.getString("v") == "v2") { "MATRIX_MEDIA_VERSION_INVALID" }
        val key = copy.getJSONObject("key")
        val ops = key.getJSONArray("key_ops")
        val values = (0 until ops.length()).map { index ->
            val value = ops.get(index)
            require(value is String && value in setOf("encrypt", "decrypt")) { "MATRIX_MEDIA_KEY_OPS_INVALID" }
            value
        }
        require(values.contains("decrypt") && values.distinct().size == values.size) { "MATRIX_MEDIA_KEY_OPS_INVALID" }
        key.put("key_ops", JSONArray(values.sorted()))
        return copy
    }

    private fun canonical(value: Any): String = when (value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") {
            JSONObject.quote(it) + ":" + canonical(value.get(it))
        }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        JSONObject.NULL -> "null"
        else -> error("MATRIX_MEDIA_DESCRIPTOR_INVALID")
    }
}
