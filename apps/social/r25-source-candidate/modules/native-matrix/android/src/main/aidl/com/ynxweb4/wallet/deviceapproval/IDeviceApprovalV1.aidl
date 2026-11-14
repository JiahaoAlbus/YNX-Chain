package com.ynxweb4.wallet.deviceapproval;

import com.ynxweb4.wallet.deviceapproval.DeviceApprovalResultV1;

/**
 * Bind explicitly to com.ynxweb4.wallet/.DeviceApprovalService.
 * The caller verifies the Wallet APK identity before binding. Wallet verifies
 * the caller UID and current APK signer on every transaction.
 */
interface IDeviceApprovalV1 {
    // Dispatch at most once. Wallet independently authorizes any user action.
    // The three IDs are 32 bytes each. Originals are exact retained byte spans,
    // each at most 256 KiB. Transport failure leaves the outcome unknown.
    DeviceApprovalResultV1 dispatch(in byte[] deviceOperation, in byte[] pairOperation,
        in byte[] requestDigest, in byte[] allocationOriginal, in byte[] registrationOriginal,
        in byte[] requestOriginal) = 0;

    // After disconnect, rebind and query the SAME original tuple. No dispatch,
    // signing or user prompt may result from query, including on a miss.
    // A miss or transport failure does not permit automatic redispatch.
    DeviceApprovalResultV1 query(in byte[] deviceOperation, in byte[] pairOperation,
        in byte[] requestDigest) = 1;
}
