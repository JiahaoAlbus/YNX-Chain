package com.ynxweb4.ai

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

// Pure presentation DATA, never an approval/owner constructor.
internal object ProtectedReviewPresentation {
  private fun utf8(bytes: ByteArray): String = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
  private fun redacted(value: Any?): Any? = when (value) {
    is JSONObject -> JSONObject().also { out ->
      value.keys().forEach { key -> out.put(key, if (key.lowercase() in setOf("authorizationref", "token", "password", "secret", "privatekey", "accesstoken", "refreshtoken", "cookie")) "<protected reference; not displayed>" else redacted(value.get(key))) }
    }
    is JSONArray -> JSONArray().also { out -> for (i in 0 until value.length()) out.put(redacted(value.get(i))) }
    else -> value
  }
  // These fields arrive only from the Native same-capture producer and native
  // independent account loan. The method constructs display DATA, not an owner.
  fun render(raw: Array<ByteArray>): String {
    require(raw.size == 9)
    val unsigned = JSONObject(utf8(raw[0])); val body = if (raw[1].isEmpty()) JSONObject() else JSONObject(utf8(raw[1]))
    val digest = utf8(raw[2]); val agent = JSONObject(utf8(raw[3])); val account = utf8(raw[4]); val accountEpoch = utf8(raw[5])
    require(digest.matches(Regex("[a-f0-9]{64}")) && accountEpoch.isNotEmpty())
    require(utf8(raw[7]) == "com.ynxweb4.ai" && utf8(raw[8]) == "android")
    require(unsigned.getString("applicationId") == "com.ynxweb4.ai" && unsigned.getString("account") == account && unsigned.getString("canonicalOwner") == account)
    require(agent.getString("canonicalOwner") == account && agent.getString("networkId") == utf8(raw[6]))
    val budget = if (body.has("budget") || body.has("spendingBudget")) "仅显示下方原始请求中的预算字段；不据此授予预算" else "未供应；本次请求签名不授予工具或资金预算"
    return """任务请求签名确认

动作：${unsigned.getString("action")}
目标：${unsigned.getString("method")} ${unsigned.getString("path")}
来源：${unsigned.getString("origin")}
任务：${unsigned.opt("taskId") ?: "未供应"}
步骤：${unsigned.opt("stepId") ?: "未供应"}
操作：${unsigned.getString("operationId")}

原生账户：$account
账户密钥版本：$accountEpoch
任务 Agent 密钥时期：${agent.getString("keyEpoch")}
有效期原件：${unsigned.getString("expiresAt")}

预算：$budget
请求摘要：$digest

参数（保护引用已隐藏）：
${(redacted(body) as JSONObject).toString(2)}

此确认仅同意签署这一条原始任务请求，不替代工具授权、资金确认或业务回执。"""
  }
}
