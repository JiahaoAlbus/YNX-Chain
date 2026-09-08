package expo.modules.securestore

import expo.modules.kotlin.exception.CodedException

internal class StorageWriteUncertainException : CodedException(
  "Secure storage could not confirm a disk write. Fully close and reopen Wallet before trying again."
)

/** SharedPreferences updates its process cache before reporting disk failure.
 * This object deliberately survives React/Expo module recreation. There is no
 * reset API: only a real process restart discards the unverified Android cache.
 * Never hold this monitor across biometrics, coroutines or other async work.
 */
internal object YNXSecureStoreWriteBarrier {
  private var uncertain = false

  @Synchronized
  fun <T> read(action: () -> T): T {
    assertHealthy()
    return action()
  }

  @Synchronized
  fun check() {
    assertHealthy()
  }

  /** The caller turns false into its existing WriteException/DeleteException.
   * Set the process barrier before releasing the monitor or propagating an
   * exception, so no reader or subsequent writer can promote cached changes.
   */
  @Synchronized
  fun commit(action: () -> Boolean): Boolean {
    assertHealthy()
    return try {
      action().also { success -> if (!success) uncertain = true }
    } catch (error: Throwable) {
      uncertain = true
      throw error
    }
  }

  private fun assertHealthy() {
    if (uncertain) throw StorageWriteUncertainException()
  }
}
