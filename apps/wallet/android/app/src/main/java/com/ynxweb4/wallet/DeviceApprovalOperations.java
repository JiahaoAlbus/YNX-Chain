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
        DeviceApprovalResultV1 reserveReview(DeviceApprovalPeer.OriginalCaller caller, byte[] deviceOperation,
                byte[] pairOperation, byte[] requestDigest, byte[] allocationOriginal,
                byte[] registrationOriginal, byte[] requestOriginal);

        /**
         * Read only, including on a miss. The holder checks the authenticated peer
         * and original account, and rechecks current before returning approved bytes.
         * A durable ENTERED row without committed readback projects UNKNOWN.
         */
        DeviceApprovalResultV1 readOriginal(DeviceApprovalPeer.OriginalCaller caller, byte[] deviceOperation,
                byte[] pairOperation, byte[] requestDigest);
    }

    private final Holder holder;

    DeviceApprovalOperations(Holder holder) {
        this.holder = java.util.Objects.requireNonNull(holder);
    }

    @Override
    public DeviceApprovalResultV1 dispatch(DeviceApprovalPeer.OriginalCaller caller, byte[] deviceOperation,
            byte[] pairOperation, byte[] requestDigest, byte[] allocationOriginal,
            byte[] registrationOriginal, byte[] requestOriginal) {
        // The fixed SDK rejects larger originals. Refuse before the holder can
        // reserve a claim or borrow any signing material.
        requireSdkOriginal(registrationOriginal);
        requireSdkOriginal(requestOriginal);
        // Even a duplicate dispatch goes through the holder's atomic reservation.
        // Looking up first would bypass comparison of the exact retained operands.
        // The actor gets its own copies. Its retained work must not mutate
        // the Binder originals used to check the returned tuple and request.
        DeviceApprovalResultV1 result = snapshot(holder.reserveReview(java.util.Objects.requireNonNull(caller), deviceOperation.clone(),
                pairOperation.clone(), requestDigest.clone(), allocationOriginal.clone(),
                registrationOriginal.clone(), requestOriginal.clone()));
        if (result == null || result.status == DeviceApprovalResultV1.NOT_FOUND) {
            return unknown(deviceOperation, pairOperation, requestDigest);
        }
        if (result.status == DeviceApprovalResultV1.APPROVED
                && !Arrays.equals(requestOriginal, result.requestOriginal)) {
            throw new IllegalStateException("Original DEVICE approval request changed");
        }
        return result;
    }

    private static void requireSdkOriginal(byte[] value) {
        if (value == null || value.length == 0 || value.length > 16384) {
            throw new IllegalArgumentException("Original DEVICE SDK input unavailable");
        }
    }

    @Override
    public DeviceApprovalResultV1 query(DeviceApprovalPeer.OriginalCaller caller, byte[] deviceOperation,
            byte[] pairOperation, byte[] requestDigest) {
        DeviceApprovalResultV1 result = snapshot(holder.readOriginal(java.util.Objects.requireNonNull(caller), deviceOperation.clone(),
                pairOperation.clone(), requestDigest.clone()));
        return result == null ? unknown(deviceOperation, pairOperation, requestDigest) : result;
    }

    // The actor can continue to own/mutate its result after return. Take one
    // bounded copy before the service validates and marshals it to the peer.
    private static DeviceApprovalResultV1 snapshot(DeviceApprovalResultV1 source) {
        if (source == null) return null;
        DeviceApprovalResultV1 copy = new DeviceApprovalResultV1();
        copy.status = source.status;
        copy.deviceOperation = bounded(source.deviceOperation, 32);
        copy.pairOperation = bounded(source.pairOperation, 32);
        copy.requestDigest = bounded(source.requestDigest, 32);
        copy.approvalOriginal = bounded(source.approvalOriginal, 196608);
        copy.policyOriginal = bounded(source.policyOriginal, 524288);
        copy.requestOriginal = bounded(source.requestOriginal, 262144);
        return copy;
    }

    private static byte[] bounded(byte[] value, int max) {
        if (value == null) return null;
        if (value.length > max) throw new IllegalStateException("Original DEVICE result unavailable");
        return value.clone();
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
