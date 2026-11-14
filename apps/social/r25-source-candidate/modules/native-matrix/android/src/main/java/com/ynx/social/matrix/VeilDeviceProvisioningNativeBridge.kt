package com.ynx.social.matrix

import android.app.Activity
import android.app.AlertDialog
import android.content.Context

/** Fixed Main-owned JNI only. No injected source/runtime, Boolean approval,
 * keys, purpose selector or public Expo entry. Zero observes an original
 * review/receipt/disposition; it never qualifies a device or enables chat.
 */
internal object VeilDeviceProvisioningNativeBridge {
    @JvmStatic external fun nativeOpenWarm(context: Context, original: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow, activity: Activity,
        review: VeilDeviceProvisioningConfirmation.HeldReview, dialog: AlertDialog): Int
    @JvmStatic external fun nativeOpenCold(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow, activity: Activity,
        review: VeilDeviceProvisioningConfirmation.HeldReview, dialog: AlertDialog): Int
    @JvmStatic external fun nativeCurrent(review: VeilDeviceProvisioningConfirmation.HeldReview,
        dialog: AlertDialog): VeilDeviceProvisioningConfirmation.Current
    @JvmStatic external fun nativeAcceptActualReceipt(review: VeilDeviceProvisioningConfirmation.HeldReview,
        dialog: AlertDialog, receipt: VeilDeviceProvisioningConfirmation.Receipt): Int
    @JvmStatic external fun nativePrepareWalletReview(review: VeilDeviceProvisioningConfirmation.HeldReview,
        dialog: AlertDialog, receipt: VeilDeviceProvisioningConfirmation.Receipt?): ByteArray?
    @JvmStatic external fun nativeSelectWalletDispatch(review: VeilDeviceProvisioningConfirmation.HeldReview,
        dialog: AlertDialog): Int
    @JvmStatic external fun nativeAcceptWalletReviewResult(review: VeilDeviceProvisioningConfirmation.HeldReview,
        dialog: AlertDialog, result: VeilWalletDeviceApprovalClient.Result.Approved): Int
    @JvmStatic external fun nativeRegisteredCurrent(review: VeilDeviceProvisioningConfirmation.HeldReview,
        dialog: AlertDialog): Int
    @JvmStatic external fun nativeStop(review: VeilDeviceProvisioningConfirmation.HeldReview, dialog: AlertDialog): Int
    @JvmStatic external fun nativeObserveRetainedOriginal(review: VeilDeviceProvisioningConfirmation.HeldReview,
        dialog: AlertDialog, receipt: VeilDeviceProvisioningConfirmation.Receipt?): Int
}
