package com.ynx.social.matrix

/** Reserve bounded AES-GCM storage before sealing or changing SQLite rows. */
internal object VeilWriteBudget {
  private const val MAX_TOTAL = 64L * 1024 * 1024
  private const val SEAL_OVERHEAD = 28L

  @JvmStatic
  fun requireReplacement(rows: Long, total: Long, existing: Long, clearBytes: Int) {
    require(rows in 0..4096 && total in 0..MAX_TOTAL)
    require(clearBytes in 1..VeilRecordBudget.MAX_RECORD_BYTES)
    require(existing == 0L || existing in 29..VeilRecordBudget.MAX_SEALED_BYTES.toLong())
    require(existing <= total && (existing == 0L || rows > 0))
    val nextRows = rows + if (existing == 0L) 1L else 0L
    val nextBytes = total - existing + clearBytes.toLong() + SEAL_OVERHEAD
    require(nextRows <= 4096 && nextBytes <= MAX_TOTAL) { "VEIL_STORAGE_BUDGET_EXCEEDED" }
  }
}
