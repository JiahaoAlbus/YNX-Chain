package com.ynxweb4.ai
// Pure display DATA controls. No Android UI, account, JNI owner or approval.
fun main() {
  val account = "0x" + "1".repeat(40); val network = "1".repeat(64)
  fun inputs(): Array<ByteArray> = arrayOf(
    """{"applicationId":"com.ynxweb4.ai","account":"$account","canonicalOwner":"$account","action":"task.run-start","method":"POST","path":"/api/tasks/PUBLIC/runs","origin":"https://PUBLIC.invalid","operationId":"PUBLIC_original","expiresAt":"123456789"}""",
    """{"authorizationRef":"PUBLIC SECRET TOKEN","prompt":"PUBLIC 中文 🌏","nested":{"token":"PUBLIC NESTED SECRET"}}""",
    "a".repeat(64), """{"canonicalOwner":"$account","networkId":"$network","keyEpoch":"7"}""",
    account, "1", network, "com.ynxweb4.ai", "android"
  ).map { it.toByteArray(Charsets.UTF_8) }.toTypedArray()
  val text = ProtectedReviewPresentation.render(inputs())
  check(text.contains("PUBLIC 中文 🌏") && !text.contains("PUBLIC SECRET TOKEN") && !text.contains("PUBLIC NESTED SECRET"))
  check(text.contains("未供应") && text.contains("账户密钥版本：1") && text.contains("任务 Agent 密钥时期：7") && text.contains("不替代工具授权"))
  for (index in listOf(2, 4, 5, 6, 7, 8)) {
    val wrong = inputs(); wrong[index] = (if (index == 5) "" else "FOREIGN").toByteArray()
    check(runCatching { ProtectedReviewPresentation.render(wrong) }.isFailure)
  }
  val malformed = inputs(); malformed[1] = byteArrayOf(0xc3.toByte(), 0x28)
  check(runCatching { ProtectedReviewPresentation.render(malformed) }.isFailure)
  val zero = inputs(); zero[1] = "{\"budget\":0}".toByteArray(); check(ProtectedReviewPresentation.render(zero).contains("\"budget\": 0"))
  println("PUBLIC presentation: exact Unicode, protected-reference redaction, independent account/Agent epoch labels, missing budget, actual zero budget, foreign identity/epoch/UTF8 refusal PASS; UI/approval/Source/Root false")
}
