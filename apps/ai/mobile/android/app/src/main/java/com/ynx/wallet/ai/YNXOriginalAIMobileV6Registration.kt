package com.ynx.wallet.ai

/** Normal application/ReactHost hook, after A has loaded its one combined image.
 * Call registerBeforeReactHost before constructing the RN host. Retire before
 * invalidating that host; drain on its native teardown executor until closed.
 */
object YNXOriginalAIMobileV6Registration {
  @JvmStatic external fun registerBeforeReactHost()
  @JvmStatic external fun requestRetireBeforeReactHostInvalidation()
  @JvmStatic external fun drainOnNativeTeardownExecutor(): Boolean
}
