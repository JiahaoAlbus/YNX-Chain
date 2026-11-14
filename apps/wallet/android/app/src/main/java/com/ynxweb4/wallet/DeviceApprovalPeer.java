package com.ynxweb4.wallet;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Binder;
import android.os.Build;
import android.os.Process;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** The app identity check for the protected DEVICE service. */
final class DeviceApprovalPeer {
    private final PackageManager packages;
    private final String packageName;
    private final byte[] certificateDigest;

    DeviceApprovalPeer(PackageManager packages, String packageName, byte[] certificateDigest) {
        if (packageName == null || packageName.isEmpty()
                || certificateDigest == null || certificateDigest.length != 32) {
            throw new IllegalArgumentException("A fixed DEVICE peer is required");
        }
        this.packages = packages;
        this.packageName = packageName;
        this.certificateDigest = certificateDigest.clone();
    }

    int requireCaller() {
        int uid = Binder.getCallingUid();
        requireOriginalCaller(uid);
        return uid;
    }

    /** Created only after authenticating the Binder calling UID. */
    OriginalCaller captureCaller() { return new OriginalCaller(this, requireCaller()); }

    static final class OriginalCaller {
        private final DeviceApprovalPeer peer;
        private final int uid;
        private OriginalCaller(DeviceApprovalPeer peer, int uid) { this.peer=peer; this.uid=uid; }
        int uid() { return uid; }
        void assertCurrent() { peer.requireOriginalCaller(uid); }
        /** A later query has a fresh token; compare verified identity, not object identity. */
        boolean sameCurrentPeer(OriginalCaller other) {
            if (other == null || !sameIdentity(uid, peer.packageName, peer.certificateDigest,
                    other.uid, other.peer.packageName, other.peer.certificateDigest)) return false;
            assertCurrent();
            other.assertCurrent();
            return true;
        }
    }

    static boolean sameIdentity(int uid, String name, byte[] digest,
            int otherUid, String otherName, byte[] otherDigest) {
        return uid == otherUid && name.equals(otherName) && MessageDigest.isEqual(digest, otherDigest);
    }

    /** Recheck the UID captured by requireCaller; never accept one from IPC data. */
    void requireOriginalCaller(int uid) {
        if (uid == Process.myUid() || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            throw denied();
        }
        String[] names = packages.getPackagesForUid(uid);
        if (names == null || names.length != 1 || !packageName.equals(names[0])) {
            throw denied();
        }
        try {
            @SuppressWarnings("deprecation")
            PackageInfo info = packages.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
            if (info == null || info.applicationInfo == null) throw denied();
            SigningInfo signing = info.signingInfo;
            Signature[] current = signing == null ? null : signing.getApkContentsSigners();
            if (current == null || current.length != 1 || current[0] == null
                    || !sameOriginalPackage(packageName, certificateDigest, uid, names,
                        info.packageName, info.applicationInfo.uid, info.sharedUserId,
                        current[0].toByteArray())) {
                throw denied();
            }
        } catch (PackageManager.NameNotFoundException | NoSuchAlgorithmException failure) {
            throw denied();
        }
    }

    static boolean sameOriginalPackage(String expectedPackage, byte[] expectedDigest,
            int originalUid, String[] names, String packageName, int installedUid,
            String sharedUserId, byte[] signer) throws NoSuchAlgorithmException {
        return names != null && names.length == 1 && expectedPackage.equals(names[0])
            && expectedPackage.equals(packageName) && installedUid == originalUid
            && sharedUserId == null && signer != null && MessageDigest.isEqual(expectedDigest,
                MessageDigest.getInstance("SHA-256").digest(signer));
    }

    private static SecurityException denied() {
        return new SecurityException("DEVICE approval peer not verified");
    }
}
