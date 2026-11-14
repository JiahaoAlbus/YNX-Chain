package com.ynxweb4.wallet;

import android.app.Service;
import android.content.ComponentName;
import android.content.Intent;
import android.os.IBinder;
import java.util.Arrays;
import com.ynxweb4.wallet.deviceapproval.DeviceApprovalResultV1;
import com.ynxweb4.wallet.deviceapproval.IDeviceApprovalV1;

/** Fixed explicit endpoint for the original Android DEVICE approval. */
public final class DeviceApprovalService extends Service {
    private static final int DIGEST_BYTES = 32;
    private static final int MAX_ORIGINAL_BYTES = 256 * 1024;

    /**
     * Wallet-process owner. It must authenticate the originals and current account,
     * serialize on the Wallet actor, and bind its durable row to the verified peer
     * and complete tuple. A duplicate dispatch must return the original state.
     */
    interface OriginalApproval {
        DeviceApprovalResultV1 dispatch(DeviceApprovalPeer.OriginalCaller caller, byte[] deviceOperation,
            byte[] pairOperation, byte[] requestDigest, byte[] allocationOriginal,
            byte[] registrationOriginal, byte[] requestOriginal);

        /** Read the existing row only, even after a process restart. */
        DeviceApprovalResultV1 query(DeviceApprovalPeer.OriginalCaller caller, byte[] deviceOperation,
            byte[] pairOperation, byte[] requestDigest);
    }

    interface Host {
        DeviceApprovalPeer deviceApprovalPeer();
        DeviceApprovalOperations.Holder originalDeviceApproval();
    }

    @Override
    public IBinder onBind(Intent intent) {
        if (intent == null || !new ComponentName(this, DeviceApprovalService.class)
                .equals(intent.getComponent())) {
            return null;
        }
        if (!(getApplication() instanceof Host)) {
            return null;
        }
        Host host = (Host) getApplication();
        DeviceApprovalPeer peer = host.deviceApprovalPeer();
        DeviceApprovalOperations.Holder holder = host.originalDeviceApproval();
        return peer == null || holder == null
                ? null : bindVerifiedPeer(peer, new DeviceApprovalOperations(holder));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        stopSelf(startId);
        return START_NOT_STICKY;
    }

    private static IBinder bindVerifiedPeer(DeviceApprovalPeer peer, OriginalApproval actor) {
        return new IDeviceApprovalV1.Stub() {
            @Override
            public DeviceApprovalResultV1 dispatch(byte[] deviceOperation,
                    byte[] pairOperation, byte[] requestDigest, byte[] allocationOriginal,
                    byte[] registrationOriginal, byte[] requestOriginal) {
                DeviceApprovalPeer.OriginalCaller caller = peer.captureCaller();
                requireTuple(deviceOperation, pairOperation, requestDigest);
                requireOriginal(allocationOriginal);
                requireOriginal(registrationOriginal);
                requireOriginal(requestOriginal);
                DeviceApprovalResultV1 result = actor.dispatch(caller, deviceOperation, pairOperation, requestDigest,
                    allocationOriginal, registrationOriginal, requestOriginal);
                // A failed recheck leaves any already-reserved operation intact; it must not be retried here.
                caller.assertCurrent();
                return requireOriginalResult(result, deviceOperation, pairOperation, requestDigest);
            }

            @Override
            public DeviceApprovalResultV1 query(byte[] deviceOperation,
                    byte[] pairOperation, byte[] requestDigest) {
                DeviceApprovalPeer.OriginalCaller caller = peer.captureCaller();
                requireTuple(deviceOperation, pairOperation, requestDigest);
                DeviceApprovalResultV1 result = actor.query(caller, deviceOperation, pairOperation, requestDigest);
                caller.assertCurrent();
                return requireOriginalResult(result, deviceOperation, pairOperation, requestDigest);
            }
        };
    }

    private static DeviceApprovalResultV1 requireOriginalResult(DeviceApprovalResultV1 result,
            byte[] deviceOperation, byte[] pairOperation, byte[] requestDigest) {
        if (result == null || result.status < DeviceApprovalResultV1.NOT_FOUND
                || result.status > DeviceApprovalResultV1.UNKNOWN
                || !Arrays.equals(deviceOperation, result.deviceOperation)
                || !Arrays.equals(pairOperation, result.pairOperation)
                || !Arrays.equals(requestDigest, result.requestDigest)) {
            throw new IllegalStateException("Original DEVICE result unavailable");
        }
        if (result.status == DeviceApprovalResultV1.APPROVED) {
            requireOriginal(result.approvalOriginal, 196608);
            requireOriginal(result.policyOriginal, 524288);
            requireOriginal(result.requestOriginal);
        } else if (result.approvalOriginal != null || result.policyOriginal != null
                || result.requestOriginal != null) {
            throw new IllegalStateException("Unexpected DEVICE approval material");
        }
        return result;
    }

    private static void requireTuple(byte[] deviceOperation, byte[] pairOperation,
            byte[] requestDigest) {
        if (!isDigest(deviceOperation) || !isDigest(pairOperation) || !isDigest(requestDigest)) {
            throw new IllegalArgumentException("Invalid original DEVICE operation");
        }
    }

    private static boolean isDigest(byte[] bytes) {
        return bytes != null && bytes.length == DIGEST_BYTES;
    }

    private static void requireOriginal(byte[] bytes) {
        requireOriginal(bytes, MAX_ORIGINAL_BYTES);
    }

    private static void requireOriginal(byte[] bytes, int maximum) {
        if (bytes == null || bytes.length == 0 || bytes.length > maximum) {
            throw new IllegalArgumentException("Invalid original DEVICE input length");
        }
    }
}
