package com.ynxweb4.wallet;

import com.ynxweb4.wallet.deviceapproval.DeviceApprovalResultV1;
import java.util.Arrays;

/** Routes authenticated Binder calls to the same protected Wallet owner. */
final class DeviceApprovalOperations implements DeviceApprovalService.OriginalApproval {
    interface Holder {
        /**
         * Verify the exact originals under the live account and policy. Atomically
         * reserve the original operation in protected storage before scheduling the
         * trusted review. An existing row must return its state without prompting.
         */
        DeviceApprovalResultV1 reserveReview(int callerUid, byte[] deviceOperation,
                byte[] pairOperation, byte[] requestDigest, byte[] allocationOriginal,
                byte[] registrationOriginal, byte[] requestOriginal);

        /**
         * Read only, including on a miss. The holder checks the authenticated peer
         * and original account, and rechecks current before returning approved bytes.
         * A durable ENTERED row without committed readback projects UNKNOWN.
         */
        DeviceApprovalResultV1 readOriginal(int callerUid, byte[] deviceOperation,
                byte[] pairOperation, byte[] requestDigest);
    }

    private final Holder holder;

    DeviceApprovalOperations(Holder holder) {
        this.holder = java.util.Objects.requireNonNull(holder);
    }

    @Override
    public DeviceApprovalResultV1 dispatch(int callerUid, byte[] deviceOperation,
            byte[] pairOperation, byte[] requestDigest, byte[] allocationOriginal,
            byte[] registrationOriginal, byte[] requestOriginal) {
        // Even a duplicate dispatch goes through the holder's atomic reservation.
        // Looking up first would bypass comparison of the exact retained operands.
        DeviceApprovalResultV1 result = holder.reserveReview(callerUid, deviceOperation,
                pairOperation, requestDigest, allocationOriginal, registrationOriginal, requestOriginal);
        if (result == null || result.status == DeviceApprovalResultV1.NOT_FOUND) {
            return unknown(deviceOperation, pairOperation, requestDigest);
        }
        if (result.status == DeviceApprovalResultV1.APPROVED
                && !Arrays.equals(requestOriginal, result.requestOriginal)) {
            throw new IllegalStateException("Original DEVICE approval request changed");
        }
        return result;
    }

    @Override
    public DeviceApprovalResultV1 query(int callerUid, byte[] deviceOperation,
            byte[] pairOperation, byte[] requestDigest) {
        DeviceApprovalResultV1 result = holder.readOriginal(callerUid, deviceOperation,
                pairOperation, requestDigest);
        return result == null ? unknown(deviceOperation, pairOperation, requestDigest) : result;
    }

    private static DeviceApprovalResultV1 unknown(byte[] deviceOperation, byte[] pairOperation,
            byte[] requestDigest) {
        DeviceApprovalResultV1 result = new DeviceApprovalResultV1();
        result.status = DeviceApprovalResultV1.UNKNOWN;
        result.deviceOperation = deviceOperation.clone();
        result.pairOperation = pairOperation.clone();
        result.requestDigest = requestDigest.clone();
        return result;
    }
}
