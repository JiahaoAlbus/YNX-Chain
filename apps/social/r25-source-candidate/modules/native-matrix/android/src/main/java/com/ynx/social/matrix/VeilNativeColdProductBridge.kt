package com.ynx.social.matrix

import android.content.Context

/** Private cold-owner product path; public records never constitute authority. */
internal object VeilNativeColdProductBridge {
    fun acceptDeviceRecords(original: VeilOwnKeyColdRecoveryLease, records: ByteArray): Int =
        original.withAuthenticatedBusiness { context, lease ->
            nativeRestoreAcceptedDevice(context, lease, records)
        }

    fun openMessageSession(original: VeilOwnKeyColdRecoveryLease, records: ByteArray): Int =
        original.withAuthenticatedBusiness { context, lease ->
            nativeOpenMessageSession(context, lease, records)
        }

    fun deviceCurrent(original: VeilOwnKeyColdRecoveryLease): Int =
        original.withAuthenticatedBusiness { context, lease -> nativeAcceptedDeviceCurrent(context, lease) }

    @JvmStatic private external fun nativeRestoreAcceptedDevice(context: Context,
        original: VeilOwnKeyColdRecoveryLease, records: ByteArray): Int
    @JvmStatic private external fun nativeOpenMessageSession(context: Context,
        original: VeilOwnKeyColdRecoveryLease, records: ByteArray): Int
    @JvmStatic private external fun nativeAcceptedDeviceCurrent(context: Context,
        original: VeilOwnKeyColdRecoveryLease): Int
}
