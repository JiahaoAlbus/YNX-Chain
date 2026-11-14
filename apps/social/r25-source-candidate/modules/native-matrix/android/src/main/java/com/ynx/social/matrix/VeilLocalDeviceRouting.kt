package com.ynx.social.matrix

/** Local lifecycle routing only. Public bookkeeping never restores keys or
 * authorizes a device; actual Native read/auth/current checks remain required. */
internal object VeilLocalDeviceRouting {
    fun initialOwnerState(reopenedRows: Int,
        pendingStatus: VeilDeviceEnrollmentPendingStore.Status?,
        retainedLocalIntent: Boolean): VeilCryptoEngineOwner.State {
        require(reopenedRows >= 0)
        return if (reopenedRows > 0 || retainedLocalIntent ||
            pendingStatus == VeilDeviceEnrollmentPendingStore.Status.UNKNOWN ||
            pendingStatus == VeilDeviceEnrollmentPendingStore.Status.RECONCILIATION_REQUIRED)
            VeilCryptoEngineOwner.State.RECOVERY_PENDING
        else VeilCryptoEngineOwner.State.LOCAL_PENDING
    }

    fun authenticationEligibility(snapshot: VeilCryptoEngineOwner.Snapshot,
        setupPending: Boolean, inspectionComplete: Boolean,
        inspectionStatus: String?, coldOriginalInspected: Boolean = false): String {
        if (snapshot.state in setOf(VeilCryptoEngineOwner.State.CLOSING,
                VeilCryptoEngineOwner.State.CLOSED, VeilCryptoEngineOwner.State.INIT_FAILED,
                VeilCryptoEngineOwner.State.CLOSE_UNRESOLVED,
                VeilCryptoEngineOwner.State.DRAIN_REQUIRED)) return "UNAVAILABLE"
        if (setupPending) return "LOCAL_SETUP_REQUIRED"
        if (!snapshot.localGenesisAttempted && !coldOriginalInspected) {
            // A restarted owner has no old in-process genesis input. Do not
            // send a persisted original back through fresh key creation.
            if (snapshot.state == VeilCryptoEngineOwner.State.RECOVERY_PENDING)
                return if (!inspectionComplete) "LOCAL_INSPECTION_REQUIRED" else "RECOVERY_REQUIRED"
            return "LOCAL_SETUP_REQUIRED"
        }
        if (!inspectionComplete) return "LOCAL_INSPECTION_REQUIRED"
        if (inspectionStatus != "CIPHERTEXT_HELD_UNVERIFIED") return "RECOVERY_REQUIRED"
        return "AUTHENTICATION_ELIGIBLE"
    }
}
