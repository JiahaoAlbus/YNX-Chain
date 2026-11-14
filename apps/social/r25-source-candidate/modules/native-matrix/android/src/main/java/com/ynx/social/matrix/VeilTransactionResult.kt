package com.ynx.social.matrix

/** Native transaction failure cleanup. No UI, JS, enrollment or key export. */
internal object VeilTransactionResult {
  @JvmStatic
  fun preserveFailure(primary: Throwable, secondary: Throwable): Throwable {
    if (primary !== secondary) primary.addSuppressed(secondary)
    return primary
  }

  @JvmStatic
  fun discardFailed(value: Any?): Throwable? {
    return try {
      when (value) {
        is ByteArray -> value.fill(0)
        is AutoCloseable -> value.close()
      }
      null
    } catch (failure: Throwable) {
      // Preserve the primary transaction failure; never log returned objects.
      failure
    }
  }
}
